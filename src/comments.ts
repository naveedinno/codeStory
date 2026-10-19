// Read/write the reviewer's queued comments. The shape stays human-readable so
// Copy all can produce a portable review without coupling comments to an agent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { commentsPath } from "./config.js";
import { assertSafeRepoPath } from "./git.js";
import type {
  Comment,
  CommentSelection,
  CommentSeverity,
  CommentSide,
  CommentStatus,
  CommentType,
} from "./types.js";

const TYPES: CommentType[] = ["change", "question", "nit"];
const SEVERITIES: CommentSeverity[] = ["blocking", "concern", "nit"];
const STATUSES: CommentStatus[] = ["open", "addressed", "resolved"];
const SIDES: CommentSide[] = ["left", "right"];

export type CommentStoreHealth =
  | { status: "healthy"; source: "missing" | "file" }
  | {
      status: "invalid";
      reason: "unreadable" | "invalid-json" | "not-array" | "invalid-entry";
      message: string;
      recovery: string;
      entryIndex?: number;
    };

export interface CommentLoadResult {
  comments: Comment[];
  health: CommentStoreHealth;
  /** Identity of the exact source bytes, including malformed content. */
  sourceDigest: string;
}

const INVALID_RECOVERY =
  "Repair or restore .codestory/comments.json, then reload. codeStory will not overwrite the invalid file.";

export class InvalidCommentStoreError extends Error {
  readonly health: Extract<CommentStoreHealth, { status: "invalid" }>;

  constructor(health: Extract<CommentStoreHealth, { status: "invalid" }>) {
    super(`${health.message} ${health.recovery}`);
    this.name = "InvalidCommentStoreError";
    this.health = health;
  }
}

export function loadCommentsWithHealth(repo: string): CommentLoadResult {
  const path = commentsPath(repo);
  if (!existsSync(path)) {
    return {
      comments: [],
      health: { status: "healthy", source: "missing" },
      sourceDigest: hashSource(null),
    };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";
    return invalidLoad(
      "unreadable",
      `Could not read .codestory/comments.json${detail}.`,
      null,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return invalidLoad(
      "invalid-json",
      ".codestory/comments.json is not valid JSON.",
      raw,
    );
  }
  if (!Array.isArray(data)) {
    return invalidLoad(
      "not-array",
      ".codestory/comments.json must contain a JSON array.",
      raw,
    );
  }

  const seen = new Set<string>();
  for (let index = 0; index < data.length; index++) {
    const problem = validateStoredComment(data[index], seen);
    if (problem) {
      return invalidLoad(
        "invalid-entry",
        `.codestory/comments.json has an invalid comment at array index ${index}: ${problem}.`,
        raw,
        index,
      );
    }
  }
  return {
    comments: data as Comment[],
    health: { status: "healthy", source: "file" },
    sourceDigest: hashSource(raw),
  };
}

/** Compatibility reader for callers that only render valid comments. */
export function loadComments(repo: string): Comment[] {
  return loadCommentsWithHealth(repo).comments;
}

/**
 * The comments one story owns. An untagged comment belongs to every story: repos that
 * predate separable stories keep all their feedback visible, and nothing is rewritten
 * on disk to achieve that. Pass `null` for surfaces with no active story (the all-files
 * diff view), which see the whole store.
 */
function commentBelongsToStory(
  comment: Comment,
  storyId: string | null,
): boolean {
  return (
    storyId === null || comment.story === undefined || comment.story === storyId
  );
}

export function commentsForStory(
  comments: Comment[],
  storyId: string | null,
): Comment[] {
  return comments.filter((comment) => commentBelongsToStory(comment, storyId));
}

function saveComments(
  repo: string,
  comments: Comment[],
  expectedSourceDigest: string,
): void {
  const path = commentsPath(repo);
  const current = loadCommentsWithHealth(repo);
  if (current.health.status === "invalid")
    throw new InvalidCommentStoreError(current.health);
  if (current.sourceDigest !== expectedSourceDigest) {
    throw new Error(
      "Review feedback changed while it was being saved. Reload and try again.",
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(comments, null, 2) + "\n", "utf8");
}

function writableComments(repo: string): CommentLoadResult {
  const result = loadCommentsWithHealth(repo);
  if (result.health.status === "invalid")
    throw new InvalidCommentStoreError(result.health);
  return result;
}

export interface NewComment {
  story?: string;
  step?: string;
  file: string;
  line: number;
  side?: string;
  selectedText?: string;
  selection?: Partial<CommentSelection>;
  type: string;
  body: string;
  reviewRound?: number;
  reviewSnapshotId?: string;
}

/** Validate + persist a new comment. Returns the stored comment or throws. */
export function addComment(repo: string, input: NewComment): Comment {
  if (!input || typeof input.body !== "string" || !input.body.trim()) {
    throw new Error("Comment body is required.");
  }
  if (typeof input.file !== "string" || !input.file)
    throw new Error("comment file is required");
  assertSafeRepoPath(input.file);
  const type = TYPES.includes(input.type as CommentType)
    ? (input.type as CommentType)
    : "change";
  const comment: Comment = {
    id: nextId(),
    file: input.file,
    line: Number.isFinite(input.line) ? Math.trunc(input.line) : 0,
    type,
    body: input.body.trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };
  if (typeof input.story === "string" && input.story.trim())
    comment.story = input.story.trim();
  if (typeof input.step === "string" && input.step) comment.step = input.step;
  const side = cleanSide(input.side);
  if (side) comment.side = side;
  const selectedText = cleanSelectedText(input.selectedText);
  if (selectedText) comment.selectedText = selectedText;
  const selection = cleanSelection(input.selection);
  if (selection) comment.selection = selection;
  if (Number.isFinite(input.reviewRound) && Number(input.reviewRound) > 0) {
    comment.reviewRound = Math.trunc(Number(input.reviewRound));
  }
  if (
    typeof input.reviewSnapshotId === "string" &&
    input.reviewSnapshotId.trim()
  ) {
    comment.reviewSnapshotId = input.reviewSnapshotId.trim();
  }
  if (selectedText) {
    comment.anchorHash = createHash("sha256")
      .update(
        `${comment.file}\0${comment.side ?? "right"}\0${comment.line}\0${selectedText}`,
      )
      .digest("hex")
      .slice(0, 20);
  }

  const loaded = writableComments(repo);
  loaded.comments.push(comment);
  saveComments(repo, loaded.comments, loaded.sourceDigest);
  return comment;
}

export function deleteComment(
  repo: string,
  id: string,
  storyId?: string | null,
): boolean {
  const loaded = writableComments(repo);
  const target = loaded.comments.find((comment) => comment.id === id);
  if (!target) return false;
  if (storyId !== undefined && !commentBelongsToStory(target, storyId))
    return false;
  const next = loaded.comments.filter((comment) => comment.id !== id);
  saveComments(repo, next, loaded.sourceDigest);
  return true;
}

export interface CommentUpdate {
  type?: string;
  body?: string;
  status?: string;
}

/** Edit the reviewer-owned fields of an already queued comment. */
export function updateComment(
  repo: string,
  id: string,
  input: CommentUpdate,
  storyId?: string | null,
): Comment | null {
  if (
    !input ||
    (input.type === undefined &&
      input.body === undefined &&
      input.status === undefined)
  ) {
    throw new Error("comment type, status, or body is required");
  }
  const loaded = writableComments(repo);
  const target = loaded.comments.find((comment) => comment.id === id);
  if (!target) return null;
  if (storyId !== undefined && !commentBelongsToStory(target, storyId))
    return null;
  if (input.type !== undefined) {
    if (!TYPES.includes(input.type as CommentType))
      throw new Error(`type must be one of ${TYPES.join(", ")}`);
    target.type = input.type as CommentType;
    delete target.severity;
  }
  if (input.body !== undefined) {
    if (typeof input.body !== "string" || !input.body.trim())
      throw new Error("Comment body is required.");
    target.body = input.body.trim();
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as CommentStatus)) {
      throw new Error(`status must be one of ${STATUSES.join(", ")}`);
    }
    target.status = input.status as CommentStatus;
  }
  saveComments(repo, loaded.comments, loaded.sourceDigest);
  return target;
}

function invalidLoad(
  reason: Extract<CommentStoreHealth, { status: "invalid" }>["reason"],
  message: string,
  raw: string | null,
  entryIndex?: number,
): CommentLoadResult {
  return {
    comments: [],
    health: {
      status: "invalid",
      reason,
      message,
      recovery: INVALID_RECOVERY,
      ...(entryIndex === undefined ? {} : { entryIndex }),
    },
    sourceDigest: hashSource(raw),
  };
}

function hashSource(raw: string | null): string {
  return createHash("sha256")
    .update(raw === null ? "\0missing-or-unreadable" : raw)
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && !!value.trim();
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function positiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function validateStoredComment(
  value: unknown,
  seen: Set<string>,
): string | null {
  if (!isRecord(value)) return "each comment must be an object";
  if (!nonEmptyString(value.id)) return "id must be a non-empty string";
  const id = value.id as string;
  if (seen.has(id)) return `duplicate id ${JSON.stringify(id)}`;
  seen.add(id);
  if (!nonEmptyString(value.file)) return "file must be a non-empty string";
  if (!Number.isInteger(value.line) || Number(value.line) < 0)
    return "line must be a non-negative integer";
  if (!TYPES.includes(value.type as CommentType))
    return `type must be one of ${TYPES.join(", ")}`;
  if (
    value.severity !== undefined &&
    !SEVERITIES.includes(value.severity as CommentSeverity)
  ) {
    return `severity must be one of ${SEVERITIES.join(", ")}`;
  }
  if (!nonEmptyString(value.body)) return "body must be a non-empty string";
  if (!STATUSES.includes(value.status as CommentStatus))
    return `status must be one of ${STATUSES.join(", ")}`;
  if (!nonEmptyString(value.createdAt))
    return "createdAt must be a non-empty string";
  if (!optionalString(value.story))
    return "story must be a string when present";
  if (!optionalString(value.step)) return "step must be a string when present";
  if (value.side !== undefined && !SIDES.includes(value.side as CommentSide)) {
    return `side must be one of ${SIDES.join(", ")}`;
  }
  if (!optionalString(value.selectedText))
    return "selectedText must be a string when present";
  if (!optionalString(value.reviewSnapshotId))
    return "reviewSnapshotId must be a string when present";
  if (!optionalString(value.anchorHash))
    return "anchorHash must be a string when present";
  if (!optionalString(value.reply))
    return "reply must be a string when present";
  if (value.reviewRound !== undefined && !positiveInteger(value.reviewRound)) {
    return "reviewRound must be a positive integer when present";
  }
  if (value.selection !== undefined) {
    if (!isRecord(value.selection))
      return "selection must be an object when present";
    if (
      !positiveInteger(value.selection.startLine) ||
      !positiveInteger(value.selection.endLine)
    ) {
      return "selection lines must be positive integers";
    }
    if (
      value.selection.startColumn !== undefined &&
      !positiveInteger(value.selection.startColumn)
    ) {
      return "selection startColumn must be a positive integer when present";
    }
    if (
      value.selection.endColumn !== undefined &&
      !positiveInteger(value.selection.endColumn)
    ) {
      return "selection endColumn must be a positive integer when present";
    }
  }
  if (value.turns !== undefined) {
    if (!Array.isArray(value.turns))
      return "turns must be an array when present";
    for (let index = 0; index < value.turns.length; index++) {
      const turn = value.turns[index];
      if (!isRecord(turn)) return `turn ${index} must be an object`;
      if (turn.role !== "user" && turn.role !== "ai")
        return `turn ${index} has an invalid role`;
      if (!nonEmptyString(turn.text))
        return `turn ${index} text must be a non-empty string`;
      if (!nonEmptyString(turn.at))
        return `turn ${index} at must be a non-empty string`;
    }
  }
  return null;
}

function nextId(): string {
  return (
    "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  );
}

function cleanSelectedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text ? text : undefined;
}

function cleanSide(value: unknown): CommentSide | undefined {
  return SIDES.includes(value as CommentSide)
    ? (value as CommentSide)
    : undefined;
}

function positiveInt(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const n = Math.trunc(value as number);
  return n > 0 ? n : undefined;
}

function cleanSelection(value: unknown): CommentSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<CommentSelection>;
  const startLine = positiveInt(raw.startLine);
  const endLine = positiveInt(raw.endLine);
  if (!startLine || !endLine) return undefined;
  const selection: CommentSelection = {
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
  };
  const startColumn = positiveInt(raw.startColumn);
  const endColumn = positiveInt(raw.endColumn);
  if (startColumn) selection.startColumn = startColumn;
  if (endColumn) selection.endColumn = endColumn;
  return selection;
}
