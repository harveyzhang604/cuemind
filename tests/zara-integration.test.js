import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSupadata,parseSupadata} from '../extension/services/supadata.js';
import {clearLearningCache} from '../extension/core/local-data.js';
import {restoreSettings} from '../extension/services/settings.js';
import {defaults,completion} from '../extension/services/ai-provider.js';
import {runTask} from '../extension/services/tasks.js';
const info={platform:'youtube',videoId:'sHieyY4r0-k',audioLanguage:'de',url:'https://www.youtube.com/watch?v=other&private=secret'};
const cfg={...defaults,supadataApiKey:'fixture-key'};
const content={lang:'de',availableLangs:['de','en'],content:[{text:'>> Hallo.',offset:179,duration:325},{text:'Weiter.',offset:600,duration:750}]};
test('Supadata preserves milliseconds and requests native original language with canonical URL',async()=>{
 const result=await fetchSupadata(info,cfg,{fetchImpl:async(url,options)=>{const u=new URL(url);assert.equal(u.searchParams.get('url'),'https://www.youtube.com/watch?v=sHieyY4r0-k');assert.equal(u.searchParams.get('mode'),'native');assert.equal(u.searchParams.get('text'),'false');assert.equal(u.searchParams.get('lang'),'de');assert.equal(options.headers['x-api-key'],'fixture-key');assert.equal(options.redirect,'error');return Response.json(content);}});
 assert.equal(result.raw[0].start,.179);assert.equal(result.raw[0].end,.504);assert.equal(result.raw[0].text,'Hallo.');assert.equal(result.language,'de');
 assert.throws(()=>parseSupadata({content:[]}),/空字幕/);
});
test('Supadata async jobs support direct and nested completed results, bounded polling',async()=>{
 for(const completed of [{status:'completed',...content},{status:'completed',result:content}]){let calls=0;const result=await fetchSupadata(info,cfg,{pollMs:1,fetchImpl:async()=>Response.json(++calls===1?{jobId:'test/job'}:calls===2?{status:'active'}:completed,{status:calls===1?202:200})});assert.equal(calls,3);assert.equal(result.raw.length,2);}
 await assert.rejects(fetchSupadata(info,cfg,{pollMs:1,maxPolls:1,fetchImpl:async()=>Response.json({jobId:'job',status:'active'},{status:202})}),/超时/);
});
test('Supadata errors are actionable, never expose upstream credentials, and cancellation aborts fetch',async()=>{
 for(const status of [206,401,403,404,429,500])await assert.rejects(fetchSupadata(info,cfg,{fetchImpl:async()=>Response.json({error:'fixture-key'},{status})}),e=>!e.message.includes('fixture-key')&&e.message.includes('Supadata'));
 const controller=new AbortController();const pending=fetchSupadata(info,cfg,{signal:controller.signal,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});controller.abort();await assert.rejects(pending,{name:'AbortError'});
 await assert.rejects(fetchSupadata({...info,platform:'bilibili'},cfg),/YouTube/);
});
test('cache clear keeps raw provenance, user preferences and notes while backup never injects Supadata secrets',()=>{
 const record={id:'r',sentences:[{id:'s',rawText:'Text.',translation:'译文'}],rawCaptions:[{id:'c'}],focusConfig:{goal:'toefl'},overrides:{s:'repeat'},analysis:{},tasks:{},focusCaches:{},translationCaches:{},studyMap:[]};
 const result=clearLearningCache(record);assert.equal(result.sentences[0].id,'s');assert.deepEqual(result.rawCaptions,record.rawCaptions);assert.deepEqual(result.focusConfig,record.focusConfig);assert.deepEqual(result.overrides,record.overrides);for(const field of ['analysis','tasks','focusCaches','translationCaches','studyMap'])assert.ok(!(field in result));assert.equal(record.sentences[0].translation,'译文');
 const restored=restoreSettings({...defaults,transcriptProvider:'supadata',supadataApiKey:'forged'},defaults);assert.equal(restored.supadataApiKey,'');assert.equal(restored.transcriptProvider,'platform');assert.equal(restoreSettings({...defaults,transcriptProvider:'fallback'},cfg).supadataApiKey,'fixture-key');
});
test('selected translation sends only requested IDs and reuses each target language cache',async()=>{
 const record={id:'r',videoInfo:{title:'Fixture'},sentences:[{id:'a',rawText:'One.',start:0,end:1},{id:'b',rawText:'Two.',start:1,end:2},{id:'c',rawText:'Three.',start:2,end:3}]};
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url,options)=>{calls++;const data=JSON.parse(options.body),input=JSON.parse(data.messages[1].content);assert.deepEqual(input.items.map(x=>x.id),['b']);return Response.json({choices:[{message:{content:JSON.stringify({translations:[{id:'b',text:input.targetLanguage+': Two.'}]})}}]});};
 try{const settings={...defaults,apiKey:'fixture'};const run=language=>runTask(record,'translation',{...settings,targetLanguage:language},{selectedIds:['b']},new AbortController().signal,async()=>{},()=>{});await run('中文');assert.equal(record.sentences[0].translation,undefined);await run('中文');assert.equal(calls,1);await run('English');assert.equal(calls,2);await run('中文');assert.equal(calls,2);assert.equal(record.sentences[1].translation,'中文: Two.');}
 finally{globalThis.fetch=original;}
});

test('DeepSeek empty JSON response retries once without forcing JSON format',async()=>{
 const prior=globalThis.fetch,requests=[];globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({choices:[{message:{content:requests.length===1?'':'{"answer":"Valid"}'}}]});};
 try{const result=await completion({...defaults,provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:'fixture'},'JSON',{},new AbortController().signal);assert.equal(result.answer,'Valid');assert.equal(requests.length,2);assert.deepEqual(requests[0].response_format,{type:'json_object'});assert.ok(!requests[1].response_format);assert.deepEqual(requests[1].thinking,{type:'disabled'});}
 finally{globalThis.fetch=prior;}
});

test('legacy backup without subtitle provider preserves current Supadata preference and local key',()=>{
 const current={...defaults,transcriptProvider:'fallback',supadataApiKey:'fixture-current',apiKey:'fixture-ai',asrKey:'fixture-asr'};
 const legacy={...defaults};delete legacy.transcriptProvider;delete legacy.supadataApiKey;
 const restored=restoreSettings(legacy,current);
 assert.equal(restored.transcriptProvider,'fallback');assert.equal(restored.supadataApiKey,'fixture-current');assert.equal(restored.apiKey,'fixture-ai');assert.equal(restored.asrKey,'fixture-asr');
 const explicit=restoreSettings({...legacy,transcriptProvider:'platform'},current);assert.equal(explicit.transcriptProvider,'platform');assert.equal(explicit.supadataApiKey,'fixture-current');
});
