import { Download, Film, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VideoJob, VideoOptions } from "../../../src/video-types";
import type { AloudModel, AloudStatus } from "../../../src/narration-types";
import { ApiError, failureMessage, requestJson } from "../../shared/api";

interface Requirements { available: boolean; narration: boolean; lino: boolean; missing: string[] }

/** A separate React island; exporting never drives the user's live reader. */
export function VideoExport({ pageToken }: { pageToken: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const desktop = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(false);
  const [resolution, setResolution] = useState<VideoOptions["resolution"]>("1080p");
  const [narration, setNarration] = useState<"none" | "lino" | "system">("none");
  const [speed, setSpeed] = useState(1);
  const [models, setModels] = useState<AloudModel[]>([]);
  const [lino, setLino] = useState<VideoOptions["lino"]>();
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const rememberedVoices = useRef<Record<string, string>>({});
  const model = models.find(model => model.id === lino?.engine);
  const voiceReady = model?.ready && model.languages.includes("en") && model.voices.some(voice => voice.id === lino?.voice);
  const active = job?.state === "rendering" || job?.state === "encoding";
  const url = (path = "") => `/api/video-export${path}?page=${encodeURIComponent(pageToken)}`;

  const show = () => {
    returnFocus.current = desktop ? document.activeElement as HTMLElement : trigger.current;
    if (menu.current) menu.current.open = false;
    setOpen(true);
  };

  useEffect(() => {
    const nativeOpen = () => {
      returnFocus.current = document.activeElement as HTMLElement;
      setOpen(true);
    };
    const dismiss = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("codestory:export-video", nativeOpen);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("codestory:export-video", nativeOpen);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    requestJson<Requirements>("/api/video-export/capabilities", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setRequirements(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(failureMessage(cause)); });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open || narration !== "lino") return;
    const controller = new AbortController();
    setLoadingVoices(true); setVoiceError("");
    requestJson<{ models: AloudModel[]; status: AloudStatus }>("/api/aloud/settings", { signal: controller.signal })
      .then(({ models, status }) => {
        if (controller.signal.aborted) return;
        setModels(models);
        setLino(previous => {
          const ready = models.filter(model => model.ready && model.languages.includes("en"));
          const selected = ready.find(model => model.id === previous?.engine) ?? ready.find(model => model.id === status.engine) ?? ready[0];
          if (!selected) return undefined;
          const preferred = previous?.engine === selected.id ? previous.voice
            : rememberedVoices.current[selected.id] ?? (status.engine === selected.id ? status.voice : undefined);
          return { engine: selected.id, voice: selected.voices.find(voice => voice.id === preferred)?.id ?? selected.voices[0]!.id };
        });
      })
      .catch(cause => { if (!controller.signal.aborted) setVoiceError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingVoices(false); });
    return () => controller.abort();
  }, [open, narration]);

  useEffect(() => {
    if (!active || !job) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await requestJson<VideoJob>(url(`/${job.id}`), { signal: controller.signal });
        setJob(next); setError("");
        if (["rendering", "encoding"].includes(next.state)) timer = setTimeout(poll, 1000);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(failureMessage(cause));
          if (cause instanceof ApiError && cause.status === 404) setJob(null);
          else timer = setTimeout(poll, 2500);
        }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
    // One polling loop per job, including while the dialog is closed.
  }, [active, job?.id, pageToken]);

  const close = () => { dialog.current?.close(); setOpen(false); returnFocus.current?.focus(); };
  const chooseModel = (engine: string) => {
    if (lino) rememberedVoices.current[lino.engine] = lino.voice;
    const selected = models.find(model => model.id === engine);
    if (selected) setLino({ engine, voice: selected.voices.find(voice => voice.id === rememberedVoices.current[engine])?.id ?? selected.voices[0]!.id });
  };
  const start = async () => {
    if (busy || active) return;
    setBusy(true); setError(""); setReload(false); setJob(null);
    try {
      setJob(await requestJson<VideoJob>(url(), { method: "POST", body: { resolution, narration: narration !== "none",
        narrationEngine: narration === "none" ? undefined : narration, speed,
        lino: narration === "lino" ? lino : undefined,
        theme: document.documentElement.dataset.theme === "light" ? "light" : "dark" } }));
    } catch (cause) { setError(failureMessage(cause)); setReload(cause instanceof ApiError && cause.reloadRequired); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!job || busy) return;
    setBusy(true); setError("");
    try { setJob(await requestJson<VideoJob>(url(`/${job.id}`), { method: "DELETE" })); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(false); }
  };

  return <>
    {!desktop && <details ref={menu} className="ds-review-file-menu" onToggle={() => {
      setMenuOpen(menu.current?.open ?? false);
      if (menu.current?.open) menu.current.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    }} onKeyDown={event => {
      if (event.key === "Escape" && menu.current?.open) { event.preventDefault(); event.stopPropagation(); menu.current.open = false; trigger.current?.focus(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); if (menu.current) menu.current.open = true;
        menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
      } else if (event.key === "Tab" && menu.current?.open) menu.current.open = false;
    }}>
      <summary ref={trigger} role="button" aria-label="File menu" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="ds-review-file-actions">File</summary>
      <div id="ds-review-file-actions" role="menu" aria-label="File"><button type="button" role="menuitem" onClick={show}>
        <Film size={16} aria-hidden="true" />{active ? "Video export progress…" : "Export video…"}
      </button></div>
    </details>}
    <dialog ref={dialog} className="ds-video-export" data-video-export-dialog aria-labelledby="ds-video-export-title"
      onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()}>
      <div className="ds-video-export-head">
        <div><h2 id="ds-video-export-title">Export video</h2><p>A shareable walkthrough of this story</p></div>
        <button type="button" aria-label="Close video export" onClick={close}><X size={18} aria-hidden="true" /></button>
      </div>
      <p>The video follows every story step and code spotlight, with concept pages and selectable subtitles. Everything is rendered on this device.</p>
      <fieldset disabled={active || busy}>
        <label>Resolution<select value={resolution} onChange={event => setResolution(event.target.value as VideoOptions["resolution"])}>
          <option value="1080p">1080p · 1920 × 1080</option><option value="720p">720p · 1280 × 720</option>
        </select></label>
        <label>Reading speed<select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          <option value={0.75}>0.75× · Slower</option><option value={1}>1× · Normal</option><option value={1.25}>1.25×</option><option value={1.5}>1.5× · Faster</option>
        </select></label>
        <label>Narration<select value={narration} onChange={event => setNarration(event.target.value as typeof narration)}>
          <option value="none">None · Subtitles only</option>
          <option value="lino" disabled={!requirements?.lino}>Lino</option>
          <option value="system" disabled={!requirements?.narration}>macOS system voice</option>
        </select></label>
        {narration === "lino" && <>
          {loadingVoices ? <p className="ds-video-export-detail" role="status">Loading local voices…</p> : voiceError ?
            <p className="ds-video-export-error" role="alert">{voiceError}</p> : <>
              <label>Voice model<select value={lino?.engine ?? ""} onChange={event => chooseModel(event.target.value)}>
                {!model && <option value="" disabled>Choose a downloaded model</option>}
                {models.map(model => <option key={model.id} value={model.id} disabled={!model.ready || !model.languages.includes("en")}>
                  {model.name}{!model.languages.includes("en") ? " · Other languages" : !model.ready ? " · Download needed" : ""}
                </option>)}
              </select></label>
              <label>Voice<select value={lino?.voice ?? ""} disabled={!model} onChange={event => setLino({ engine: model!.id, voice: event.target.value })}>
                {!model && <option value="">Choose a model first</option>}
                {model?.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
              </select></label>
              {!models.some(model => model.ready && model.languages.includes("en")) && <p className="ds-video-export-detail">Download an English voice model in Lino → Settings → Read Aloud.</p>}
            </>}
        </>}
        {requirements && !requirements.lino && <p className="ds-video-export-detail">Install Lino and download an English voice to export with Lino narration.</p>}
      </fieldset>
      <p className="ds-video-export-detail">MP4 · Subtitle track included · Uses the current theme. Toggle subtitles in your player’s subtitle menu. Online resources in concept pages are omitted. Code and explanations shown here will be included in the file.</p>
      {!requirements && !error ? <p role="status">Checking video tools…</p> : null}
      {requirements?.missing.length ? <div className="ds-video-export-error" role="status">{requirements.missing.map(item => <p key={item}>{item}</p>)}</div> : null}
      {job ? <div className="ds-video-export-progress" role="status" aria-live="polite">
        <p>{job.message}</p>
        {active ? <progress max={Math.max(1, job.total)} value={job.state === "encoding" ? undefined : job.completed} aria-label="Video export progress" /> : null}
      </div> : null}
      {error ? <p role="alert" className="ds-video-export-error">{error}</p> : null}
      <div className="ds-video-export-actions">
        {active ? <><span>You can close this dialog while it exports.</span><button type="button" className="ds-btn" disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Cancel export"}</button></> :
          reload ? <button type="button" className="ds-btn ds-btn-solid" onClick={() => location.reload()}>Reload review</button> :
          job?.state === "ready" ? <><button type="button" className="ds-btn" onClick={() => setJob(null)}>New export</button><a className="ds-btn ds-btn-solid" href={url(`/${job.id}/file`)} download={job.filename}><Download size={15} aria-hidden="true" />Download MP4</a></> :
          <button type="button" className="ds-btn ds-btn-solid" disabled={busy || !requirements?.available || (narration === "lino" && (loadingVoices || !!voiceError || !voiceReady))} onClick={start}>{busy ? "Starting…" : "Create video"}</button>}
      </div>
    </dialog>
  </>;
}
