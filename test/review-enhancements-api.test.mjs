import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { serve } from '../dist/server.js';

test('evidence endpoints require a current lease, an authored check, and confirmation; drift and checkout changes fail closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-enhance-api-'));
  const repo = join(root, 'repo'), home = join(root, 'home');
  execFileSync(process.execPath, ['examples/demo.mjs'], { env: { ...process.env, DIFFSTORY_DEMO_NO_SERVE:'1', DIFFSTORY_DEMO_DIR:repo }, stdio:'pipe' });
  const opened = [];
  const server = serve({ repo, homeOverride:home, port:0, open:false, openEditor:target => { opened.push(target); return true; } });
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;
  try {
    const html = await (await fetch(`${origin}/repo/${basename(repo)}/review?story=story.json`)).text();
    const token = html.match(/"pageToken":"([^"]+)"/)[1];
    const post = (path, body, page = token, extra = {}) => fetch(`${origin}${path}?page=${page}`, { method:'POST', headers:{'content-type':'application/json',...extra}, body:JSON.stringify(body) });
    assert.equal((await post('/api/verification/run', { index:0, confirmed:true }, 'invalid')).status,409);
    assert.equal((await post('/api/verification/run', { index:0 })).status,400);
    assert.equal((await post('/api/verification/run', { index:9, confirmed:true, command:'printf injected' })).status,400);
    assert.equal((await post('/api/verification/run', { index:0, confirmed:true }, token, {origin:'https://untrusted.example'})).status,403);
    const response = await post('/api/verification/run', { index:0, confirmed:true, command:'printf ignored' });
    assert.equal(response.status,200);
    const run = await response.json();
    assert.equal(run.receipt.check,'git diff --check main...HEAD');
    assert.equal(run.receipt.result,'passed'); assert.equal(run.current,true);
    let evidence = await (await fetch(`${origin}/api/verification?page=${token}`)).json();
    assert.equal(evidence.checks[0].current,true);
    assert.equal((await post('/api/editor/caller',{stepId:'s2',caller:'invented()'})).status,404);
    assert.equal((await post('/api/editor/caller',{stepId:'s2',caller:'createOrder()'})).status,200);
    assert.equal(opened.length,1); assert.equal(opened[0].path,join(repo,'src/api.ts'));
    assert.equal((await post('/api/story/refresh',{observation:'not-current'})).status,409);
    writeFileSync(join(repo,'src/limits.ts'),readFileSync(join(repo,'src/limits.ts'),'utf8').replace('MONTHLY_CAP - spent','MONTHLY_CAP - spent - 1'));
    evidence = await (await fetch(`${origin}/api/verification?page=${token}`)).json();
    assert.equal(evidence.checks[0].current,false);
    assert.equal((await post('/api/verification/run',{index:0,confirmed:true})).status,409,'fixed-ref checks cannot execute a different checkout');
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(root,{recursive:true,force:true}); }
});
