import { Agent, request as httpRequest } from 'node:http';
import type { Socket } from 'node:net';

const DEFAULT_ALOUD_URL = 'http://127.0.0.1:17878';
const ALOUD_SERVICE = 'aloud-speech-daemon';
const ALOUD_PROTOCOL = 2;
const ALOUD_BATCH_CAPABILITY = 'explicit-batches';
const ALOUD_PREPARE_CAPABILITY = 'prepare-speech';
const MAX_RESPONSE_BYTES = 256 * 1024;

// Aloud acknowledges every endpoint in single-digit milliseconds: synthesis and
// playback run on a background job it never makes us wait for. So these budgets
// exist to absorb *our own* event-loop stalls — rendering a 300-step story
// blocks this process for seconds — not audio generation. The previous flat 3s
// fired while Aloud was healthy and answering /status in 3ms, which is what
// surfaced as "Aloud did not respond in time."
const READ_TIMEOUT_MS = 10_000;
const MUTATE_TIMEOUT_MS = 20_000;

// Aloud's HTTP server uses Node's default 5s keep-alive close. Retire pooled
// sockets before that so we rarely write into a socket it has already dropped;
// `isRetryable` covers the race that remains.
const FREE_SOCKET_IDLE_MS = 3_000;
const RETRY_DELAY_MS = 120;
const MAX_ATTEMPTS = 3;

export interface AloudStatus {
  jobId?: string;
  ok: true;
  paused: boolean;
  protocolVersion: number;
  rate?: number;
  running: boolean;
  service: string;
  state: {
    current?: number;
    message?: string;
    status?: 'starting' | 'generating' | 'reading' | 'done' | 'stopped' | 'error';
    total?: number;
  };
  [key: string]: unknown;
}

export interface AloudReader {
  control(action: 'pause' | 'resume' | 'stop'): Promise<AloudStatus>;
  prepare(input: AloudSpeechRequest): Promise<void>;
  speak(input: AloudSpeechRequest): Promise<AloudStatus>;
  status(): Promise<AloudStatus>;
}

export interface AloudSpeechRequest {
  batches?: string[];
  prefetch?: number;
  text: string;
}

export class AloudUnavailableError extends Error {
  /** Transient failures are worth retrying; the reader is not necessarily gone. */
  readonly transient: boolean = false;
  readonly statusCode: number = 503;

  constructor(message = 'Aloud is not available. Open Aloud and install its Services to enable narration.') {
    super(message);
    this.name = 'AloudUnavailableError';
  }
}

/**
 * A round trip that never came back in time. Extends AloudUnavailableError so
 * existing `instanceof` checks keep working, but callers that care can treat it
 * as retryable rather than telling the user narration is unavailable.
 */
export class AloudTimeoutError extends AloudUnavailableError {
  override readonly transient = true;
  override readonly statusCode = 504;

  constructor(message = 'Aloud did not respond in time.') {
    super(message);
    this.name = 'AloudTimeoutError';
  }
}

export function createAloudReader(baseUrl = DEFAULT_ALOUD_URL): AloudReader {
  const status = async (): Promise<AloudStatus> =>
    verifyStatus(await requestJson(baseUrl, 'GET', '/status', undefined, READ_TIMEOUT_MS));
  return {
    status,
    async prepare(input) {
      await verifyAloudDaemon(baseUrl, ALOUD_PREPARE_CAPABILITY);
      const prepared = await requestJson(baseUrl, 'POST', '/prepare', input, MUTATE_TIMEOUT_MS);
      if (!isAloudProtocol(prepared)) {
        throw new AloudUnavailableError('Aloud returned an incompatible preparation response.');
      }
    },
    async speak(input) {
      await verifyAloudDaemon(baseUrl);
      return verifyStatus(await requestJson(baseUrl, 'POST', '/speak', input, MUTATE_TIMEOUT_MS));
    },
    async control(action) {
      await verifyAloudDaemon(baseUrl);
      const controlled = await requestJson(baseUrl, 'POST', `/${action}`, {}, MUTATE_TIMEOUT_MS);
      // Newer Aloud builds return the complete post-control state, avoiding a
      // second round trip. Keep the status fallback for installed v2 Services
      // that still return only a small acknowledgement.
      return isCompleteStatus(controlled) ? verifyStatus(controlled) : status();
    },
  };
}

/**
 * Confirmed before every mutation, deliberately uncached: this is what keeps
 * narration text from being POSTed to whatever unrelated process happens to hold
 * port 17878. On loopback the check costs ~2ms, which is not worth trading away.
 */
async function verifyAloudDaemon(baseUrl: string, capability = ALOUD_BATCH_CAPABILITY): Promise<void> {
  const health = await requestJson(baseUrl, 'GET', '/health', undefined, READ_TIMEOUT_MS);
  if (!isAloudProtocol(health)) {
    throw new AloudUnavailableError('The local reader on port 17878 is not a compatible Aloud service.');
  }
  const capabilities = (health as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes(capability)) {
    if (capability === ALOUD_PREPARE_CAPABILITY) {
      throw new AloudUnavailableError('Aloud needs an update before codeStory can prepare narration in the background.');
    }
    throw new AloudUnavailableError('Aloud needs an update before it can prefetch codeStory narration. Reinstall Aloud Services, then try again.');
  }
}

function verifyStatus(value: unknown): AloudStatus {
  if (!isAloudProtocol(value) || typeof value !== 'object' || value === null) {
    throw new AloudUnavailableError('Aloud returned an incompatible reader status.');
  }
  const status = value as Partial<AloudStatus>;
  if (typeof status.running !== 'boolean' || typeof status.paused !== 'boolean' || typeof status.state !== 'object') {
    throw new AloudUnavailableError('Aloud returned an incomplete reader status.');
  }
  return status as AloudStatus;
}

function isCompleteStatus(value: unknown): boolean {
  const status = value as Partial<AloudStatus> | null;
  return isAloudProtocol(value)
    && typeof status?.running === 'boolean'
    && typeof status.paused === 'boolean'
    && typeof status.state === 'object'
    && status.state !== null;
}

function isAloudProtocol(value: unknown): boolean {
  const response = value as { ok?: unknown; protocolVersion?: unknown; service?: unknown } | null;
  return response?.ok === true
    && response.service === ALOUD_SERVICE
    && response.protocolVersion === ALOUD_PROTOCOL;
}

// One pooled connection set for the whole process. Keep-alive matters here: the
// narration poll loop makes hundreds of requests per story.
const agent = new Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 });

const LAST_USED = Symbol('aloudSocketLastUsed');
type PooledSocket = Socket & { [LAST_USED]?: number };

/**
 * Drop a socket once it has sat idle longer than Aloud's own keep-alive window.
 * Checks that the socket is still *free* before destroying it, so a socket the
 * poll loop picked back up is never torn out from under an in-flight request.
 */
function retirePooledSocket(socket: PooledSocket | null): void {
  if (!socket) return;
  socket[LAST_USED] = Date.now();
  const timer = setTimeout(() => {
    if (Date.now() - (socket[LAST_USED] ?? 0) < FREE_SOCKET_IDLE_MS) return;
    const idle = Object.values(agent.freeSockets)
      .some((list) => (list as Socket[] | undefined)?.includes(socket));
    if (idle) socket.destroy();
  }, FREE_SOCKET_IDLE_MS + 50);
  timer.unref?.();
}

/**
 * Worth another attempt on a fresh socket. Covers the two ways a healthy Aloud
 * still looks broken from here: a reused keep-alive socket it already closed,
 * and a timeout our own blocked event loop caused. ECONNREFUSED is excluded on
 * purpose — that means Aloud really is not listening, so fail fast and say so.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof AloudTimeoutError) return true;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT';
}

// Deliberately *not* unref'd: a caller is awaiting this retry, so the timer has
// to keep the process alive. Unref'ing it lets a short-lived CLI run exit between
// attempts and leave the narration promise hanging forever.
const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Every Aloud operation is idempotent in effect — reads are reads, /speak
 * replaces the current job, /prepare warms a cache, and pause/resume/stop
 * assert a state — so a retry can only ever converge on the intended outcome.
 */
async function requestJson(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await attemptJson(baseUrl, method, path, body, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      await delay(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function attemptJson(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(new URL(path, baseUrl), {
      agent,
      method,
      headers: payload === undefined ? undefined : {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        bytes += buffer.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new AloudUnavailableError('Aloud returned an unexpectedly large response.'));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        retirePooledSocket(res.socket as PooledSocket | null);
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          reject(new AloudUnavailableError('Aloud returned an invalid response.'));
          return;
        }
        if ((res.statusCode ?? 500) >= 400) {
          const message = (parsed as { error?: unknown })?.error;
          reject(new AloudUnavailableError(typeof message === 'string' ? message : 'Aloud rejected the request.'));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new AloudTimeoutError()));
    req.on('error', (error) => {
      if (error instanceof AloudUnavailableError) {
        reject(error);
        return;
      }
      // Preserve the errno so isRetryable can tell a stale pooled socket
      // (ECONNRESET) apart from Aloud genuinely not listening (ECONNREFUSED).
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT') {
        reject(error);
        return;
      }
      reject(new AloudUnavailableError());
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
