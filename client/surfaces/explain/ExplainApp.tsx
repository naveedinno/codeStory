// "Explain code" — ask for a code story.
//
// A code story explains existing code at one commit: there is no diff. This
// page collects what the reader wants to understand, an optional place to
// start, the ref to explain, and how deep to go, then hands the run to the
// shared progress panel and opens the finished story.
//
// Writers and their quality choices load at runtime from the same endpoints
// the diff generator uses, so the page never guesses at what is installed.
// While a run is live the panel IS the page: the form steps aside, and comes
// back with its values intact if the reader wants to change the request.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { ExplainPayload } from "../../../src/payloads";
import type { StoryAudience, StoryMode } from "../../../src/types";
import { cn } from "../../shared/cn";
import { Nav, navActionClass } from "../../shared/nav";
import {
  ProgressPanel,
  progressPrimaryActionClass,
  progressSecondaryActionClass,
  runProgress,
  useProgressRun,
} from "../progress";

type Writer = "claude" | "codex";

interface QualityChoice {
  label: string;
  model: string;
  description: string;
}

interface WriterSkill {
  dir?: string;
  installed?: boolean;
  current?: boolean;
}

interface SkillState extends WriterSkill {
  legacyInstalled?: boolean;
  agents?: Partial<Record<Writer, WriterSkill>>;
}

const DEPTHS: Array<{ value: StoryMode; title: string; badge: string; desc: string }> = [
  { value: "brief", title: "Quick tour", badge: "Shortest", desc: "The fewest stops that still answer the question." },
  { value: "guided", title: "Guided tour", badge: "Recommended", desc: "One stop per idea, with the context each one needs." },
  {
    value: "detailed",
    title: "Deep dive",
    badge: "Most detail",
    desc: "Smaller stops for every guard, branch, state write, and test on the path.",
  },
];

const AUDIENCES: Array<{ value: StoryAudience; title: string; desc: string }> = [
  { value: "newcomer", title: "Newcomer", desc: "Full landings and primers for anything unfamiliar." },
  { value: "familiar", title: "Familiar", desc: "Terse landings; primers only for ideas a regular would not know." },
];

// Mirrors the diff generator's defaults; Codex's real catalog replaces its entry.
const DEFAULT_QUALITY: Record<Writer, QualityChoice[]> = {
  claude: [
    { label: "Best quality", model: "opus", description: "The strongest available model for the clearest story" },
    { label: "Lower cost", model: "haiku", description: "A smaller model for a faster, cheaper run" },
  ],
  codex: [{ label: "Codex default", model: "", description: "The default model from your installed Codex app" }],
};

const WRITER_LABEL: Record<Writer, string> = { claude: "Claude", codex: "Codex" };

const KICKER = "font-mono text-xs font-medium tracking-[var(--tracking-kicker)] uppercase";
const LABEL = "text-[13px] font-semibold text-text";
const HELP = "m-0 text-xs leading-[1.45] text-text-3 contrast-more:text-text";
const FIELD = cn(
  "w-full rounded-[var(--radius-lg)] border border-line-soft bg-fill-1 px-3 py-2.5 text-base text-text",
  "placeholder:text-text-3 focus:border-accent-line focus:shadow-[var(--shadow-focus)] focus:outline-none",
  "contrast-more:border-text",
);
// A native radio, visually hidden; the tile beside it carries the state.
const CHOICE_TILE = cn(
  "flex h-full cursor-pointer flex-col gap-1 rounded-[var(--radius)] border border-transparent px-3 py-2.5 text-start text-text-2",
  "transition-[background-color,border-color] duration-[var(--motion-duration-fast)] ease-out motion-reduce:transition-none",
  "hover:bg-fill-2 hover:text-text",
  "peer-checked:border-accent-line peer-checked:bg-accent-soft peer-checked:text-text",
  "peer-focus-visible:shadow-[var(--shadow-focus)] contrast-more:border-text",
);
const TRACK = "grid gap-1 rounded-[var(--radius-lg)] border border-line-soft bg-fill-1 p-1 contrast-more:border-text";

/** A ref that is itself a commit id is a fixed point, not "the current code". */
const isCommitId = (ref: string) => /^[0-9a-f]{7,40}$/i.test(ref);

function initialRef(payload: ExplainPayload): string {
  const old = payload.prefill?.ref;
  if (old && !isCommitId(old)) return old;
  return payload.branch ?? "HEAD";
}

function Choice<T extends string>({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: T;
  checked: boolean;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative block min-w-0">
      <input
        className="peer sr-only"
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className={CHOICE_TILE}>{children}</span>
    </label>
  );
}

export function ExplainApp({ payload }: { payload: ExplainPayload }) {
  const { repoName, routeBase, branch, headCommit, headSubject, dirty, defaults, prefill, notice } = payload;
  const [question, setQuestion] = useState(prefill?.question ?? "");
  const [paths, setPaths] = useState((prefill?.paths ?? []).join("\n"));
  const [ref, setRef] = useState(() => initialRef(payload));
  const [mode, setMode] = useState<StoryMode>(prefill?.mode ?? defaults.mode);
  const [audience, setAudience] = useState<StoryAudience>(defaults.audience);
  const [writers, setWriters] = useState<Writer[] | null>(null);
  const [writerError, setWriterError] = useState("");
  const [writer, setWriter] = useState<Writer | "">("");
  const [quality, setQuality] = useState<Record<Writer, QualityChoice[]>>(DEFAULT_QUALITY);
  const [model, setModel] = useState("");
  const [skills, setSkills] = useState<SkillState | null>(null);
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [running, setRunning] = useState(false);
  const [foot, setFoot] = useState<ReactNode>(null);
  const controller = useRef<AbortController | null>(null);
  const submitRef = useRef<() => void>(() => {});

  const backToForm = () => {
    run.close();
    setFoot(null);
    setRunning(false);
  };
  const recovery = (
    <>
      <button type="button" className={progressPrimaryActionClass} onClick={() => submitRef.current()}>
        Try again
      </button>
      <button type="button" className={progressSecondaryActionClass} onClick={backToForm}>
        Change the request
      </button>
    </>
  );
  const run = useProgressRun({
    onStop: () => controller.current?.abort(),
    onClose: backToForm,
    onDone: (status, result) => {
      controller.current = null;
      if (status === "complete" && result.storyWritten && typeof result.storyId === "string") {
        window.location.href = `${routeBase}/review?story=${encodeURIComponent(result.storyId)}`;
        return;
      }
      if (status === "stopped") {
        backToForm();
        return;
      }
      setFoot(recovery);
    },
    onBlocked: () => {
      controller.current = null;
      setFoot(recovery);
    },
  });

  useEffect(() => {
    let live = true;
    fetch("/api/agents")
      .then((response) => response.json())
      .then((body: { agents?: string[]; skills?: SkillState }) => {
        if (!live) return;
        const found = (body.agents ?? []).filter((agent): agent is Writer => agent === "claude" || agent === "codex");
        setWriters(found);
        setSkills(body.skills ?? null);
        if (!found.length) {
          setWriterError("No local writer found. Install Claude or Codex, then reload this page.");
          return;
        }
        const first = found.includes("codex") ? "codex" : found[0];
        setWriter(first);
        setModel(DEFAULT_QUALITY[first][0]?.model ?? "");
        if (found.includes("codex")) {
          fetch("/api/codex/models")
            .then((response) => (response.ok ? response.json() : null))
            .then((models: { models?: QualityChoice[] } | null) => {
              const list = (models?.models ?? []).filter((item) => item && item.label && item.model);
              if (!live || !list.length) return;
              setQuality((current) => ({ ...current, codex: list }));
              setModel((current) => (first === "codex" && !current ? list[0].model : current));
            })
            .catch(() => {
              // The Codex default above stays valid when the catalog is unavailable.
            });
        }
      })
      .catch(() => {
        if (!live) return;
        setWriters([]);
        setWriterError("Could not check local writers. Reload the page to try again.");
      });
    return () => {
      live = false;
    };
  }, []);

  const pickWriter = (next: Writer) => {
    setWriter(next);
    setModel(quality[next][0]?.model ?? "");
  };

  const updateSkills = () => {
    setSkillsBusy(true);
    setSkillsError("");
    fetch("/api/skills/update", { method: "POST" })
      .then((response) => response.json())
      .then((body: { skills?: SkillState }) => {
        if (!body.skills) throw new Error("bad response");
        setSkills(body.skills);
      })
      .catch(() =>
        setSkillsError("Could not update skills. Run scripts/install-skills.sh from a codeStory clone."),
      )
      .finally(() => setSkillsBusy(false));
  };

  const start = () => {
    if (!writer || !headCommit) return;
    const abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    controller.current = abort;
    setFoot(null);
    setRunning(true);
    run.start();
    void runProgress(
      run,
      "/api/generate/code",
      {
        question: question.trim() || undefined,
        paths: paths
          .split(/[\n,]/)
          .map((path) => path.trim())
          .filter(Boolean),
        ref: ref.trim() || undefined,
        mode,
        audience,
        agent: writer,
        model: model || undefined,
        ...(prefill ? { storyId: prefill.storyId } : {}),
      },
      abort?.signal,
    );
  };
  submitRef.current = start;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start();
  };

  const writerSkill = writer && skills?.agents?.[writer] ? skills.agents[writer] : skills;
  const skillsStale = !!skills && (skills.legacyInstalled || !writerSkill?.current);
  const refIsHead = ref.trim() === "" || ref.trim() === "HEAD" || (!!branch && ref.trim() === branch);
  const ready = !!writer && !!headCommit && !running;

  return (
    <>
      <Nav
        home="/repos"
        crumbs={[{ label: repoName, href: `${routeBase}/stories` }, { label: "Explain code" }]}
        right={
          <a className={navActionClass} href={`${routeBase}/stories`}>
            History
          </a>
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[760px] px-6 pt-6 pb-12 max-[600px]:px-3.5 max-[600px]:pt-5 max-[600px]:pb-8"
      >
        <header className="mb-[18px]">
          <p className={cn(KICKER, "m-0 mb-[7px] text-accent-text")}>Code story</p>
          <h1 className="m-0 font-display text-[26px] font-bold tracking-[-.02em] text-balance max-[600px]:text-2xl">
            Explain the code
          </h1>
          <p className="m-0 mt-2 max-w-[62ch] text-sm leading-[1.45] text-pretty text-text-2 contrast-more:text-text">
            Ask what you want to understand. The agent reads the code at one commit and writes a guided walkthrough
            you can read or listen to. It changes nothing.
          </p>
        </header>

        {notice ? (
          <div className="mb-4 rounded-[var(--radius-lg)] border border-amber bg-amber-soft px-[15px] py-3 text-base leading-[1.5] text-text contrast-more:border-text">
            {notice}
          </div>
        ) : null}

        {prefill ? (
          <div className="mb-4 rounded-[var(--radius-lg)] border border-accent-line bg-accent-soft px-[15px] py-3 text-base leading-[1.5] text-text contrast-more:border-text">
            Rewriting “{prefill.title}” at the current code. The version you have now stays in its history.
          </div>
        ) : null}

        {!headCommit ? (
          <div className="mb-4 rounded-[var(--radius-lg)] border border-amber bg-amber-soft px-[15px] py-3 text-base leading-[1.5] text-text contrast-more:border-text">
            This repository has no commits yet. Commit some code, then come back to explain it.
          </div>
        ) : null}

        {running ? (
          <ProgressPanel run={run} variant="stage" foot={foot} />
        ) : (
          <form
            onSubmit={submit}
            aria-label="Code story request"
            className="grid gap-5 rounded-[var(--radius-island)] border border-transparent bg-surface-2 p-5 max-[600px]:p-3.5 contrast-more:border-text"
          >
            <label className="grid gap-1.5">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={LABEL}>What do you want to understand?</span>
                <span className="text-xs text-text-3">Optional</span>
              </span>
              <textarea
                name="question"
                rows={4}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                aria-describedby="explainQuestionHelp"
                placeholder="How does a quote become an open position? Which checks can refuse it?"
                className={cn(FIELD, "min-h-[96px] resize-y leading-[1.5]")}
              />
              <p className={HELP} id="explainQuestionHelp">
                Leave it empty for a guided tour of the whole codebase.
              </p>
            </label>

            <label className="grid gap-1.5">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={LABEL}>Start from</span>
                <span className="text-xs text-text-3">Optional</span>
              </span>
              <textarea
                name="paths"
                rows={2}
                value={paths}
                onChange={(event) => setPaths(event.target.value)}
                aria-describedby="explainPathsHelp"
                placeholder={"contracts/facets/PartyB\nsrc/settlement.ts"}
                spellCheck={false}
                className={cn(FIELD, "resize-y font-mono text-sm leading-[1.6]")}
              />
              <p className={HELP} id="explainPathsHelp">
                Files or folders, one per line. The story leaves them only when the explanation needs a caller, a
                type, or a test that lives elsewhere.
              </p>
            </label>

            <label className="grid gap-1.5">
              <span className={LABEL}>Code at</span>
              <input
                name="ref"
                type="text"
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                aria-describedby="explainRefHelp"
                spellCheck={false}
                autoComplete="off"
                className={cn(FIELD, "font-mono text-sm")}
              />
              <p className={HELP} id="explainRefHelp">
                {refIsHead && headSubject
                  ? `A branch, tag, or commit. This one is ${headSubject}.`
                  : "A branch, tag, or commit. The story is pinned to it, so its line numbers never drift."}
              </p>
              {dirty && refIsHead ? (
                <p className="m-0 text-xs leading-[1.45] text-amber-text">
                  Uncommitted changes are not part of the story; it explains the last commit.
                </p>
              ) : null}
            </label>

            <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
              <legend className={cn(LABEL, "mb-1.5 p-0")}>Depth</legend>
              <div className={cn(TRACK, "grid-cols-3 max-[600px]:grid-cols-1")}>
                {DEPTHS.map((depth) => (
                  <Choice key={depth.value} name="mode" value={depth.value} checked={mode === depth.value} onChange={setMode}>
                    <span className="flex flex-wrap items-center justify-between gap-1.5">
                      <strong className="text-[13px] font-bold text-text">{depth.title}</strong>
                      <span className={cn(KICKER, "text-[10px] text-text-3")}>{depth.badge}</span>
                    </span>
                    <span className="text-sm leading-[1.35]">{depth.desc}</span>
                  </Choice>
                ))}
              </div>
            </fieldset>

            <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
              <legend className={cn(LABEL, "mb-1.5 p-0")}>Audience</legend>
              <div className={cn(TRACK, "grid-cols-2 max-[600px]:grid-cols-1")}>
                {AUDIENCES.map((option) => (
                  <Choice
                    key={option.value}
                    name="audience"
                    value={option.value}
                    checked={audience === option.value}
                    onChange={setAudience}
                  >
                    <strong className="text-[13px] font-bold text-text">{option.title}</strong>
                    <span className="text-sm leading-[1.35]">{option.desc}</span>
                  </Choice>
                ))}
              </div>
              <p className={HELP}>Your choice is remembered for this repository.</p>
            </fieldset>

            <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
              <legend className={cn(LABEL, "mb-1.5 p-0")}>Writer</legend>
              {writers === null ? (
                <p className={HELP} role="status">
                  Checking available writers…
                </p>
              ) : writerError ? (
                <p className="m-0 text-sm text-danger-text" role="alert">
                  {writerError}
                </p>
              ) : (
                <div className="grid gap-2">
                  <div className={cn(TRACK, writers.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                    {writers.map((name) => (
                      <Choice key={name} name="writer" value={name} checked={writer === name} onChange={pickWriter}>
                        <strong className="text-[13px] font-bold text-text">{WRITER_LABEL[name]}</strong>
                      </Choice>
                    ))}
                  </div>
                  {writer && quality[writer].length > 1 ? (
                    <div className={cn(TRACK, "grid-cols-2")} role="radiogroup" aria-label="Quality">
                      {quality[writer].map((choice) => (
                        <Choice key={choice.model || choice.label} name="model" value={choice.model} checked={model === choice.model} onChange={setModel}>
                          <strong className="text-[13px] font-bold text-text">{choice.label}</strong>
                          <span className="text-sm leading-[1.35]">{choice.description}</span>
                        </Choice>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              {skillsStale ? (
                <p className="m-0 flex flex-wrap items-center gap-2 text-xs leading-[1.45] text-amber-text">
                  <span>
                    {skills?.legacyInstalled
                      ? "An old copy of the storyteller skill is still installed. Update skills before writing."
                      : writerSkill?.installed
                        ? "The storyteller skill on this machine does not match the app. Update it so the writer knows about code stories."
                        : "The storyteller skill is not installed. Install it so the writer can write code stories."}
                  </span>
                  <button
                    type="button"
                    onClick={updateSkills}
                    disabled={skillsBusy}
                    className="rounded-full border border-line px-2.5 py-1 font-semibold text-text hover:bg-fill-2 disabled:opacity-55"
                  >
                    {skillsBusy ? "Updating…" : "Update skills"}
                  </button>
                  {skillsError ? <span className="text-danger-text">{skillsError}</span> : null}
                </p>
              ) : null}
            </fieldset>

            <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
              <button
                type="submit"
                disabled={!ready}
                className={cn(
                  "inline-flex h-[var(--control-h-lg)] items-center gap-[7px] rounded-full bg-accent px-4 text-base font-semibold text-on-accent",
                  "transition-colors duration-[var(--motion-duration-fast)] ease-out hover:bg-accent-solid-hover motion-reduce:transition-none",
                  "focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55",
                )}
              >
                {prefill ? "Rewrite code story" : "Write code story"}
                <ArrowRight className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="text-sm text-text-3">
                Saved to Review history. Nothing in the repository changes.
              </span>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
