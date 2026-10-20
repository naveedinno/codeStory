import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { serve } from '../dist/server.js';

test('video API requires the current story lease and rejects invalid settings, cross-origin and foreign jobs', async () => {
  const root=mkdtempSync(join(tmpdir(),'codestory-video-api-')),repo=join(root,'repo');
  execFileSync(process.execPath,['examples/demo.mjs'],{env:{...process.env,CODESTORY_DEMO_NO_SERVE:'1',CODESTORY_DEMO_DIR:repo},stdio:'pipe'});
  const server=serve({repo,homeOverride:join(root,'home'),port:0,open:false});
  await once(server,'listening');const origin=`http://localhost:${server.address().port}`;
  try {
    const html=await(await fetch(`${origin}/repo/${basename(repo)}/review?story=story.json`)).text();
    const token=html.match(/"pageToken":"([^"]+)"/)[1];
    const options={resolution:'720p',narration:false,speed:1,theme:'light'};
    const post=(body,page=token,extra={})=>fetch(`${origin}/api/video-export?page=${page}`,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
    assert.equal((await post(options,'invalid')).status,409);
    assert.equal((await post({...options,speed:100})).status,400);
    assert.equal((await post(options,token,{origin:'https://untrusted.example'})).status,403);
    assert.equal((await fetch(`${origin}/api/video-export/123/file?page=${token}`)).status,404);
    const capabilities=await(await fetch(`${origin}/api/video-export/capabilities`)).json();
    assert.equal(typeof capabilities.available,'boolean');assert.ok(Array.isArray(capabilities.missing));
    const story=join(repo,'.codestory/story.json');const data=JSON.parse(readFileSync(story,'utf8'));
    data.title='Changed after loading';writeFileSync(story,JSON.stringify(data));
    const stale=await post(options);assert.equal(stale.status,409);assert.equal((await stale.json()).reloadRequired,true);
    const storyless=await(await fetch(`${origin}/repo/${basename(repo)}/diff?base=main`)).text();
    assert.equal((await post(options,storyless.match(/"pageToken":"([^"]+)"/)[1])).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
});
