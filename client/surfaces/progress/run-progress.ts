// The NDJSON pump.
//
// `POST /api/generate` and `POST /api/story/repair` answer with a streaming body
// of newline-delimited `ProgressEvent` JSON. This is NOT `/api/events` — that is
// the review page's SSE channel and has nothing to do with a run.
//
// Three failure shapes, and they are not interchangeable:
//
//   * a non-2xx (or bodiless) response  → `blocked()`. The run never started, so
//     the panel says "Cannot start" and the host offers a way to fix the cause.
//   * an aborted fetch                  → `finish('stopped')`. The user pressed Stop.
//   * anything else thrown mid-stream   → `finish('failed')`.
//
// A malformed line is skipped, not fatal. The stream is a live agent's stdout
// wrapped by the server; one bad frame should cost one frame.

import type { ProgressEvent } from "../../../src/progress";
import type { ProgressRun } from "./use-progress-run";

/** Just enough of `ProgressRun` to drive; keeps this usable from a test harness. */
export type ProgressSink = Pick<ProgressRun, "handle" | "finish" | "blocked">;

export async function runProgress(
  run: ProgressSink,
  url: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) {
      let reason: unknown;
      try {
        reason = await response.json();
      } catch {
        reason = null;
      }
      run.blocked((reason as { label?: string }) || { label: "Could not start the run.", detail: "Check that Claude or Codex is installed, then try again." });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        if (buffer.trim()) {
          try {
            run.handle(JSON.parse(buffer) as ProgressEvent);
          } catch {
            // A truncated trailing frame is not worth failing the whole run over.
          }
        }
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: ProgressEvent;
        try {
          event = JSON.parse(line) as ProgressEvent;
        } catch {
          continue;
        }
        run.handle(event);
      }
    }
  } catch {
    if (signal?.aborted) run.finish("stopped", {});
    else run.finish("failed", {});
  }
}
