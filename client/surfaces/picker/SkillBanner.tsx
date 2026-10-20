// The story-generation skill readiness banner.
//
// Three branches, in this order — the order matters, and the strings are the
// only guidance a user gets when generation is about to fail:
//
//   1. `legacyInstalled` — a copy under a retired storyteller name is still
//      on disk; `legacyNames` says which, so the sentence names the rename.
//      Shown first because it is the migration case, and it stays visible even
//      when a current copy is also installed.
//   2. `current`         — everything matches; the banner disappears entirely.
//   3. otherwise         — installed-but-stale, or not found at all.
//
// The banner is fetched, not server-rendered: `GET /api/agents` runs on mount
// and its failure is swallowed on purpose. A picker that cannot reach its own
// skills endpoint should still let you open a repository.

import { useEffect, useState, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
// Imported from `button/base` rather than the barrel: the barrel also pulls in
// StatefulButton and MagneticButton, which this surface never renders.
import { Button } from "../../vendor/beui/motion/button/base";
// The shimmer is adopted at the primitive level rather than through
// `motion/text-shimmer.tsx`. That component renders its `<style>` element as a
// sibling of the shimmering text, and here the text lives inside a
// `role="status" aria-atomic="true"` region — which would put a stylesheet's
// worth of CSS into the region's own content. Verified in Chrome: the region's
// textContent read back as "@keyframes beui-text-shimmer{…". Same keyframes,
// same class, same duration helper; only the <style> moves out of the region.
import {
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from "../../vendor/beui/lib/text-shimmer";
import { requestJson } from "../../shared/api";
import { cn } from "../../shared/cn";

// The gradient is painted from `--muted-foreground` / `--foreground`, two of the
// shadcn names the Signal theme bridge does not define. Custom properties
// inherit, so declaring them on the shimmering span is enough — without this the
// gradient resolves to nothing and `text-transparent` leaves a blank line.
const SHIMMER_INK = {
  "--muted-foreground": "var(--text-3)",
  "--foreground": "var(--text)",
} as CSSProperties;

/** The subset of `SkillStatus` (src/repo-setup.ts) this banner reads. */
export interface SkillState {
  installed?: boolean;
  current?: boolean;
  legacyInstalled?: boolean;
  /** Retired storyteller names still installed, oldest first. */
  legacyNames?: string[];
}

interface AgentsResponse {
  skills?: SkillState;
}

interface SkillUpdateResponse {
  skills?: SkillState;
}

const STALE_TEXT =
  "The storyteller skill is installed but does not match this app. Update it before generating so the agent sees the current story rules.";
const MISSING_TEXT =
  "The storyteller skill was not found in ~/.agents, ~/.claude, or ~/.codex. Install it before generating so the agent can create stories reliably.";
const UPDATING_TEXT = "Installing bundled codeStory skills locally…";
const FAILED_TEXT =
  "Could not update skills. Run scripts/install-skills.sh from a codeStory clone, or re-run the codeStory installer.";

/** The migration sentence, naming each retired copy the server found. */
function legacyText(names: readonly string[] = []): string {
  const retired = names.length ? names.join(" and ") : "An older storyteller skill";
  const many = names.length > 1;
  return `${retired} ${many ? "were" : "was"} renamed to codestory-storyteller. Update skills to remove the retired ${many ? "copies" : "copy"} and finish migration.`;
}

function describe(skills: SkillState): string | null {
  if (skills.legacyInstalled) return legacyText(skills.legacyNames);
  if (skills.current) return null;
  return skills.installed ? STALE_TEXT : MISSING_TEXT;
}

export function SkillBanner() {
  const [skills, setSkills] = useState<SkillState | null>(null);
  const [override, setOverride] = useState<{ text: string; label: string; busy: boolean } | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    let live = true;
    requestJson<AgentsResponse>("/api/agents")
      .then((data) => {
        if (live && data?.skills) setSkills(data.skills);
      })
      // Deliberately silent: the picker's job is opening repositories.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const update = () => {
    setOverride({ text: UPDATING_TEXT, label: "Updating…", busy: true });
    requestJson<SkillUpdateResponse>("/api/skills/update", { method: "POST" })
      .then((data) => {
        if (!data?.skills) throw new Error("bad response");
        setSkills(data.skills);
        setOverride(null);
      })
      .catch(() => setOverride({ text: FAILED_TEXT, label: "Try again", busy: false }));
  };

  if (!skills && !override) return null;
  const settled = skills ? describe(skills) : null;
  if (!override && !settled) return null;

  const text = override?.text ?? settled ?? "";
  const label = override?.label ?? "Update skills";

  // The install is the one branch with no other progress signal — no spinner, no
  // percentage — so the sentence itself carries it. The shimmer is movement, so
  // reduced motion gets the plain string.
  const shimmering = Boolean(override?.busy) && !reduce;

  return (
    <>
      {shimmering ? <style>{TEXT_SHIMMER_KEYFRAMES}</style> : null}
      <p className="mt-3.5 flex items-center gap-2.5 border-t border-line-soft px-0.5 pt-2.5 text-sm leading-[1.45] text-text-2 contrast-more:border-text">
        {/* Polite + atomic: the text is replaced wholesale, so a partial read
            would be misleading. */}
        <span className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          {shimmering ? (
            <span
              className={cn("inline-block", TEXT_SHIMMER_CLASS_NAME)}
              style={{ ...SHIMMER_INK, ...textShimmerStyle(2.2) }}
            >
              {text}
            </span>
          ) : (
            text
          )}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          pressScale={0.97}
          disabled={override?.busy ?? false}
          onClick={update}
          className="h-auto flex-none rounded-full bg-fill-1 px-3 py-1.5 text-sm font-semibold text-text-2 hover:bg-fill-2 hover:text-text disabled:opacity-55"
        >
          {label}
        </Button>
      </p>
    </>
  );
}
