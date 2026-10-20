// This small React island owns only its settings popover. The review engine
// continues to own transport, passage focus, and playback polling.
import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { AloudModel, AloudSettingsPatch, AloudStatus } from '../../../src/narration-types';
import { failureMessage, requestJson } from '../../shared/api';

interface SettingsResponse { models: AloudModel[]; status: AloudStatus }

export function NarrationSettings() {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<AloudModel[]>([]);
  const [status, setStatus] = useState<AloudStatus | null>(null);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [position, setPosition] = useState({ left: 16, bottom: 110, maxHeight: 500 });
  const selected = models.find((model) => model.id === status?.engine);
  const selectedVoice = selected?.voices.find((voice) => voice.id === status?.voice);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setAnnouncement(''); setStatus(null);
    requestJson<SettingsResponse>('/api/aloud/settings', { signal: controller.signal, fallback: 'Could not load narration settings.' })
      .then((result) => { setModels(result.models); setStatus(result.status); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(failureMessage(cause, 'Could not load narration settings.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(16, Math.min(rect.left, innerWidth - 356)),
        bottom: Math.max(16, innerHeight - rect.top + 10), maxHeight: Math.max(120, rect.top - 26) });
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const apply = (patch: AloudSettingsPatch) => {
    if (busy) return;
    const focusTarget = panel.current?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    setBusy(true); setError(''); setAnnouncement('Applying narration settings…');
    requestJson<{ status: AloudStatus }>('/api/aloud/settings', { method: 'PUT', body: patch, fallback: 'Could not save narration settings.' })
      .then((result) => {
        setStatus(result.status);
        const model = models.find((model) => model.id === result.status.engine);
        const voice = model?.voices.find((voice) => voice.id === result.status.voice);
        setAnnouncement(`Saved · ${model?.name ?? 'Narration'}${voice ? ' · ' + voice.label : ''}`);
        document.dispatchEvent(new CustomEvent('codestory:narration-settings', { detail: result.status }));
      })
      .catch((cause: unknown) => { setAnnouncement(''); setError(failureMessage(cause, 'Could not save narration settings.')); })
      .finally(() => {
        setBusy(false);
        requestAnimationFrame(() => {
          if (panel.current?.matches(':popover-open') && document.activeElement === document.body) focusTarget?.focus();
        });
      });
  };

  return <>
    <button ref={trigger} type="button" className="ds-narration-settings-toggle" popoverTarget={id}
      aria-expanded={open} aria-controls={id} aria-haspopup="dialog" aria-label="Narration settings" title={selected ? `${selected.name} · ${selectedVoice?.label ?? 'Choose voice'}` : 'Choose narration model and voice'}>
      <SlidersHorizontal size={15} strokeWidth={1.8} aria-hidden="true" />
      <span className="ds-narration-settings-label">Voice</span>
    </button>
    <div ref={panel} id={id} popover="auto" className="ds-narration-settings" role="dialog" aria-labelledby={id + '-title'}
      style={position} onKeyDown={(event) => event.stopPropagation()}
      onToggle={() => setOpen(panel.current?.matches(':popover-open') ?? false)}>
      <div className="ds-narration-settings-head">
        <div><h2 id={id + '-title'}>Narration</h2><p>Choose how your story sounds</p></div>
        <button type="button" aria-label="Close narration settings" autoFocus onClick={() => { panel.current?.hidePopover(); trigger.current?.focus(); }}>
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {loading ? <p className="ds-narration-settings-note" role="status">Loading local voices…</p> : <>
        {status && <fieldset disabled={busy} aria-busy={busy}>
          <label>Model<select aria-label="Narration model" value={status.engine ?? ''} onChange={(event) => apply({ engine: event.currentTarget.value })}>
            {models.map((model) => <option key={model.id} value={model.id} disabled={!model.ready || !model.languages.includes('en')}>
              {model.name}{!model.languages.includes('en') ? ' · Other languages' : !model.ready ? ' · Download needed' : ''}
            </option>)}
          </select></label>
          <p className="ds-narration-settings-detail">{selected?.detail}</p>
          <label>Voice<select aria-label="Narration voice" value={typeof status.voice === 'string' ? status.voice : ''} onChange={(event) => apply({ voice: event.currentTarget.value })}>
            {selected?.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
          </select></label>
          {selectedVoice?.description && <p className="ds-narration-settings-detail">{selectedVoice.description}</p>}
          <label>Playback speed<select aria-label="Narration playback speed" value={status.rate ?? 1} onChange={(event) => apply({ rate: Number(event.currentTarget.value) })}>
            {[...new Set([0.75, 1, 1.25, 1.5, status.rate ?? 1])].sort((a, b) => a - b).map((rate) => <option key={rate} value={rate}>{rate}×{rate === 1 ? ' · Normal' : ''}</option>)}
          </select></label>
        </fieldset>}
        {error && <p className="ds-narration-settings-error" role="alert">{error}</p>}
        {!error && <p className="ds-narration-settings-status" role="status">{announcement || 'Your choices are saved in codeStory.'}</p>}
        <p className="ds-narration-settings-note">Changes stop current narration. Lino provides the local speech engine.</p>
      </>}
    </div>
  </>;
}
