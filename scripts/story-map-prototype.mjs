// THROWAWAY: three story-map layouts on the existing review route, ?variant=A/B/C.
// Uses the real story and renderer; only this development runner injects the prototype.
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { readFileSync, mkdtempSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { serve } from '../dist/server.js';
import { parseUnifiedDiff } from '../dist/diff.js';
import { buildReviewModel, buildFullFileRows, rowsInNewRange } from '../dist/view-model.js';
import { renderStoryStepPanel, renderFullFile, renderContextRows } from '../dist/render.js';

if (process.env.NODE_ENV === 'production') throw new Error('This prototype is development-only.');
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const repo = resolve(arg('--repo', '/Users/naveed/Codes/blockchain/ivy/symmio/core'));
const storyId = arg('--story', 'stories/code-complete-tour.json');
const tour = JSON.parse(readFileSync(join(repo, '.codestory', storyId), 'utf8'));
const ordered = [...tour.steps].sort((a, b) => a.order - b.order);
const nodes = [];
const topic = (id, stepId, label, leaves = []) => {
  const index = ordered.findIndex(step => step.id === stepId);
  if (index < 0) throw new Error(`The gateway prototype needs story step ${stepId}.`);
  const step = ordered[index];
  const node = { id, stepId, panelIndex: index + 1, label, symbol: step.landing?.symbol ?? step.title,
    beat: 0, children: [], beats: step.beats?.length ?? 0 };
  nodes.push(node);
  for (const [beat, name] of leaves) {
    const child = `${id}-${beat}`;
    node.children.push(child);
    nodes.push({ ...node, id: child, label: name, beat, children: [] });
  }
  return node;
};
const entry = topic('root', 'b-execute-call', 'Execute a signed call');
topic('route', 'b-relayable', 'Can this call proceed?', [[1, 'Wallet route'], [2, 'Gateway route'], [3, 'Calls back into the gateway'], [4, 'Target policy and timelock']]);
topic('signatures', 'b-signed-by', 'Who authorized it?', [[1, 'Account or delegate?'], [2, 'Signer submits directly'], [3, 'ECDSA and ERC-1271'], [4, 'Delegation expiry']]);
topic('replay', 'b-replay', 'Has it been used?', [[0, 'Spend the digest once'], [1, 'Optional nonce ordering']]);
const next = topic('execution', 'b-timelock-branch', 'How does it execute?', [[1, 'Early approval'], [2, 'Matured schedule or unlocked']]);
topic('policy', 'b-timelock-policy', 'Read the target policy');
topic('schedule', 'b-use-schedule', 'Consume a matured schedule');
topic('wallet', 'b-wallet-route', 'Execute through a wallet');
topic('forward', 'b-forward', 'Forward with account context');
next.children.push('policy', 'schedule', 'wallet', 'forward');
topic('change', 'b-signed-call', 'Call and its signatures');
topic('submission', 'b-execute-signed', 'Submit the signed batch');
entry.children = ['route', 'change', 'replay', 'signatures', 'execution', 'submission'];
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trimEnd();
const base = git('rev-parse', `${tour.head}^`);
const sourceIds = ['root', 'route', 'signatures', 'policy', 'schedule', 'wallet', 'forward', 'submission'];
const model = buildReviewModel(repo, tour, [], tour.head, {
  detailedStepIndexes: new Set(nodes.filter(node => sourceIds.includes(node.id)).map(node => node.panelIndex - 1)),
  detailedFilePaths: new Set(), includeTrustRows: false, baseRef: base,
});
const viewers = new Map();
for (const node of nodes) {
  const step = ordered[node.panelIndex - 1];
  node.content = [{ type: 'text', panelIndex: node.panelIndex, beat: node.beat }];
  if (sourceIds.includes(node.id)) {
    const viewerId = `source-${node.id}`;
    viewers.set(viewerId, renderStoryStepPanel(repo, model, [], node.panelIndex - 1));
    node.content.push({ type: 'code', viewerId, file: step.file, revision: tour.head,
      rangesByBeat: (step.beats ?? []).map(beat => beat.highlights ?? []) });
  }
}
entry.content.splice(1, 0, { type: 'diagram', title: 'Checks before execution', labels: ['Deadline', 'Route', 'Signatures', 'Replay protection', 'Execute'] });
nodes.find(node => node.id === 'execution').content.push({ type: 'diagram', title: 'Execution after validation', labels: ['Timelock checks, if required', 'Wallet or gateway route', 'Execute'] });
const diffFile = 'contracts/gateway/SymmioGatewayTypes.sol';
const changes = parseUnifiedDiff(git('diff', '--no-ext-diff', '--no-color', '--unified=3', base, tour.head, '--', diffFile))[0];
const diffRange = [changes.hunks[0].newStart, Math.max(...changes.hunks.map(hunk => hunk.newStart + hunk.newLines - 1))];
const diffStep = { ...ordered.find(step => step.id === 'b-signed-call'), kind: 'changed', range: diffRange, viewport: diffRange };
const historical = { ...tour, subject: 'diff', steps: [diffStep], scope: { base, head: tour.head } };
const diffModel = buildReviewModel(repo, historical, [changes], tour.head, { baseRef: base, includeTrustRows: false });
let diffHtml = renderStoryStepPanel(repo, diffModel, [], 0);
const historicalLines = git('show', `${tour.head}:${diffFile}`).split('\n');
const historicalRows = buildFullFileRows(changes, historicalLines, []);
const full = renderFullFile(historicalRows, { file: diffFile, newFile: false });
diffHtml = diffHtml.replace('<div data-full-inner hidden></div>', `<div data-full-inner data-loaded="1" hidden>${full}</div>`);
viewers.set('diff-change', diffHtml);
nodes.find(node => node.id === 'change').content.push({ type: 'diff', viewerId: 'diff-change', file: diffFile, base, head: tour.head,
  rangesByBeat: (diffStep.beats ?? []).map(beat => beat.highlights ?? []) });
const data = { nodes, commit: tour.head, title: tour.title, sourceStory: storyId,
  path: ['root', 'change', 'route', 'signatures', 'replay', 'policy', 'execution', 'schedule', 'wallet', 'forward'] };
const bundled = await build({ entryPoints: [join(root, 'client/surfaces/review/story-map.prototype.tsx')],
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"development"' }, minify: false });
const js = bundled.outputFiles[0].text;
const css = readFileSync(join(root, 'client/surfaces/review/story-map.prototype.css'), 'utf8');
const home = mkdtempSync(join(tmpdir(), 'codestory-map-prototype-'));
const backend = serve({ repo, homeOverride: home, port: 0, open: false });
await once(backend, 'listening');
const proxy = createServer((req, res) => {
  const host = req.headers.host;
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
    || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
    || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    res.writeHead(403).end('Local prototype requests only.'); return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/_prototype/context') {
    if (url.searchParams.get('file') !== diffFile) { res.writeHead(404).end(); return; }
    const from = Number(url.searchParams.get('from'));
    const to = url.searchParams.get('to') === 'eof' ? historicalLines.length : Math.min(Number(url.searchParams.get('to')), historicalLines.length);
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to)) { res.writeHead(400).end(); return; }
    const layout = url.searchParams.get('layout') === 'split' ? 'split' : 'unified';
    const html = renderContextRows(rowsInNewRange(historicalRows, [from, to]), layout, { file: diffFile, newFile: false, servedRange: [from, to] });
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(html); return;
  }
  if (url.pathname === '/_prototype/viewer') {
    const html = viewers.get(url.searchParams.get('id'));
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(html ?? 'Unknown viewer'); return;
  }
  if (url.pathname.startsWith('/_prototype/')) {
    const content = { '/_prototype/map.js': ['text/javascript', js], '/_prototype/map.css': ['text/css', css],
      '/_prototype/map.json': ['application/json', JSON.stringify(data)] }[url.pathname];
    if (!content) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': content[0], 'cache-control': 'no-store' }).end(content[1]); return;
  }
  // The prototype only reads the story and uses the existing local narrator.
  if (!['GET', 'HEAD'].includes(req.method) && !url.pathname.startsWith('/api/aloud/')) {
    res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This design prototype is read-only.' })); return;
  }
  const upstream = request({ hostname: '127.0.0.1', port: backend.address().port, path: req.url,
    method: req.method, headers: req.headers }, response => {
    const html = response.headers['content-type']?.includes('text/html') && url.pathname.endsWith('/review');
    if (!html) { res.writeHead(response.statusCode, response.headers); response.pipe(res); return; }
    let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
    response.on('end', () => {
      delete response.headers['content-length'];
      text = text.replace('</head>', '<link rel="stylesheet" href="/_prototype/map.css"></head>')
        .replace('</body>', '<script type="module" src="/_prototype/map.js"></script></body>');
      res.writeHead(response.statusCode, response.headers).end(text);
    });
  });
  upstream.on('error', error => { res.writeHead(502).end(error.message); });
  req.pipe(upstream);
});
proxy.listen(Number(arg('--port', '7799')), '127.0.0.1');
await once(proxy, 'listening');
console.log(`\nGateway mind-map prototype → http://localhost:${proxy.address().port}/repo/${basename(repo)}/review?story=${encodeURIComponent(storyId)}&variant=A`);
console.log('A: Content map · B: Reading tree · C: Focused cards. Local read-only prototype; source story is preserved.');
process.on('SIGINT', () => { proxy.close(); backend.close(); process.exit(); });
