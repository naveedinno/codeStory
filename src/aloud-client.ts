import { Agent, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { open, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delayWithSignal } from 'node:timers/promises';
import type { AloudModel, AloudSettingsPatch, AloudStatus } from './narration-types.js';
export type { AloudModel, AloudSettingsPatch, AloudStatus } from './narration-types.js';

// The wire protocol is still Aloud's: Lino ships Aloud's speech engine and
// codeStory runs that engine itself (see lino-engine.ts). These names describe
// the protocol, not an app the reviewer has to install.
const ALOUD_SERVICE = 'aloud-speech-daemon';
const ALOUD_PROTOCOL = 2;
const ALOUD_BATCH_CAPABILITY = 'explicit-batches';
const ALOUD_PREPARE_CAPABILITY = 'prepare-speech';
const MAX_RESPONSE_BYTES = 256 * 1024;

// The engine acknowledges every endpoint in single-digit milliseconds: synthesis
// and playback run on a background job it never makes us wait for. So these
// budgets exist to absorb *our own* event-loop stalls — rendering a 300-step
// story blocks this process for seconds — not audio generation. The previous
// flat 3s fired while the engine was healthy and answering /status in 3ms.
const READ_TIMEOUT_MS = 10_000;
const MUTATE_TIMEOUT_MS = 20_000;

// The engine's HTTP server uses Node's default 5s keep-alive close. Retire
// pooled sockets before that so we rarely write into a socket it has already
// dropped; `isRetryable` covers the race that remains.
const FREE_SOCKET_IDLE_MS = 3_000;
const RETRY_DELAY_MS = 120;
const MAX_ATTEMPTS = 3;

export interface AloudReader {
  control(action: 'pause' | 'resume' | 'stop'): Promise<AloudStatus>;
  /** Releases anything the reader owns, such as a speech engine process. */
  dispose?(): void;
  prepare(input: AloudSpeechRequest): Promise<AloudPreparation | void>;
  speak(input: AloudSpeechRequest): Promise<AloudStatus>;
  status(): Promise<AloudStatus>;
  models?(): Promise<AloudModel[]>;
  configure?(settings: AloudSettingsPatch): Promise<AloudStatus>;
  /** Generates a local WAV independently of the live player and its settings. */
  generateAudio?(input: AloudAudioRequest, destination: string, signal: AbortSignal): Promise<void>;
}

export interface AloudAudioRequest {
  text: string;
  engine: string;
  voice: string;
}

export interface ConfigurableAloudReader extends AloudReader {
  models(): Promise<AloudModel[]>;
  configure(settings: AloudSettingsPatch): Promise<AloudStatus>;
}

export interface AloudPreparation {
  id: string;
  beats: number;
  ready: number;
  state: 'generating' | 'ready' | 'cancelled' | 'error';
  error?: string;
}

export interface AloudSpeechRequest {
  batches?: string[];
  prefetch?: number;
  text: string;
  requestId?: string;
}

/** Where the engine listens, and the bearer secret it requires. */
export interface AloudEndpoint {
  secret?: string;
  url: string;
}

export class AloudUnavailableError extends Error {
  /** Transient failures are worth retrying; the reader is not necessarily gone. */
  readonly transient: boolean = false;
  readonly statusCode: number = 503;

  constructor(message = 'Narration is not available. Install Lino and download a voice in Settings → Read Aloud.') {
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

  constructor(message = 'The speech engine did not respond in time.') {
    super(message);
    this.name = 'AloudTimeoutError';
  }
}

export class AloudControlsUnavailableError extends AloudUnavailableError {
  constructor() {
    super('Update Lino to choose the narration model and voice in codeStory.');
    this.name = 'AloudControlsUnavailableError';
  }
}

/**
 * `endpoint` is either a fixed URL or a resolver. The resolver runs before
 * every request, so a reader can follow an engine process that it restarts.
 */
export function createAloudReader(endpoint: string | (() => Promise<AloudEndpoint>)): ConfigurableAloudReader {
  const resolve = typeof endpoint === 'string'
    ? async (): Promise<AloudEndpoint> => ({ url: endpoint })
    : endpoint;
  const status = async (): Promise<AloudStatus> =>
    verifyStatus(await requestJson(await resolve(), 'GET', '/status', undefined, READ_TIMEOUT_MS));
  return {
    status,
    async generateAudio(input, destination, signal) {
      signal.throwIfAborted();
      const target = await resolve();
      await verifyAloudDaemon(target, 'audio-jobs');
      const operation = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]);
      let job: AloudAudioJob | undefined;
      let createdFile = false;
      try {
        job = audioJob(await requestJson(target, 'POST', '/api/v1/audio/jobs',
          { ...input, language: 'en', rate: 1 }, MUTATE_TIMEOUT_MS, operation, { 'Idempotency-Key': randomUUID() }));
        const path = `/api/v1/audio/jobs/${job.id}`;
        while (job.state === 'queued' || job.state === 'generating') {
          await delayWithSignal(400, undefined, { signal: operation });
          job = audioJob(await requestJson(target, 'GET', path, undefined, READ_TIMEOUT_MS, operation), job.id);
        }
        if (job.state !== 'ready') throw new AloudUnavailableError(job.error || job.message || 'Lino could not generate narration.');
        // Construct the URL ourselves; never follow a job-provided download URL.
        const response = await fetch(new URL(`${path}/file`, target.url), {
          headers: target.secret ? { Authorization: `Bearer ${target.secret}` } : {},
          signal: operation, redirect: 'error',
        });
        if (!response.ok || !response.body || !/^audio\/(?:x-)?wav\b/i.test(response.headers.get('content-type') ?? '')) {
          await response.body?.cancel();
          throw new AloudUnavailableError('Lino did not return a WAV narration file.');
        }
        let bytes = 0;
        const bounded = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > 64 * 1024 * 1024 ? new Error('The generated narration passage is too large.') : null, chunk);
        } });
        const output = await open(destination, 'wx', 0o600);
        createdFile = true;
        await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), bounded,
          output.createWriteStream(), { signal: operation }).finally(() => output.close());
      } catch (error) {
        if (createdFile) await rm(destination, { force: true }).catch(() => {});
        throw error;
      } finally {
        if (job && job.state !== 'ready') {
          // Cancellation belongs to this audio job, never the live reader.
          await attemptJson(target, 'DELETE', `/api/v1/audio/jobs/${job.id}`, undefined, READ_TIMEOUT_MS).catch(() => {});
        }
      }
    },
    async models() {
      const target = await resolve();
      await verifyAloudDaemon(target, 'model-catalog');
      const response = await requestJson(target, 'GET', '/api/v1/models', undefined, READ_TIMEOUT_MS) as { apiVersion?: number; models?: unknown };
      if (response.apiVersion !== 1 || !Array.isArray(response.models) || !response.models.every(isAloudModel)) {
        throw new AloudUnavailableError('Lino returned an incomplete voice catalog.');
      }
      return response.models;
    },
    async configure(settings) {
      const target = await resolve();
      await verifyAloudDaemon(target, 'model-catalog');
      return verifyStatus(await requestJson(target, 'POST', '/settings', settings, MUTATE_TIMEOUT_MS));
    },
    async prepare(input) {
      const target = await resolve();
      await verifyAloudDaemon(target, ALOUD_PREPARE_CAPABILITY);
      const prepared = await requestJson(target, 'POST', '/prepare', input, MUTATE_TIMEOUT_MS);
      if (!isAloudProtocol(prepared)) {
        throw new AloudUnavailableError('The speech engine returned an incompatible preparation response.');
      }
      const progress = (prepared as { prepare?: AloudPreparation }).prepare;
      if (progress && typeof progress.id === 'string') return progress;
    },
    async speak(input) {
      const target = await resolve();
      await verifyAloudDaemon(target);
      // A lost response may be retried on a fresh socket. Reuse one id for all
      // attempts so Lino acknowledges the original job without restarting it.
      const body = { ...input, requestId: input.requestId ?? randomUUID() };
      return verifyStatus(await requestJson(target, 'POST', '/speak', body, MUTATE_TIMEOUT_MS));
    },
    async control(action) {
      const target = await resolve();
      await verifyAloudDaemon(target);
      const controlled = await requestJson(target, 'POST', `/${action}`, {}, MUTATE_TIMEOUT_MS);
      // Current engines return the complete post-control state, avoiding a
      // second round trip. Keep the status fallback for engines that still
      // return only a small acknowledgement.
      return isCompleteStatus(controlled) ? verifyStatus(controlled) : status();
    },
  };
}

/**
 * Confirmed before every mutation, deliberately uncached: this is what keeps
 * narration text from being POSTed to whatever unrelated process happens to hold
 * the engine's port. On loopback the check costs ~2ms, which is not worth
 * trading away.
 */
async function verifyAloudDaemon(target: AloudEndpoint, capability = ALOUD_BATCH_CAPABILITY): Promise<void> {
  const health = await requestJson(target, 'GET', '/health', undefined, READ_TIMEOUT_MS);
  if (!isAloudProtocol(health)) {
    throw new AloudUnavailableError('The local speech engine is not a compatible Lino reader.');
  }
  const capabilities = (health as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes(capability)) {
    if (capability === 'model-catalog') throw new AloudControlsUnavailableError();
    if (capability === 'audio-jobs') throw new AloudUnavailableError('Update Lino to export video with its local voices.');
    if (capability === ALOUD_PREPARE_CAPABILITY) {
      throw new AloudUnavailableError('Lino needs an update before codeStory can prepare narration in the background.');
    }
    throw new AloudUnavailableError('Lino needs an update before it can prefetch codeStory narration. Update Lino, then try again.');
  }
}

function isAloudModel(value: unknown): value is AloudModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as AloudModel;
  return typeof model.id === 'string' && typeof model.name === 'string' && typeof model.ready === 'boolean'
    && Array.isArray(model.languages) && model.languages.every((language) => typeof language === 'string')
    && Array.isArray(model.voices) && model.voices.length > 0
    && model.voices.every((voice) => voice && typeof voice.id === 'string' && typeof voice.label === 'string');
}

function verifyStatus(value: unknown): AloudStatus {
  if (!isAloudProtocol(value) || typeof value !== 'object' || value === null) {
    throw new AloudUnavailableError('The speech engine returned an incompatible reader status.');
  }
  const status = value as Partial<AloudStatus>;
  if (typeof status.running !== 'boolean' || typeof status.paused !== 'boolean' || typeof status.state !== 'object') {
    throw new AloudUnavailableError('The speech engine returned an incomplete reader status.');
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
 * Drop a socket once it has sat idle longer than the engine's own keep-alive
 * window. Checks that the socket is still *free* before destroying it, so a
 * socket the poll loop picked back up is never torn out from under an in-flight
 * request.
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
 * Worth another attempt on a fresh socket. Covers the two ways a healthy engine
 * still looks broken from here: a reused keep-alive socket it already closed,
 * and a timeout our own blocked event loop caused. ECONNREFUSED is excluded on
 * purpose — that means the engine really is not listening, so fail fast and say so.
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
 * Every engine operation is idempotent in effect — reads are reads, /speak
 * replaces the current job, /prepare warms a cache, and pause/resume/stop
 * assert a state — so a retry can only ever converge on the intended outcome.
 */
async function requestJson(
  target: AloudEndpoint,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      signal?.throwIfAborted();
      return await attemptJson(target, method, path, body, timeoutMs, signal, extraHeaders);
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      await delay(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function attemptJson(
  target: AloudEndpoint,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = { ...extraHeaders };
    if (target.secret) headers['Authorization'] = `Bearer ${target.secret}`;
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = httpRequest(new URL(path, target.url), {
      agent,
      method,
      headers,
      timeout: timeoutMs,
      signal,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        bytes += buffer.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new AloudUnavailableError('The speech engine returned an unexpectedly large response.'));
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
          reject(new AloudUnavailableError('The speech engine returned an invalid response.'));
          return;
        }
        if ((res.statusCode ?? 500) >= 400) {
          const detail = (parsed as { error?: unknown })?.error;
          const message = typeof detail === 'object' && detail !== null ? (detail as { message?: unknown }).message : detail;
          reject(new AloudUnavailableError(typeof message === 'string' ? message : 'The speech engine rejected the request.'));
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
      // (ECONNRESET) apart from the engine genuinely not listening (ECONNREFUSED).
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

interface AloudAudioJob { id: string; state: string; error?: string; message?: string }
function audioJob(value: unknown, expectedId?: string): AloudAudioJob {
  const job = value as AloudAudioJob & { apiVersion?: number } | null;
  if (!job || job.apiVersion !== 1 || typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/.test(job.id)
      || (expectedId && job.id !== expectedId) || !['queued', 'generating', 'ready', 'cancelled', 'error'].includes(job.state)) {
    throw new AloudUnavailableError('Lino returned an incompatible audio job. Update Lino and try again.');
  }
  return job;
}
