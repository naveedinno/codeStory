import { Download, Film, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VideoJob, VideoOptions } from "../../../src/video-types";
import { ApiError, failureMessage, requestJson } from "../../shared/api";

interface Requirements { available: boolean; narration: boolean; missing: string[] }

/** A separate React island; exporting never drives the user's live reader. */
export function VideoExport({ pageToken }: { pageToken: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(false);
  const [resolution, setResolution] = useState<VideoOptions["resolution"]>("1080p");
  const [narration, setNarration] = useState(false);
  const [speed, setSpeed] = useState(1);
  const active = job?.state === "rendering" || job?.state === "encoding";
  const url = (path = "") => `/api/video-export${path}?page=${encodeURIComponent(pageToken)}`;

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    requestJson<Requirements>("/api/video-export/capabilities", { signal: controller.signal })
      .then(setRequirements).catch(cause => { if (!controller.signal.aborted) setError(failureMessage(cause)); });
    return () => controller.abort();
  }, [open]);

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

  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus(); };
  const start = async () => {
    if (busy || active) return;
    setBusy(true); setError(""); setReload(false); setJob(null);
    try {
      setJob(await requestJson<VideoJob>(url(), { method: "POST", body: { resolution, narration, speed,
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
    <button ref={trigger} type="button" className="ds-video-export-trigger" onClick={() => setOpen(true)}
      aria-haspopup="dialog" aria-label={active ? "Video export progress" : "Export video"} title="Export story as a video">
      <Film size={16} aria-hidden="true" /><span>{active ? "Exporting…" : "Export video"}</span>
    </button>
    <dialog ref={dialog} className="ds-video-export" aria-labelledby="ds-video-export-title"
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
        <label className="ds-video-export-narration"><input type="checkbox" checked={narration} disabled={!requirements?.narration}
          onChange={event => setNarration(event.target.checked)} />Include narration with the macOS system voice</label>
      </fieldset>
      <p className="ds-video-export-detail">MP4 · Subtitle track included · Uses the current theme. Toggle subtitles in your player’s subtitle menu. Narration uses the system voice separately from read-aloud. Online resources in concept pages are omitted. Code and explanations shown here will be included in the file.</p>
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
          <button type="button" className="ds-btn ds-btn-solid" disabled={busy || !requirements?.available} onClick={start}>{busy ? "Starting…" : "Create video"}</button>}
      </div>
    </dialog>
  </>;
}
