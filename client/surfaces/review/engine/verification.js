// Local command execution is always an explicit reviewer action. Authored
// results remain visible even when a separate, app-captured receipt exists.
export function initVerification({ pageUrl }) {
  const cleanup = [];
  let disposed = false;
  const displayed = new Map();
  const rows = [...document.querySelectorAll('[data-verification-row]')];
  if (!rows.length) return;
  function render(row, receipt, current) {
    const host = row.querySelector('[data-verification-receipt]');
    if (!host || !receipt) return;
    current = current && document.body.getAttribute('data-live-diff-stale') !== '1';
    displayed.set(row, { receipt, current });
    host.replaceChildren();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Captured locally · ${receipt.result === 'passed' ? 'Passed' : 'Failed'} · ${current ? 'Matches reviewed source' : 'Out of date or source changed'}`;
    const meta = document.createElement('p');
    meta.textContent = `${receipt.finishedAt} · checkout ${receipt.revision.slice(0, 12)} · review ${receipt.fingerprint.slice(0, 12)} · exit ${receipt.exitCode ?? 'signal'}${receipt.timedOut ? ' · timed out after two minutes' : ''}`;
    const output = document.createElement('pre');
    output.textContent = (receipt.output || '(No output)') + (receipt.truncated ? '\n[Output truncated at 64K characters]' : '');
    details.append(summary, meta, output); host.append(details);
  }
  fetch(pageUrl('/api/verification')).then((response) => response.ok ? response.json() : null).then((data) => {
    if (data && !disposed) rows.forEach((row, index) => { const check = data.checks?.[index]; if (check) render(row, check.receipt, check.current); });
  }).catch(() => { /* optional receipts do not hide authored evidence */ });
  const sourceObserver = new MutationObserver(() => {
    if (document.body.getAttribute('data-live-diff-stale') === '1') {
      for (const [row, entry] of displayed) if (entry.current) render(row, entry.receipt, false);
    }
  });
  sourceObserver.observe(document.body, { attributes: true, attributeFilter: ['data-live-diff-stale'] });
  cleanup.push(() => sourceObserver.disconnect());
  for (const row of rows) {
    const button = row.querySelector('[data-run-verification]');
    if (!button) continue;
    const run = async () => {
      const command = row.querySelector('.ds-verify-check')?.textContent || '';
      if (!window.confirm(`Run this command in the reviewed repository?\n\n${command}\n\nThis executes local code. Output will be saved on this device.`)) return;
      button.disabled = true; button.textContent = 'Running…';
      row.querySelectorAll('[data-verification-receipt] [role="alert"]').forEach(node => node.remove());
      try {
        const response = await fetch(pageUrl('/api/verification/run'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ index: Number(row.dataset.verificationRow), confirmed: true }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The check could not run.');
        render(row, data.receipt, data.current);
      } catch (error) {
        const alert = document.createElement('p'); alert.setAttribute('role', 'alert'); alert.textContent = error.message || 'The check could not run.';
        row.querySelector('[data-verification-receipt]')?.append(alert);
      }
      finally { button.disabled = false; button.textContent = 'Run locally…'; }
    };
    button.addEventListener('click', run); cleanup.push(() => button.removeEventListener('click', run));
  }
  return () => { disposed = true; cleanup.forEach(remove => remove()); };
}
