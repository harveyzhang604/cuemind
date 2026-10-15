import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS_MODEL, MaterialSceneDetector, differentFrame, normalizeMaterialItems, mergeMaterialFrames, materialsMarkdown, materialOptions, validateMaterials } from '../extension/core/materials.js';
import { extractMaterials, materialsSettings, recognizeMaterials } from '../extension/services/materials.js';
import { defaults } from '../extension/services/ai-provider.js';
import { laserPointerRegions } from '../extension/core/frame-changes.js';
import { materialsZip, materialsPackage } from '../extension/core/materials-archive.js';
import { inspectZip } from '../scripts/archive.mjs';

const item = (content, extra = {}) => ({ kind: 'code', title: '代码', language: 'python', content, partial: false, uncertainties: [], ...extra });
const frame = (time, content, hash = 'a') => ({ time, hash: hash.repeat(64), items: [item(content)] });
const data = (frames) => ({ version: 1, model: MATERIALS_MODEL, frames, run: { status: 'done', scope: 'all' } });
const pixels = (value) => new Uint8Array(640 * 360).fill(value);

test('change detector notices a local code edit, waits for settled frames and ignores identical frames', () => {
  const a = pixels(0), b = pixels(0);
  b.fill(255, 200, 204);
  assert.equal(differentFrame(a, b), true);
  assert.equal(differentFrame(a, a), false);
  const detector = new MaterialSceneDetector();
  assert.equal(detector.consider({ signature: a, time: 0 }, true), true);
  assert.equal(detector.consider({ signature: a, time: 0.6 }), false);
  assert.equal(detector.consider({ signature: b, time: 1.2 }), false);
  assert.equal(detector.consider({ signature: b, time: 1.8 }), false);
  assert.equal(detector.consider({ signature: b, time: 2.4 }), true);
  assert.equal(detector.consider({ signature: b, time: 3 }), false);
});

function arrow(base, x, y) {
  const result=base.slice();
  for(let yy=0;yy<16;yy++)for(let xx=0;xx<Math.min(9,yy+1);xx++) {
    if(yy>10&&(xx<3||xx>5))continue;
    result[(y+yy)*640+x+xx]=20;
  }
  return result;
}
test('a stationary page stays one page while a mouse moves, stops or enters from off screen',()=>{
 const page=pixels(250),detector=new MaterialSceneDetector();
 let count=+detector.consider({time:0,signature:page},true);
 for(let i=1;i<30;i++)count+=+detector.consider({time:i*.6,signature:arrow(page,50+(Math.floor(i/4)%5)*90,90+(Math.floor(i/8)%2)*80)});
 assert.equal(count,1);
});
test('caret blinking does not bypass stability even at the final observation',()=>{
 const page=pixels(250),detector=new MaterialSceneDetector();
 detector.consider({time:0,signature:page},true);
 for(let i=1;i<24;i++){
  const next=page.slice();if(i%2)for(let y=100;y<118;y++)next[y*640+100]=0;
  assert.equal(detector.consider({time:i*.6,signature:next}),false);
 }
});
test('moving round pointers are ignored while real edits remain detectable beside them',()=>{
 const page=pixels(250),detector=new MaterialSceneDetector();
 const dot=(base,x,y)=>{const r=base.slice();for(let yy=-3;yy<=3;yy++)for(let xx=-3;xx<=3;xx++)if(xx*xx+yy*yy<=9)r[(y+yy)*640+x+xx]=60;return r;};
 let count=+detector.consider({time:0,signature:dot(page,60,60)},true);
 for(let i=1;i<12;i++)count+=+detector.consider({time:i*.6,signature:dot(page,60+(i%4)*90,60)});
 assert.equal(count,1);
 const edited=page.slice();for(let y=150;y<155;y++)for(let x=100;x<104;x++)edited[y*640+x]=0;
 for(let i=12;i<18;i++)count+=+detector.consider({time:i*.6,signature:dot(edited,60+(i%4)*90,60)});
 assert.equal(count,2);
});
test('laser halo detection masks a red pointer but preserves flat red course text',()=>{
 const rgba=new Uint8ClampedArray(640*360*4).fill(255);
 for(let y=40;y<60;y++)for(let x=40;x<48;x++){const p=(y*640+x)*4;rgba[p+1]=0;rgba[p+2]=0;}
 for(let dy=-7;dy<=7;dy++)for(let dx=-7;dx<=7;dx++){
  const alpha=Math.exp(-(dx*dx+dy*dy)/12),p=((150+dy)*640+200+dx)*4;
  rgba[p+1]=rgba[p+2]=Math.round(255*(1-alpha));
 }
 const regions=laserPointerRegions(rgba);
 assert.equal(regions.length,1);assert.ok(regions[0].x>180&&regions[0].x<210);
});

test('long scrolling produces intermediate views rather than waiting forever for stability', () => {
  const detector = new MaterialSceneDetector();
  detector.consider({ signature: pixels(0), time: 0 }, true);
  assert.equal(detector.consider({ signature: pixels(50), time: 1 }), false);
  assert.equal(detector.consider({ signature: pixels(100), time: 2 }), false);
  assert.equal(detector.consider({ signature: pixels(150), time: 3.1 }), true);
});

test('exact duplicate code is merged but changed values and indentation are preserved', () => {
  const results = mergeMaterialFrames([frame(0, 'if x:\n    value = 1'), frame(1, 'if x:\n    value = 1  '), frame(2, 'if x:\n    value = 2'), frame(3, 'if x:\n  value = 1')]);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0].times, [0, 1]);
  assert.equal(results[1].content, 'if x:\n    value = 2');
  assert.equal(results[2].content, 'if x:\n  value = 1');
});

test('slide formatting variants merge while changed words and numbers remain distinct',()=>{
 const a={...frame(0,'Title\nValue: 10'),items:[item('Title\nValue: 10',{kind:'slide',language:''})]};
 const b={...frame(3,'Title Value:10'),items:[item('Title Value:10',{kind:'slide',language:''})]};
 const c={...frame(6,'Title Value:11'),items:[item('Title Value:11',{kind:'slide',language:''})]};
 assert.equal(mergeMaterialFrames([a,b,c]).length,2);
});

test('browser ZIP packages preserve screenshot bytes and Markdown image links',async()=>{
 const jpeg=new Uint8Array([255,216,255,224,0,1,255,217]);
 const record={videoInfo:{title:'Course',platform:'youtube',videoId:'fixture',url:'https://www.youtube.com/watch?v=fixture'},videoMaterials:data([frame(3,'value = 1')])};
 const archive=await materialsPackage(record,[{id:'picture',time:3,bytes:jpeg.length}],async()=>({dataUrl:'data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64')}));
 const files=inspectZip(Buffer.from(await archive.arrayBuffer()));
 assert.deepEqual([...files.find(f=>f.path.endsWith('.jpg')).data],[...jpeg]);
 assert.match(files.find(f=>f.path==='materials.md').data.toString(),/!\[00:03\]\(screenshots\/0001-00-03.jpg\)/);
 assert.ok(files.some(f=>f.path==='code.md'));
 assert.throws(()=>materialsZip([{path:'../escape.jpg',data:jpeg}]),/路径/);
 await assert.rejects(materialsPackage(record,[],()=>{}),/旧版本/);
});

test('an accepted screenshot is saved before an OCR failure',async()=>{
 const seen=[];
 await assert.rejects(extractMaterials(null,{
  signal:new AbortController().signal,current:true,
  captureFrame:async()=>({time:0,image:'local snapshot',signature:pixels(250)}),
  playback:async()=>{},save:async()=>{},saveFrame:async f=>{seen.push('image');assert.match(f.hash,/^[a-f0-9]{64}$/);return 'stored-picture';},
  recognize:async()=>{seen.push('ocr');throw new Error('fixture unavailable');},
 }),/fixture unavailable/);
 assert.deepEqual(seen,['image','ocr']);
});

test('a successful fresh scan replaces obsolete pages; failure preserves previous results', async () => {
  const previous = () => data([frame(1, 'old duplicate A'), frame(2, 'old duplicate B', 'b')]);
  let saved;
  const hooks = {
    signal: new AbortController().signal, scope: 'beginning',
    captureFrame: async () => ({ time: 0, image: 'fresh page', signature: pixels(250), ended: true }),
    playback: async () => {}, saveFrame: async () => 'fresh-picture',
    recognize: async () => [item('fresh code')],
    save: async value => { saved = structuredClone(value); },
  };
  const result = await extractMaterials(previous(), hooks);
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].items[0].content, 'fresh code');
  assert.equal(result.frames[0].imageId, 'fresh-picture');
  await assert.rejects(extractMaterials(previous(), { ...hooks, recognize: async () => { throw new Error('OCR failed'); } }), /OCR failed/);
  assert.equal(saved.frames.length, 2);
  assert.equal(saved.frames[0].items[0].content, 'old duplicate A');
});

test('scrolling code joins only substantial exact overlapping lines; edits are not guessed', () => {
  const anchor = ['    self.input_projection = nn.Linear(1, embed_dim)', '    self.attention_layer = nn.MultiheadAttention(embed_dim, nhead, batch_first=True)', '    self.layer_norm = nn.LayerNorm(embed_dim)'].join('\n');
  const a = 'class Transformer(nn.Module):\n' + anchor, b = anchor + '\n    self.classifier = nn.Linear(embed_dim, num_classes)';
  const result = mergeMaterialFrames([frame(1, a), frame(6, b)]);
  assert.equal(result.length, 1); assert.equal(result[0].content, a + '\n    self.classifier = nn.Linear(embed_dim, num_classes)');
  assert.equal(mergeMaterialFrames([frame(1, a), frame(6, b.replace('nhead,', 'nhead=4,'))]).length, 2);
});

test('Markdown exports original code safely with time links, uncertainty and partial status', () => {
  const record = { videoInfo: { title: 'Lesson', platform: 'bilibili', videoId: 'BVtest', page: 1, url: 'https://www.bilibili.com/video/BVtest/' }, videoMaterials: data([{ ...frame(4, 'print("```")\n    x = 1'), items: [item('print("```")\n    x = 1', { partial: true, uncertainties: ['变量名模糊'] })] }]) };
  record.videoMaterials.run.status = 'canceled';
  const output = materialsMarkdown(record);
  assert.match(output, /t=4/); assert.match(output, /````python/); assert.match(output, /    x = 1/);
  assert.match(output, /变量名模糊/); assert.match(output, /尚未完成/);
  assert.throws(() => materialsMarkdown({ ...record, videoMaterials: data([{ ...frame(1, 'Title'), items: [item('Title', { kind: 'slide', language: '' })] }]) }, true), /尚未提取到代码/);
});

test('malformed and oversized results fail instead of silently saving missing code', () => {
  for (const invalid of [{}, { items: {} }, { items: [item('code', { language: 'x\n```' })] }, { items: [item('')] }])
    assert.throws(() => normalizeMaterialItems(invalid));
  assert.throws(() => validateMaterials(data([{ ...frame(-1, 'code') }])));
  assert.deepEqual(normalizeMaterialItems({ items: [] }), []);
  assert.throws(() => materialOptions(Infinity, { mode: 'all' }));
  assert.throws(() => materialOptions(10, { mode: 'interval', interval: 5 }));
  assert.equal(materialOptions(10, { mode: 'all' }).mode, 'all');
  assert.equal(materialOptions(10, { mode: 'beginning' }).mode, 'beginning');
});

test('vision requests always use deepseek-flash and actual image blocks, never a text-only substitute', async () => {
  assert.throws(() => materialsSettings({ ...defaults, apiKey: 'test' }), /DeepSeek/);
  const fetchBefore = global.fetch;
  let body;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    body = JSON.parse(options.body);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items: [item('    value = 42')] }) } }] });
  };
  try {
    const result = await recognizeMaterials({ image: 'data:image/jpeg;base64,AAAA', time: 3 }, { ...defaults, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'test', model: 'deepseek-v4-pro', models: { materials: 'wrong-model' } }, new AbortController().signal);
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.thinking.type, 'disabled');
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
    assert.equal(result[0].content, '    value = 42');
    global.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"items":[]}' } }] });
    await assert.rejects(recognizeMaterials({ image: 'data:image/jpeg;base64,AAAA', time: 3 }, { ...defaults, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'test' }, new AbortController().signal), /截断/);
  } finally { global.fetch = fetchBefore; }
});

test('current-frame extraction persists, reuses an identical image and does not duplicate history', async () => {
  let calls = 0, saved;
  const hooks = { signal: new AbortController().signal, current: true, scope: 'current', captureFrame: async () => ({ time: 2, image: 'same image', signature: pixels(0) }), playback: async () => assert.fail('current frame must not play'), recognize: async () => { calls++; return [item('x = 2')]; }, save: async (value) => { saved = structuredClone(value); } };
  const first = await extractMaterials(null, hooks);
  const second = await extractMaterials(first, hooks);
  assert.equal(calls, 1); assert.equal(second.frames.length, 1);
  assert.equal(saved.run.status, 'done'); assert.equal(saved.run.scope, 'current');
});

test('canceling a paid request preserves previous frames and records partial completion', async () => {
  const controller = new AbortController(); let saved;
  await assert.rejects(extractMaterials(data([frame(0, 'old code')]), {
    signal: controller.signal, current: true,
    captureFrame: async () => ({ time: 4, image: 'new image', signature: pixels(10) }),
    playback: async () => {}, recognize: async () => { controller.abort(); throw new DOMException('已取消', 'AbortError'); },
    save: async (value) => { saved = structuredClone(value); },
  }), { name: 'AbortError' });
  assert.equal(saved.frames.length, 1); assert.equal(saved.frames[0].items[0].content, 'old code');
  assert.equal(saved.run.status, 'canceled');
});

test('slow recognition pauses a full queue and resumes without dropping queued code views', async () => {
  const nativeTimeout = global.setTimeout;
  // Accelerate observation waits; a deliberately blocked first request forces
  // backpressure regardless of machine speed.
  global.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, Math.min(ms, 2), ...args);
  let release, observation = 0, saved;
  const first = new Promise((resolve) => { release = resolve; });
  const actions = [];
  const deadline = nativeTimeout(() => release(), 1500);
  try {
    const result = await extractMaterials(null, {
      signal: new AbortController().signal,
      captureFrame: async () => { const n = observation++; return { time: n * 2, image: 'frame-' + n, signature: pixels((n * 53) % 256), ended: n >= 36 }; },
      playback: async (action) => { actions.push(action); if (action === 'pause') release(); },
      recognize: async (frame) => { if (frame.time === 0) await first; await new Promise((resolve) => nativeTimeout(resolve, 4)); return [item('value = ' + frame.time)]; },
      save: async (value) => { saved = structuredClone(value); },
    });
    assert.ok(actions.includes('pause')); assert.ok(actions.includes('play'));
    assert.equal(result.run.status, 'done'); assert.equal(saved.run.detected, saved.run.completed);
    assert.ok(saved.frames.length > 8); assert.equal(saved.frames.at(-1).time, 72);
  } finally { clearTimeout(deadline); global.setTimeout = nativeTimeout; }
});

test('background OCR overlaps requests but commits in time order and stops at two in flight', async () => {
 let observed=0,active=0,maximum=0;const written=[];
 const result=await extractMaterials(null,{
  signal:new AbortController().signal,fast:true,scope:'beginning',
  captureFrame:async()=>{const n=observed++;return {time:n*.6,image:'view-'+Math.floor(n/4),signature:pixels(Math.floor(n/4)*55),ended:n>=15};},
  playback:async()=>assert.fail('short scan needs no backpressure'),
  recognize:async frame=>{active++;maximum=Math.max(active,maximum);await new Promise(r=>setTimeout(r,frame.time<1?80:20));active--;return [item('value = '+frame.time)];},
  save:async value=>{if(value.run.completed)written.push(value.run.completedThrough);},
 });
 assert.equal(maximum,2);assert.equal(result.run.status,'done');assert.equal(result.run.engine,'background');
 assert.ok(result.frames.length>=3);assert.deepEqual(written,[...written].sort((a,b)=>a-b));
});


test('a blank intro never consumes the first real course frame', () => {
  const detector = new MaterialSceneDetector();
  assert.equal(detector.consider({signature: pixels(0), time: 0, blank: true}, true), false);
  assert.equal(detector.consider({signature: pixels(250), time: 1, blank: false}), true);
});
