// Story freshness is intentionally a separate concern from the rendered review
// diff. A story snapshot records the exact repository state the narrative was
// written against, while inspection reports only changes made after that point.
// The public interface keeps Git plumbing, consistency retries, snapshot
// validation, and content storage inside this module.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { APP_DATA_PATHSPECS, DATA_DIR, isAppDataPath } from './config.js';
import { isGeneratedPath } from './noise.js';
import type { StoryScope } from './types.js';

const SNAPSHOT_VERSION = 1 as const;
const SNAPSHOT_DIR = `${DATA_DIR}/snapshots`;
const BLOB_DIR = `${SNAPSHOT_DIR}/blobs`;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_RENDERED_DIFF_BYTES = 512 * 1024;
const MAX_GIT_BUFFER = 128 * 1024 * 1024;
const STABLE_READ_ATTEMPTS = 3;

export interface StorySnapshotRef {
  version: typeof SNAPSHOT_VERSION;
  /** Content identity of the snapshot manifest; it contains no wall-clock time. */
  id: string;
}

export interface CaptureStorySnapshotInput {
  repo: string;
  base: string;
  head?: string;
  /** Immutable objects used for capture while base/head retain display semantics. */
  frozenBase?: string;
  frozenHead?: string;
  storyScope?: Pick<StoryScope, 'includedFiles'>;
}

/** The authored story semantics a stored snapshot is expected to belong to. */
export interface StoryDriftExpectedBinding {
  base: string;
  head?: string;
  storyScope: Pick<StoryScope, 'includedFiles'>;
}

export type StoryDriftChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';
export type StoryDriftEvidence = 'exact' | 'partial' | 'unavailable';
export type StoryDriftEvidenceReason =
  | 'binary'
  | 'generated'
  | 'oversized'
  | 'index-state'
  | 'special-file'
  | 'content-unavailable';

export interface StoryDriftChange {
  path: string;
  oldPath?: string;
  kind: StoryDriftChangeKind;
  inStory: boolean;
  evidence: StoryDriftEvidence;
  reason?: StoryDriftEvidenceReason;
}

export interface StoryDriftReport {
  /** `changed` includes side-file drift even when the story itself is current. */
  status: 'current' | 'changed' | 'unverified';
  storyFreshness: 'current' | 'stale' | 'unverified';
  complete: boolean;
  snapshotIdentity: string | null;
  currentIdentity: string | null;
  /** Binds a later lazy diff request to this exact observation. */
  observationId: string | null;
  inScopeCount: number;
  outsideScopeCount: number;
  changes: StoryDriftChange[];
  reason?: string;
}

export interface InspectStoryDriftInput {
  repo: string;
  snapshot: unknown;
  expected?: StoryDriftExpectedBinding;
}

export interface LoadStoryDriftDiffInput {
  repo: string;
  snapshot: unknown;
  expected?: StoryDriftExpectedBinding;
  observationId: string;
  /** `path` is the current path from StoryDriftChange (or its oldPath for a rename). */
  path: string;
}

export interface StoryDriftFileDiff {
  status: 'exact' | 'partial' | 'unavailable' | 'unverified';
  path: string;
  oldPath?: string;
  diff?: string;
  reason?: string;
}

type NodeKind = 'file' | 'symlink' | 'gitlink' | 'special';
type GitObjectFormat = 'sha1' | 'sha256';

interface RawGitNode {
  kind: NodeKind;
  mode: string;
  oid: string;
  complete: boolean;
}

interface GitObjectData {
  size: number;
  bytes: Buffer | null;
  complete: boolean;
}

interface SnapshotNode {
  kind: NodeKind;
  mode: string;
  oid: string;
  size: number;
  complete: boolean;
  binary?: boolean;
  blob?: string;
}

interface StateEntry {
  path: string;
  review: SnapshotNode | null;
  /** Fixed-ref snapshots have no mutable index lane. */
  index?: SnapshotNode | null;
}

interface SnapshotState {
  identity: string;
  complete: boolean;
  entries: StateEntry[];
}

interface SnapshotManifestPayload {
  version: typeof SNAPSHOT_VERSION;
  base: { requested: string; resolvedTree: string };
  head: { requested: string; resolvedTree: string } | null;
  storyFiles: string[];
  state: SnapshotState;
}

interface SnapshotManifest extends SnapshotManifestPayload {
  id: string;
}

interface ScanResult extends SnapshotState {
  /** Raw bytes are retained only during capture/lazy loading and never serialized. */
  blobs: Map<string, Buffer>;
}

interface EffectiveState {
  review: SnapshotNode | null;
  index?: SnapshotNode | null;
}

interface InternalChange extends StoryDriftChange {
  before: EffectiveState;
  after: EffectiveState;
}

interface Observation {
  manifest: SnapshotManifest;
  current: ScanResult;
  changes: InternalChange[];
  observationId: string;
}

/**
 * Capture an immutable, content-addressed story baseline. The base is resolved
 * to a tree immediately; mutable worktree captures retain both review and index
 * lanes, including untracked files. A changing repository is retried rather
 * than producing a torn snapshot.
 */
export function captureStorySnapshot(input: CaptureStorySnapshotInput): StorySnapshotRef {
  const repo = repositoryRoot(input.repo);
  const baseTree = resolveTree(repo, input.frozenBase ?? input.base);
  const headTree = input.head === undefined
    ? undefined
    : resolveTree(repo, input.frozenHead ?? input.head);
  const scan = stableScan(repo, baseTree, headTree, true);
  const storyFiles = input.storyScope
    ? normalizeStoryFiles(input.storyScope.includedFiles)
    : scan.entries.map((entry) => entry.path);

  const payload: SnapshotManifestPayload = {
    version: SNAPSHOT_VERSION,
    base: { requested: input.base, resolvedTree: baseTree },
    head: input.head === undefined ? null : { requested: input.head, resolvedTree: headTree as string },
    storyFiles,
    state: {
      identity: scan.identity,
      complete: scan.complete,
      entries: scan.entries,
    },
  };
  const id = manifestIdentity(payload);
  const manifest: SnapshotManifest = { ...payload, id };

  persistSnapshot(repo, manifest, scan.blobs);
  return { version: SNAPSHOT_VERSION, id };
}

/** Safely inspect a snapshot. Missing, old, corrupt, or unstable evidence is unverified, never current. */
export function inspectStoryDrift(input: InspectStoryDriftInput): StoryDriftReport {
  try {
    const observation = observe(input.repo, input.snapshot, input.expected, false);
    const changes = observation.changes.map(publicChange);
    const inScopeCount = changes.filter((change) => change.inStory).length;
    const outsideScopeCount = changes.length - inScopeCount;
    const complete = observation.manifest.state.complete && observation.current.complete;
    const selectedScopeComplete = storyScopeComplete(observation.manifest, observation.current);
    const storyFreshness = inScopeCount ? 'stale' : selectedScopeComplete ? 'current' : 'unverified';
    return {
      status: storyFreshness === 'unverified' ? 'unverified' : changes.length ? 'changed' : 'current',
      storyFreshness,
      complete,
      snapshotIdentity: observation.manifest.state.identity,
      currentIdentity: observation.current.identity,
      observationId: observation.observationId,
      inScopeCount,
      outsideScopeCount,
      changes,
      ...(!complete
        ? { reason: storyFreshness === 'unverified'
          ? 'A selected story path could not be identified completely.'
          : 'Some side-file contents are unavailable, but the selected story paths remain conclusive.' }
        : {}),
    };
  } catch (error) {
    return unverifiedReport(safeError(error));
  }
}

/**
 * Materialize one snapshot-to-current unified diff on demand. The observation
 * id prevents a click from silently showing bytes newer than the count/list the
 * reviewer saw. Binary, special, unavailable, and truncated evidence is
 * reported explicitly.
 */
export function loadStoryDriftDiff(input: LoadStoryDriftDiffInput): StoryDriftFileDiff {
  const requestedPath = typeof input.path === 'string' ? input.path : '';
  try {
    assertSafeRepoPath(requestedPath);
    const observation = observe(input.repo, input.snapshot, input.expected, true);
    if (observation.observationId !== input.observationId) {
      return {
        status: 'unverified',
        path: requestedPath,
        reason: 'The repository changed after this drift observation. Refresh the change list first.',
      };
    }
    const change = observation.changes.find(
      (candidate) => candidate.path === requestedPath || candidate.oldPath === requestedPath,
    );
    if (!change) {
      return { status: 'unverified', path: requestedPath, reason: 'That path is not part of this drift observation.' };
    }
    return materializeDiff(repositoryRoot(input.repo), observation, change);
  } catch (error) {
    return { status: 'unverified', path: requestedPath, reason: safeError(error) };
  }
}

function observe(
  repoInput: string,
  refInput: unknown,
  expected: StoryDriftExpectedBinding | undefined,
  captureBytes: boolean,
): Observation {
  const repo = repositoryRoot(repoInput);
  const ref = parseSnapshotRef(refInput);
  const manifest = readManifest(repo, ref);
  if (expected !== undefined) assertExpectedBinding(repo, manifest, expected);
  const currentHeadTree = manifest.head ? resolveTree(repo, manifest.head.requested) : undefined;
  const current = stableScan(repo, manifest.base.resolvedTree, currentHeadTree, captureBytes);
  if (expected !== undefined) assertExpectedBinding(repo, manifest, expected);
  if (manifest.head && resolveTree(repo, manifest.head.requested) !== currentHeadTree) {
    throw new Error('The story head moved while codeStory inspected it. Refresh and try again.');
  }
  const changes = compareStates(repo, manifest, current);
  // Digest tags here predate the codeStory rename and stay unchanged.
  const observationId = digest(
    `diffstory-observation-v1\0${manifest.id}\0${current.identity}\0${current.complete ? 'complete' : 'incomplete'}`,
  );
  return { manifest, current, changes, observationId };
}

function stableScan(repo: string, baseTree: string, headTree: string | undefined, captureBytes: boolean): ScanResult {
  const objectFormat = objectFormatForOid(baseTree);
  for (let attempt = 0; attempt < STABLE_READ_ATTEMPTS; attempt += 1) {
    const first = scanState(repo, baseTree, headTree, captureBytes, objectFormat);
    const confirmation = scanState(repo, baseTree, headTree, false, objectFormat);
    if (first.identity === confirmation.identity && first.complete === confirmation.complete) return first;
  }
  throw new Error('The repository kept changing while codeStory read it; try again after the write finishes.');
}

function scanState(
  repo: string,
  baseTree: string,
  headTree: string | undefined,
  captureBytes: boolean,
  objectFormat: GitObjectFormat,
): ScanResult {
  const fixed = headTree !== undefined;
  const entries: StateEntry[] = [];
  const blobs = new Map<string, Buffer>();
  let complete = true;
  const paths = changedPaths(repo, baseTree, headTree);
  for (const path of paths) assertSafeRepoPath(path);

  const baseRaw = readTreeDescriptors(repo, baseTree, paths);
  const reviewRaw = fixed ? readTreeDescriptors(repo, headTree as string, paths) : new Map<string, RawGitNode>();
  const indexRaw = fixed ? new Map<string, RawGitNode>() : readIndexDescriptors(repo, paths);
  const objectData = readGitObjectData(repo, [...baseRaw.values(), ...reviewRaw.values(), ...indexRaw.values()], objectFormat);

  for (const path of paths) {
    const base = hydrateGitNode(baseRaw.get(path), false, blobs, objectData, objectFormat);
    const review = fixed
      ? hydrateGitNode(reviewRaw.get(path), captureBytes, blobs, objectData, objectFormat)
      : readWorktreeNode(repo, path, captureBytes, blobs, objectFormat);
    const index = fixed ? undefined : hydrateGitNode(indexRaw.get(path), captureBytes, blobs, objectData, objectFormat);
    if (nodeEqual(review, base) && (fixed || nodeEqual(index ?? null, base))) continue;
    if ((review && !review.complete) || (index && !index.complete)) complete = false;
    entries.push({ path, review, ...(fixed ? {} : { index: index ?? null }) });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  const identity = stateIdentity(entries, fixed, complete);
  return { entries, identity, complete, blobs };
}

function changedPaths(repo: string, baseTree: string, headTree?: string): string[] {
  const paths = new Set<string>();
  if (headTree) {
    addNulPaths(paths, git(repo, ['diff', '--name-only', '-z', '--no-renames', baseTree, headTree, '--', ...APP_DATA_PATHSPECS]));
  } else {
    addNulPaths(paths, git(repo, ['diff', '--name-only', '-z', '--no-renames', baseTree, '--', ...APP_DATA_PATHSPECS]));
    addNulPaths(paths, git(repo, ['diff', '--cached', '--name-only', '-z', '--no-renames', baseTree, '--', ...APP_DATA_PATHSPECS]));
    addNulPaths(paths, git(repo, ['diff', '--name-only', '-z', '--no-renames', '--', ...APP_DATA_PATHSPECS]));
    addNulPaths(paths, git(repo, ['ls-files', '--others', '--exclude-standard', '-z']));
  }
  return [...paths]
    .filter((path) => !isAppDataPath(path))
    .sort((a, b) => a.localeCompare(b));
}

function addNulPaths(target: Set<string>, output: string): void {
  for (const path of output.split('\0')) if (path) target.add(path);
}

function readTreeNodes(
  repo: string,
  tree: string,
  paths: string[],
  captureBytes: boolean,
  blobs: Map<string, Buffer>,
  objectFormat: GitObjectFormat,
): Map<string, SnapshotNode> {
  const raw = readTreeDescriptors(repo, tree, paths);
  const data = readGitObjectData(repo, [...raw.values()], objectFormat);
  return new Map([...raw].map(([path, node]) => [path, hydrateGitNode(node, captureBytes, blobs, data, objectFormat) as SnapshotNode]));
}

function readTreeDescriptors(repo: string, tree: string, paths: string[]): Map<string, RawGitNode> {
  const result = new Map<string, RawGitNode>();
  for (const pathBatch of batches(paths, 256)) {
    const output = git(repo, ['ls-tree', '-z', tree, '--', ...pathBatch.map(literalPathspec)]);
    for (const record of output.split('\0').filter(Boolean)) {
      const tab = record.indexOf('\t');
      if (tab < 0) continue;
      const path = record.slice(tab + 1);
      const [mode, type, oid] = record.slice(0, tab).split(' ');
      if (!mode || !type || !oid) {
        result.set(path, { kind: 'special', mode: mode || '000000', oid: `unreadable:${path}`, complete: false });
      } else {
        result.set(path, {
          kind: type === 'commit' || mode === '160000' ? 'gitlink' : type === 'blob' ? (mode === '120000' ? 'symlink' : 'file') : 'special',
          mode,
          oid,
          complete: type === 'blob' || type === 'commit' || mode === '160000',
        });
      }
    }
  }
  return result;
}

function readIndexDescriptors(repo: string, paths: string[]): Map<string, RawGitNode> {
  const result = new Map<string, RawGitNode>();
  const conflicted = new Map<string, { mode: string; oid: string }>();
  for (const pathBatch of batches(paths, 256)) {
    const output = git(repo, ['ls-files', '--stage', '-z', '--', ...pathBatch.map(literalPathspec)]);
    for (const record of output.split('\0').filter(Boolean)) {
      const tab = record.indexOf('\t');
      if (tab < 0) continue;
      const path = record.slice(tab + 1);
      const [mode, oid, stage] = record.slice(0, tab).split(' ');
      if (stage !== '0') {
        conflicted.set(path, { mode: mode || '000000', oid: oid || `index:${path}` });
        continue;
      }
      const valid = !!mode && !!oid && !/^0+$/.test(oid);
      result.set(path, {
        kind: !valid ? 'special' : mode === '160000' ? 'gitlink' : mode === '120000' ? 'symlink' : 'file',
        mode: mode || '000000',
        oid: oid || `index:${path}`,
        complete: valid,
      });
    }
  }
  for (const [path, conflict] of conflicted) {
    if (!result.has(path)) result.set(path, { kind: 'special', mode: conflict.mode, oid: conflict.oid, complete: false });
  }
  return result;
}

function readGitObjectData(repo: string, nodes: RawGitNode[], objectFormat: GitObjectFormat): Map<string, GitObjectData> {
  const oids = [...new Set(nodes.filter((node) => node.complete && node.kind !== 'gitlink' && node.kind !== 'special').map((node) => node.oid))];
  const result = new Map<string, GitObjectData>();
  if (!oids.length) return result;

  const checked = spawnSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    cwd: repo,
    input: `${oids.join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (checked.error || checked.status !== 0) {
    for (const oid of oids) result.set(oid, { size: 0, bytes: null, complete: false });
    return result;
  }
  const lines = (checked.stdout ?? '').trimEnd().split('\n');
  for (let index = 0; index < oids.length; index += 1) {
    const [oid, type, sizeText] = (lines[index] ?? '').split(' ');
    const size = Number(sizeText);
    const complete = oid === oids[index] && type === 'blob' && Number.isSafeInteger(size) && size >= 0;
    result.set(oids[index], { size: complete ? size : 0, bytes: null, complete });
  }

  const readable = oids.filter((oid) => {
    const data = result.get(oid);
    return data?.complete && data.size <= MAX_STORED_BYTES;
  });
  for (const oidBatch of objectBatches(readable, result)) {
    const loaded = spawnSync('git', ['cat-file', '--batch'], {
      cwd: repo,
      input: `${oidBatch.join('\n')}\n`,
      maxBuffer: Math.max(8 * 1024 * 1024, oidBatch.reduce((total, oid) => total + (result.get(oid)?.size ?? 0) + 256, 0)),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = loaded.stdout as Buffer | null;
    if (loaded.error || loaded.status !== 0 || !output || !parseBatchObjects(output, oidBatch, result, objectFormat)) {
      for (const oid of oidBatch) {
        const data = result.get(oid);
        if (data) data.complete = false;
      }
    }
  }
  return result;
}

function parseBatchObjects(
  output: Buffer,
  oids: string[],
  result: Map<string, GitObjectData>,
  objectFormat: GitObjectFormat,
): boolean {
  let offset = 0;
  for (const expectedOid of oids) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) return false;
    const [oid, type, sizeText] = output.subarray(offset, headerEnd).toString('utf8').split(' ');
    const size = Number(sizeText);
    const expectedSize = result.get(expectedOid)?.size;
    if (oid !== expectedOid || type !== 'blob' || size !== expectedSize || !Number.isSafeInteger(size) || size < 0) return false;
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 10) return false;
    const bytes = Buffer.from(output.subarray(contentStart, contentEnd));
    if (gitBlobOid(objectFormat, bytes) !== expectedOid) return false;
    const data = result.get(expectedOid);
    if (!data) return false;
    data.bytes = bytes;
    offset = contentEnd + 1;
  }
  return offset === output.length;
}

function objectBatches(oids: string[], data: Map<string, GitObjectData>): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const oid of oids) {
    const size = data.get(oid)?.size ?? 0;
    if (current.length && (current.length >= 128 || bytes + size > 32 * 1024 * 1024)) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(oid);
    bytes += size;
  }
  if (current.length) result.push(current);
  return result;
}

function hydrateGitNode(
  raw: RawGitNode | undefined,
  captureBytes: boolean,
  blobs: Map<string, Buffer>,
  objectData: Map<string, GitObjectData>,
  objectFormat: GitObjectFormat,
): SnapshotNode | null {
  if (!raw) return null;
  if (!raw.complete || raw.kind === 'special') return incompleteNode(raw.mode, 'special', raw.oid);
  if (raw.kind === 'gitlink') return { kind: 'gitlink', mode: raw.mode, oid: raw.oid, size: 0, complete: true };
  const data = objectData.get(raw.oid);
  if (!data?.complete || (data.size <= MAX_STORED_BYTES && data.bytes === null)) return incompleteNode(raw.mode, 'special', raw.oid);
  const node: SnapshotNode = {
    kind: raw.kind,
    mode: raw.mode,
    oid: raw.oid,
    size: data.size,
    complete: true,
    ...(data.bytes !== null ? { binary: data.bytes.includes(0) } : {}),
  };
  if (captureBytes && data.bytes !== null) attachBlob(node, data.bytes, blobs, objectFormat);
  return node;
}

function readWorktreeNode(
  repo: string,
  path: string,
  captureBytes: boolean,
  blobs: Map<string, Buffer>,
  objectFormat: GitObjectFormat,
): SnapshotNode | null {
  let absolute: string;
  try {
    absolute = safeAbsolutePath(repo, path);
    if (inspectPathAncestors(repo, path) === 'missing') return null;
  } catch {
    return incompleteNode('000000', 'special', `unsafe-ancestor:${path}`);
  }
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return incompleteNode('000000', 'special', `filesystem:${path}`);
  }

  if (stat.isSymbolicLink()) {
    let bytes: Buffer;
    let after;
    try {
      bytes = Buffer.from(readlinkSync(absolute));
      after = lstatSync(absolute);
    } catch {
      return incompleteNode('120000', 'symlink', `filesystem:${path}`);
    }
    const oid = gitBlobOid(objectFormat, bytes);
    const node: SnapshotNode = {
      kind: 'symlink', mode: '120000', oid,
      size: bytes.length, complete: after.isSymbolicLink() && sameFileStat(stat, after), binary: false,
    };
    if (captureBytes && node.complete) attachBlob(node, bytes, blobs, objectFormat);
    return node;
  }
  if (stat.isFile()) {
    return readRegularWorktreeNode(absolute, path, stat, captureBytes, blobs, objectFormat);
  }
  if (stat.isDirectory()) {
    let directory = absolute;
    try {
      directory = realpathSync(absolute);
      assertContainedPath(repo, directory);
    } catch {
      return incompleteNode('040000', 'special', `directory:${path}`);
    }
    const commit = tryGit(directory, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])?.trim() ?? null;
    return commit
      ? { kind: 'gitlink', mode: '160000', oid: commit, size: 0, complete: true }
      : incompleteNode('040000', 'special', `directory:${path}`);
  }
  return incompleteNode((stat.mode & 0o777777).toString(8), 'special', `special:${path}`);
}

function readRegularWorktreeNode(
  absolute: string,
  path: string,
  pathStat: Stats,
  captureBytes: boolean,
  blobs: Map<string, Buffer>,
  objectFormat: GitObjectFormat,
): SnapshotNode {
  let fd: number | null = null;
  try {
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || !sameFileStat(pathStat, before) || !Number.isSafeInteger(before.size) || before.size < 0) {
      return incompleteNode('000000', 'special', `filesystem:${path}`);
    }
    const mode = before.mode & 0o111 ? '100755' : '100644';
    const hash = createHash(objectFormat).update(Buffer.from(`blob ${before.size}\0`));
    const stored = before.size <= MAX_STORED_BYTES ? Buffer.alloc(before.size) : null;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, before.size)));
    let offset = 0;
    let binary = false;
    while (offset < before.size) {
      const length = Math.min(chunk.length, before.size - offset);
      const count = readSync(fd, chunk, 0, length, offset);
      if (count <= 0) return incompleteNode(mode, 'file', `filesystem:${path}`);
      const bytes = chunk.subarray(0, count);
      hash.update(bytes);
      if (stored ? bytes.includes(0) : offset < 8192 && bytes.subarray(0, Math.min(bytes.length, 8192 - offset)).includes(0)) binary = true;
      if (stored) bytes.copy(stored, offset);
      offset += count;
    }
    const extra = Buffer.allocUnsafe(1);
    const grew = readSync(fd, extra, 0, 1, before.size) !== 0;
    const after = fstatSync(fd);
    const node: SnapshotNode = {
      kind: 'file',
      mode,
      oid: hash.digest('hex'),
      size: before.size,
      complete: !grew && sameFileStat(before, after),
      binary,
    };
    if (captureBytes && stored && node.complete) attachBlob(node, stored, blobs, objectFormat);
    return node;
  } catch {
    return incompleteNode('000000', 'special', `filesystem:${path}`);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function attachBlob(node: SnapshotNode, bytes: Buffer, blobs: Map<string, Buffer>, objectFormat: GitObjectFormat): void {
  if ((node.kind !== 'file' && node.kind !== 'symlink') || gitBlobOid(objectFormat, bytes) !== node.oid) {
    node.complete = false;
    return;
  }
  const blob = digest(bytes);
  node.blob = blob;
  blobs.set(blob, bytes);
}

function incompleteNode(mode: string, kind: NodeKind, oid: string): SnapshotNode {
  return { kind, mode, oid, size: 0, complete: false };
}

function compareStates(repo: string, manifest: SnapshotManifest, current: ScanResult): InternalChange[] {
  const beforeEntries = new Map(manifest.state.entries.map((entry) => [entry.path, entry]));
  const afterEntries = new Map(current.entries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort((a, b) => a.localeCompare(b));
  const storyFiles = new Set(manifest.storyFiles);
  const raw: InternalChange[] = [];
  const objectFormat = objectFormatForOid(manifest.base.resolvedTree);
  const baseNodes = readTreeNodes(repo, manifest.base.resolvedTree, paths, false, new Map(), objectFormat);

  for (const path of paths) {
    const base = baseNodes.get(path) ?? null;
    const before = effectiveState(beforeEntries.get(path), base, manifest.head !== null);
    const after = effectiveState(afterEntries.get(path), base, manifest.head !== null);
    if (effectiveEqual(before, after)) continue;
    const kind = changeKind(before.review, after.review);
    const evidence = evidenceFor(path, before, after);
    raw.push({ path, kind, inStory: storyFiles.has(path), ...evidence, before, after });
  }

  return pairRenames(raw, storyFiles).sort((a, b) =>
    a.path.localeCompare(b.path) || (a.oldPath ?? '').localeCompare(b.oldPath ?? ''),
  );
}

function effectiveState(entry: StateEntry | undefined, base: SnapshotNode | null, fixed: boolean): EffectiveState {
  if (entry) return { review: entry.review, ...(fixed ? {} : { index: entry.index ?? null }) };
  return { review: base, ...(fixed ? {} : { index: base }) };
}

function changeKind(before: SnapshotNode | null, after: SnapshotNode | null): StoryDriftChangeKind {
  if (!before && after) return 'added';
  if (before && !after) return 'deleted';
  return 'modified';
}

function evidenceFor(
  path: string,
  before: EffectiveState,
  after: EffectiveState,
): Pick<StoryDriftChange, 'evidence' | 'reason'> {
  const nodes = [before.review, after.review, before.index, after.index].filter((node): node is SnapshotNode => !!node);
  if (nodes.some((node) => !node.complete || node.kind === 'special' || node.kind === 'gitlink')) {
    return { evidence: 'unavailable', reason: 'special-file' };
  }
  if (hasSymlinkTransition(before, after)) return { evidence: 'unavailable', reason: 'special-file' };
  if (nodes.some((node) => node.binary)) return { evidence: 'unavailable', reason: 'binary' };
  if (!nodeEqual(before.index ?? null, after.index ?? null)) {
    return { evidence: 'partial', reason: 'index-state' };
  }
  if (nodes.some((node) => node.size > MAX_STORED_BYTES)) return { evidence: 'partial', reason: 'oversized' };
  if (isGeneratedPath(path)) return { evidence: 'exact', reason: 'generated' };
  return { evidence: 'exact' };
}

function hasSymlinkTransition(before: EffectiveState, after: EffectiveState): boolean {
  return [
    [before.review, after.review],
    [before.index ?? null, after.index ?? null],
  ].some(([left, right]) => !!left && !!right
    && (left.kind === 'symlink' || right.kind === 'symlink')
    && (left.kind !== right.kind || left.mode !== right.mode));
}

function pairRenames(raw: InternalChange[], storyFiles: Set<string>): InternalChange[] {
  const additions = raw.filter((change) => change.kind === 'added');
  const used = new Set<InternalChange>();
  const result: InternalChange[] = [];

  for (const deletion of raw.filter((change) => change.kind === 'deleted')) {
    const signature = renameSignature(deletion.before.review);
    const addition = signature
      ? additions.find((candidate) => !used.has(candidate) && renameSignature(candidate.after.review) === signature)
      : undefined;
    if (!addition) continue;
    used.add(deletion);
    used.add(addition);
    const evidence = combineEvidence(deletion, addition);
    result.push({
      path: addition.path,
      oldPath: deletion.path,
      kind: 'renamed',
      inStory: storyFiles.has(deletion.path) || storyFiles.has(addition.path),
      ...evidence,
      before: deletion.before,
      after: addition.after,
    });
  }
  for (const change of raw) if (!used.has(change)) result.push(change);
  return result;
}

function renameSignature(node: SnapshotNode | null): string | null {
  return node && node.complete && node.kind !== 'special' && node.kind !== 'gitlink'
    ? `${node.kind}\0${node.oid}`
    : null;
}

function combineEvidence(
  left: StoryDriftChange,
  right: StoryDriftChange,
): Pick<StoryDriftChange, 'evidence' | 'reason'> {
  const rank = { exact: 0, partial: 1, unavailable: 2 } as const;
  const worse = rank[left.evidence] >= rank[right.evidence] ? left : right;
  return { evidence: worse.evidence, ...(worse.reason ? { reason: worse.reason } : {}) };
}

function materializeDiff(repo: string, observation: Observation, change: InternalChange): StoryDriftFileDiff {
  const oldPath = change.oldPath ?? change.path;
  const before = snapshotContent(repo, observation.manifest, oldPath, change.before.review);
  const after = currentContent(repo, observation.current, change.path, change.after.review);
  const baseResult = { path: change.path, ...(change.oldPath ? { oldPath: change.oldPath } : {}) };

  if (change.reason === 'index-state' && nodeEqual(change.before.review, change.after.review)) {
    return {
      ...baseResult,
      status: 'partial',
      diff: '',
      reason: 'Only the Git index lane changed; the working-tree bytes are identical.',
    };
  }
  if (change.before.review?.kind === 'gitlink' || change.after.review?.kind === 'gitlink') {
    return { ...baseResult, status: 'unavailable', reason: 'Submodule contents are identified but not expanded.' };
  }
  if (change.before.review?.kind === 'special' || change.after.review?.kind === 'special') {
    return { ...baseResult, status: 'unavailable', reason: 'Special-file contents cannot be rendered safely.' };
  }
  if (!before.available || !after.available) {
    return { ...baseResult, status: 'unavailable', reason: 'Snapshot or current file contents are unavailable.' };
  }
  if (hasSymlinkTransition(change.before, change.after)) {
    return { ...baseResult, status: 'unavailable', reason: 'A symlink type or mode transition cannot be rendered as an exact regular-file patch.' };
  }
  if (before.bytes?.includes(0) || after.bytes?.includes(0)) {
    return { ...baseResult, status: 'unavailable', reason: 'Binary contents changed; only their identities are available.' };
  }
  if (change.kind === 'renamed' && buffersEqual(before.bytes, after.bytes)) {
    const beforeMode = change.before.review?.mode;
    const afterMode = change.after.review?.mode;
    const modeChange = beforeMode && afterMode && beforeMode !== afterMode
      ? `old mode ${beforeMode}\nnew mode ${afterMode}\n`
      : '';
    return {
      ...baseResult,
      status: change.reason === 'index-state' ? 'partial' : 'exact',
      diff: `diff --git ${diffLabel('a', oldPath)} ${diffLabel('b', change.path)}\n${modeChange}similarity index 100%\nrename from ${oldPath}\nrename to ${change.path}\n`,
      ...(change.reason === 'index-state'
        ? { reason: 'The rename bytes are exact, but the path also changed in the Git index lane.' }
        : {}),
    };
  }

  const rendered = unifiedDiff(
    oldPath,
    change.path,
    before.bytes,
    after.bytes,
    change.before.review?.mode,
    change.after.review?.mode,
  );
  if (rendered === null) {
    return { ...baseResult, status: 'unavailable', reason: 'Git could not render this file diff.' };
  }
  if (Buffer.byteLength(rendered) > MAX_RENDERED_DIFF_BYTES) {
    const prefix = Buffer.from(rendered).subarray(0, MAX_RENDERED_DIFF_BYTES).toString('utf8');
    return {
      ...baseResult,
      status: 'partial',
      diff: `${prefix}\n... codeStory truncated this drift diff; use Git for the complete patch.\n`,
      reason: 'The exact patch is larger than the safe inline rendering limit.',
    };
  }
  if (change.reason === 'index-state') {
    return {
      ...baseResult,
      status: 'partial',
      diff: rendered,
      reason: 'The working-tree patch is exact, but this file also changed in the Git index lane.',
    };
  }
  return { ...baseResult, status: 'exact', diff: rendered };
}

function snapshotContent(
  repo: string,
  manifest: SnapshotManifest,
  path: string,
  node: SnapshotNode | null,
): { available: boolean; bytes: Buffer | null } {
  if (!node) return { available: true, bytes: null };
  if (node.blob) {
    const bytes = readStoredBlob(repo, node.blob);
    return bytes && nodeBytesMatch(node, bytes) ? { available: true, bytes } : { available: false, bytes: null };
  }
  const bytes = tryGitBuffer(repo, ['cat-file', 'blob', node.oid]);
  if (bytes && nodeBytesMatch(node, bytes)) return { available: true, bytes };
  // An entry absent from the manifest is implicit base state. The oid lookup
  // above normally succeeds; this path lookup is a defensive fallback.
  const fallbackBlobs = new Map<string, Buffer>();
  const objectFormat = objectFormatForOid(manifest.base.resolvedTree);
  const base = readTreeNodes(repo, manifest.base.resolvedTree, [path], true, fallbackBlobs, objectFormat).get(path);
  if (base?.blob) {
    const content = fallbackBlobs.get(base.blob);
    if (content && nodeBytesMatch(base, content)) return { available: true, bytes: content };
  }
  return { available: false, bytes: null };
}

function currentContent(
  repo: string,
  current: ScanResult,
  _path: string,
  node: SnapshotNode | null,
): { available: boolean; bytes: Buffer | null } {
  if (!node) return { available: true, bytes: null };
  if (node.blob && current.blobs.has(node.blob)) {
    const bytes = current.blobs.get(node.blob) as Buffer;
    return nodeBytesMatch(node, bytes) ? { available: true, bytes } : { available: false, bytes: null };
  }
  const bytes = tryGitBuffer(repo, ['cat-file', 'blob', node.oid]);
  return bytes && nodeBytesMatch(node, bytes) ? { available: true, bytes } : { available: false, bytes: null };
}

function nodeBytesMatch(node: SnapshotNode, bytes: Buffer): boolean {
  try {
    return (node.kind === 'file' || node.kind === 'symlink')
      && gitBlobOid(objectFormatForOid(node.oid), bytes) === node.oid;
  } catch {
    return false;
  }
}

function unifiedDiff(
  oldPath: string,
  newPath: string,
  before: Buffer | null,
  after: Buffer | null,
  beforeMode?: string,
  afterMode?: string,
): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'codestory-drift-'));
  try {
    const beforeFile = join(dir, 'before');
    const afterFile = join(dir, 'after');
    if (before !== null) {
      writeFileSync(beforeFile, before);
      applyMode(beforeFile, beforeMode);
    }
    if (after !== null) {
      writeFileSync(afterFile, after);
      applyMode(afterFile, afterMode);
    }
    const result = spawnSync(
      'git',
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', before === null ? '/dev/null' : beforeFile, after === null ? '/dev/null' : afterFile],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.error || (result.status !== 0 && result.status !== 1)) return null;
    const output = result.stdout ?? '';
    if (!output) return '';
    return rewriteDiffHeaders(output, oldPath, newPath, before !== null, after !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function applyMode(path: string, mode?: string): void {
  if (mode === '100755') chmodSync(path, 0o755);
  else chmodSync(path, 0o644);
}

function rewriteDiffHeaders(output: string, oldPath: string, newPath: string, hasBefore: boolean, hasAfter: boolean): string {
  const lines = output.split('\n');
  const diffIndex = lines.findIndex((line) => line.startsWith('diff --git '));
  if (diffIndex >= 0) lines[diffIndex] = `diff --git ${diffLabel('a', oldPath)} ${diffLabel('b', newPath)}`;
  const oldIndex = lines.findIndex((line) => line.startsWith('--- '));
  if (oldIndex >= 0) lines[oldIndex] = hasBefore ? `--- ${diffLabel('a', oldPath)}` : '--- /dev/null';
  const newIndex = lines.findIndex((line) => line.startsWith('+++ '));
  if (newIndex >= 0) lines[newIndex] = hasAfter ? `+++ ${diffLabel('b', newPath)}` : '+++ /dev/null';
  return lines.join('\n');
}

function diffLabel(prefix: 'a' | 'b', path: string): string {
  const label = `${prefix}/${path}`;
  return /[\x00-\x1f\x7f\\"]/u.test(label) ? JSON.stringify(label) : label;
}

function persistSnapshot(repo: string, manifest: SnapshotManifest, blobs: Map<string, Buffer>): void {
  const snapshots = ensureDataDirectory(repo, SNAPSHOT_DIR);
  const blobDirectory = ensureDataDirectory(repo, BLOB_DIR);
  for (const [id, bytes] of blobs) {
    const path = join(blobDirectory, `${id}.gz`);
    if (existingBlobMatches(path, id)) continue;
    atomicWrite(path, gzipSync(bytes, { level: 9 }));
  }
  atomicWrite(join(snapshots, `${manifest.id}.json`), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}

function existingBlobMatches(path: string, expected: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return digest(gunzipSync(readFileSync(path))) === expected;
  } catch {
    return false;
  }
}

function readStoredBlob(repo: string, id: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  try {
    const path = join(repo, BLOB_DIR, `${id}.gz`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const bytes = gunzipSync(readFileSync(path));
    return digest(bytes) === id ? bytes : null;
  } catch {
    return null;
  }
}

function readManifest(repo: string, ref: StorySnapshotRef): SnapshotManifest {
  const path = join(repo, SNAPSHOT_DIR, `${ref.id}.json`);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error('Story snapshot is missing. Regenerate the story to establish a new baseline.');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Story snapshot is missing or unsafe.');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const manifest = validateManifest(parsed);
  if (manifest.id !== ref.id) throw new Error('Story snapshot identity does not match its reference.');
  return manifest;
}

function validateManifest(value: unknown): SnapshotManifest {
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION || !isDigest(value.id)) throw new Error('Story snapshot format is invalid.');
  if (!isRecord(value.base) || typeof value.base.requested !== 'string' || !isObjectId(value.base.resolvedTree)) {
    throw new Error('Story snapshot base identity is invalid.');
  }
  assertSafeRef(value.base.requested);
  let head: SnapshotManifest['head'] = null;
  if (value.head !== null) {
    if (!isRecord(value.head) || typeof value.head.requested !== 'string' || !isObjectId(value.head.resolvedTree)) {
      throw new Error('Story snapshot head identity is invalid.');
    }
    assertSafeRef(value.head.requested);
    head = { requested: value.head.requested, resolvedTree: value.head.resolvedTree };
  }
  const rawStoryFiles = value.storyFiles;
  if (!Array.isArray(rawStoryFiles)) throw new Error('Story snapshot scope is invalid.');
  const storyFiles = normalizeStoryFiles(rawStoryFiles);
  if (storyFiles.length !== rawStoryFiles.length || storyFiles.some((path, i) => path !== rawStoryFiles[i])) {
    throw new Error('Story snapshot scope is not canonical.');
  }
  if (!isRecord(value.state) || !isDigest(value.state.identity) || typeof value.state.complete !== 'boolean' || !Array.isArray(value.state.entries)) {
    throw new Error('Story snapshot state is invalid.');
  }
  const entries = value.state.entries.map(validateEntry);
  if (entries.some((entry, i) => i > 0 && entries[i - 1].path.localeCompare(entry.path) >= 0)) {
    throw new Error('Story snapshot paths are not canonical.');
  }
  const fixed = head !== null;
  const expectedStateIdentity = stateIdentity(entries, fixed, value.state.complete);
  if (expectedStateIdentity !== value.state.identity) throw new Error('Story snapshot state identity is corrupt.');
  const payload: SnapshotManifestPayload = {
    version: SNAPSHOT_VERSION,
    base: { requested: value.base.requested, resolvedTree: value.base.resolvedTree },
    head,
    storyFiles,
    state: { identity: value.state.identity, complete: value.state.complete, entries },
  };
  if (manifestIdentity(payload) !== value.id) throw new Error('Story snapshot manifest is corrupt.');
  return { ...payload, id: value.id };
}

function validateEntry(value: unknown): StateEntry {
  if (!isRecord(value) || typeof value.path !== 'string') throw new Error('Story snapshot entry is invalid.');
  assertSafeRepoPath(value.path);
  const review = validateNode(value.review);
  const entry: StateEntry = { path: value.path, review };
  if ('index' in value) entry.index = validateNode(value.index);
  return entry;
}

function validateNode(value: unknown): SnapshotNode | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Story snapshot file identity is invalid.');
  if (!['file', 'symlink', 'gitlink', 'special'].includes(String(value.kind))) throw new Error('Story snapshot file kind is invalid.');
  if (typeof value.mode !== 'string' || typeof value.oid !== 'string' || value.oid.length > 256) throw new Error('Story snapshot file identity is invalid.');
  if (!Number.isSafeInteger(value.size) || Number(value.size) < 0 || typeof value.complete !== 'boolean') throw new Error('Story snapshot file metadata is invalid.');
  if (value.binary !== undefined && typeof value.binary !== 'boolean') throw new Error('Story snapshot binary metadata is invalid.');
  if (value.blob !== undefined && !isDigest(value.blob)) throw new Error('Story snapshot blob identity is invalid.');
  return {
    kind: value.kind as NodeKind,
    mode: value.mode,
    oid: value.oid,
    size: Number(value.size),
    complete: value.complete,
    ...(value.binary === undefined ? {} : { binary: value.binary }),
    ...(value.blob === undefined ? {} : { blob: value.blob }),
  };
}

function parseSnapshotRef(value: unknown): StorySnapshotRef {
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION || !isDigest(value.id)) {
    throw new Error('This story has no valid drift snapshot. Regenerate it to establish a baseline.');
  }
  return { version: SNAPSHOT_VERSION, id: value.id };
}

function assertExpectedBinding(repo: string, manifest: SnapshotManifest, expected: StoryDriftExpectedBinding): void {
  if (!isRecord(expected) || typeof expected.base !== 'string' || !isRecord(expected.storyScope)
    || !Array.isArray(expected.storyScope.includedFiles)) {
    throw new Error('Expected story snapshot binding is invalid.');
  }
  assertSafeRef(expected.base);
  if (expected.head !== undefined) assertSafeRef(expected.head);
  const storyFiles = normalizeStoryFiles(expected.storyScope.includedFiles);
  const headMatches = expected.head === undefined
    ? manifest.head === null
    : manifest.head?.requested === expected.head;
  if (
    manifest.base.requested !== expected.base
    || !headMatches
    || storyFiles.length !== manifest.storyFiles.length
    || storyFiles.some((path, index) => path !== manifest.storyFiles[index])
  ) {
    throw new Error('Story snapshot does not match the story base, head, or included-file scope. Regenerate the story baseline.');
  }
  if (resolveTree(repo, expected.base) !== manifest.base.resolvedTree) {
    throw new Error('The story base ref moved after its baseline was captured. Regenerate the story baseline.');
  }
}

function storyScopeComplete(manifest: SnapshotManifest, current: ScanResult): boolean {
  const fixed = manifest.head !== null;
  const before = new Map(manifest.state.entries.map((entry) => [entry.path, entry]));
  const after = new Map(current.entries.map((entry) => [entry.path, entry]));
  return manifest.storyFiles.every((path) => stateEntryComplete(before.get(path), fixed) && stateEntryComplete(after.get(path), fixed));
}

function stateEntryComplete(entry: StateEntry | undefined, fixed: boolean): boolean {
  if (!entry) return true;
  if (entry.review && !entry.review.complete) return false;
  return fixed || !entry.index || entry.index.complete;
}

function stateIdentity(entries: StateEntry[], fixed: boolean, complete: boolean): string {
  const canonical = entries.map((entry) => ({
    path: entry.path,
    review: nodeIdentity(entry.review),
    ...(fixed ? {} : { index: nodeIdentity(entry.index ?? null) }),
  }));
  // A saved manifest's state identity is re-derived with this tag on read.
  return digest(`diffstory-state-v1\0${fixed ? 'fixed' : 'working'}\0${complete ? 'complete' : 'incomplete'}\0${JSON.stringify(canonical)}`);
}

function nodeIdentity(node: SnapshotNode | null): unknown {
  return node ? [node.kind, node.mode, node.oid, node.complete] : null;
}

function manifestIdentity(payload: SnapshotManifestPayload): string {
  // Saved manifests are verified against this tag; changing it marks every
  // snapshot taken before the codeStory rename as corrupt.
  return digest(`diffstory-snapshot-v1\0${JSON.stringify(payload)}`);
}

function nodeEqual(left: SnapshotNode | null, right: SnapshotNode | null): boolean {
  if (left === right) return true;
  return !!left && !!right
    && left.kind === right.kind
    && left.mode === right.mode
    && left.oid === right.oid
    && left.complete === right.complete;
}

function effectiveEqual(left: EffectiveState, right: EffectiveState): boolean {
  return nodeEqual(left.review, right.review) && nodeEqual(left.index ?? null, right.index ?? null);
}

function publicChange(change: InternalChange): StoryDriftChange {
  return {
    path: change.path,
    ...(change.oldPath ? { oldPath: change.oldPath } : {}),
    kind: change.kind,
    inStory: change.inStory,
    evidence: change.evidence,
    ...(change.reason ? { reason: change.reason } : {}),
  };
}

function unverifiedReport(reason: string): StoryDriftReport {
  return {
    status: 'unverified', storyFreshness: 'unverified', complete: false,
    snapshotIdentity: null, currentIdentity: null, observationId: null,
    inScopeCount: 0, outsideScopeCount: 0, changes: [], reason,
  };
}

function repositoryRoot(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Repository path is missing.');
  const candidate = realpathSync(input);
  const root = realpathSync(git(candidate, ['rev-parse', '--show-toplevel']).trim());
  if (candidate !== root) throw new Error('Story drift snapshots must be opened from the repository root.');
  return root;
}

function resolveTree(repo: string, ref: string): string {
  assertSafeRef(ref);
  const tree = tryGit(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{tree}`])?.trim();
  if (!tree || !isObjectId(tree)) throw new Error(`Git ref cannot be resolved: ${ref}`);
  return tree;
}

function assertSafeRef(ref: string): void {
  if (typeof ref !== 'string' || !ref || ref.length > 1024 || ref.includes('\0') || ref.startsWith('-')) {
    throw new Error('Git ref is invalid.');
  }
}

function normalizeStoryFiles(files: readonly unknown[]): string[] {
  const normalized = [...new Set(files.map((value) => {
    if (typeof value !== 'string') throw new Error('Story scope contains a non-text path.');
    assertSafeRepoPath(value);
    return value;
  }))].sort((a, b) => a.localeCompare(b));
  return normalized;
}

function assertSafeRepoPath(path: string): void {
  if (
    !path
    || path.includes('\0')
    || path.includes('\\')
    || path.startsWith('/')
    || path === '.'
    || path === '..'
    || path.split('/').some((part) => !part || part === '.' || part === '..')
    || isAppDataPath(path)
  ) throw new Error('Repository-relative path is unsafe.');
}

function safeAbsolutePath(repo: string, path: string): string {
  assertSafeRepoPath(path);
  const absolute = resolve(repo, path);
  assertContainedPath(repo, absolute);
  return absolute;
}

function assertContainedPath(repo: string, absolute: string): void {
  const rel = relative(repo, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Repository-relative path escapes the repository.');
}

function inspectPathAncestors(repo: string, path: string): 'safe' | 'missing' {
  const parts = path.split('/');
  let current = repo;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Repository path has an unsafe ancestor.');
  }
  return 'safe';
}

function sameFileStat(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function ensureDataDirectory(repo: string, relativePath: string): string {
  let current = repo;
  for (const part of relativePath.split('/')) {
    current = join(current, part);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('codeStory snapshot directory is unsafe.');
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
  }
  return current;
}

function atomicWrite(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('codeStory snapshot target is unsafe.');
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', maxBuffer: MAX_GIT_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(repo: string, args: string[]): string | null {
  try {
    return git(repo, args);
  } catch {
    return null;
  }
}

function tryGitBuffer(repo: string, args: string[]): Buffer | null {
  try {
    return execFileSync('git', args, {
      cwd: repo, encoding: 'buffer', maxBuffer: MAX_GIT_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as Buffer;
  } catch {
    return null;
  }
}

function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function objectFormatForOid(oid: string): GitObjectFormat {
  if (/^[0-9a-f]{40}$/.test(oid)) return 'sha1';
  if (/^[0-9a-f]{64}$/.test(oid)) return 'sha256';
  throw new Error('Git object format is unsupported.');
}

function gitBlobOid(objectFormat: GitObjectFormat, bytes: Buffer): string {
  return createHash(objectFormat).update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function buffersEqual(left: Buffer | null, right: Buffer | null): boolean {
  if (left === right) return true;
  return !!left && !!right && left.equals(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value);
}

function safeError(error: unknown): string {
  if (error instanceof SyntaxError) return 'Story snapshot metadata is corrupt.';
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return 'Story freshness could not be verified.';
}
