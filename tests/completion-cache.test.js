import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedCompletion,completionCacheKey} from '../extension/services/completion-cache.js';
import {runTask,groundedTranslation} from '../extension/services/tasks.js';
const signal=()=>new AbortController().signal;
function memory(){const rows=new Map();return {rows,get:async id=>structuredClone(rows.get(id)),put:async row=>rows.set(row.id,structuredClone(row)),remove:async id=>rows.delete(id)};}
test('validated completion persists, excludes credentials, invalidates on real input changes and skips failures',async()=>{
 const storage=memory(),settings={provider:'openai',baseUrl:'https://example.com/v1',apiKey:'SECRET',model:'test'};let calls=0;
 const generate=async()=>{calls++;return {answer:'Saved'};},valid=data=>typeof data?.answer==='string';
 const run=(cfg=settings,input={text:'source'})=>cachedCompletion(cfg,'Rules',input,signal(),'qa',valid,{storage,generate});
 await run();await run({...settings,apiKey:'CHANGED'});assert.equal(calls,1);
 assert.ok(!JSON.stringify([...storage.rows]).includes('SECRET'));
 await run({...settings,models:{qa:'different'}});await run(settings,{text:'changed'});assert.equal(calls,3);
 assert.notEqual(await completionCacheKey(settings,'Rules',{text:'source'},'qa'),await completionCacheKey(settings,'New rules',{text:'source'},'qa'));
 const incomplete=async()=>{calls++;return {};};await cachedCompletion(settings,'Incomplete',{},signal(),'qa',valid,{storage,generate:incomplete});await cachedCompletion(settings,'Incomplete',{},signal(),'qa',valid,{storage,generate:incomplete});assert.equal(calls,5);
 const c=new AbortController();c.abort();await assert.rejects(()=>cachedCompletion(settings,'Rules',{text:'source'},c.signal,'qa',valid,{storage,generate}),{name:'AbortError'});
 storage.rows.clear();await run();assert.equal(calls,6);
});
test('whole subtitle retry sends only missing sentences and marks recovered batches complete',async()=>{
 const original=global.fetch,ids=[];
 global.fetch=async(url,init)=>{const input=JSON.parse(JSON.parse(init.body).messages.at(-1).content);ids.push(...input.items.map(s=>s.id));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:input.items.map(s=>({id:s.id,text:'译文'}))})}}]}));};
 const cfg={apiKey:'fixture'},signature=JSON.stringify([cfg.provider,cfg.baseUrl,cfg.model,cfg.targetLanguage,'']);
 const record={videoInfo:{title:'test'},sentences:[{id:'s0',start:0,end:2,rawText:'Hello.',translation:'已有译文'},{id:'s1',start:2,end:4,rawText:'World.'}],tasks:{translation:{signature,done:[],failed:[{index:0,error:'missing'}]}}};
 try{const result=await runTask(record,'translation',cfg,{},signal(),async()=>{},()=>{});assert.deepEqual(ids,['s1']);assert.equal(result.partial,false);assert.equal(record.sentences[0].translation,'已有译文');await runTask(record,'translation',cfg,{},signal(),async()=>{},()=>{});assert.deepEqual(ids,['s1']);}finally{global.fetch=original;}
});

test('explicit regeneration replaces the saved response for the next ordinary request',async()=>{
 const storage=memory(),cfg={model:'fixture'};let calls=0;
 const generate=async()=>({answer:'answer '+(++calls)}),valid=data=>!!data.answer;
 const run=force=>cachedCompletion(cfg,'Rules',{},signal(),'qa',valid,{storage,generate,force});
 assert.equal((await run(false)).answer,'answer 1');assert.equal((await run(true)).answer,'answer 2');
 assert.equal((await run(false)).answer,'answer 2');assert.equal(calls,2);
});
test('Migu ASR translation uses only source text and rejects unrelated event descriptions',async()=>{
 const source="Now Huffey's got his pressure down.";
 const unrelated='洛杉矶现场报道，今晚八角笼降临 Crypto.com 竞技场，迎来 2026 年冠军战。';
 assert.equal(groundedTranslation(source,unrelated),false);
 assert.equal(groundedTranslation(source,'现在哈菲把对手压住了。'),true);
 const original=global.fetch,inputs=[];
 let response=unrelated;
 global.fetch=async(_url,init)=>{
  const input=JSON.parse(JSON.parse(init.body).messages.at(-1).content);
  inputs.push(input);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:[{id:'s0',text:response}]})}}]}));
 };
 const record={videoInfo:{platform:'migu',title:'UFC 331',author:'咪咕视频'},transcriptMeta:{source:'whisper'},sentences:[{id:'s0',start:216,end:220,rawText:source}]};
 try{
  const bad=await runTask(record,'translation',{apiKey:'fixture',targetLanguage:'简体中文'},{selectedIds:['s0']},signal(),async()=>{},()=>{});
  assert.equal(bad.partial,true);
  assert.equal(record.sentences[0].translation,undefined);
  assert.equal(record.translationCaches[record.tasks.translation.signature]?.s0,undefined);
  assert.deepEqual(Object.keys(inputs[0]).sort(),['items','targetLanguage']);
  response='现在哈菲把对手压住了。';
  const good=await runTask(record,'translation',{apiKey:'fixture',targetLanguage:'简体中文'},{selectedIds:['s0']},signal(),async()=>{},()=>{});
  assert.equal(good.partial,false);
  assert.equal(record.sentences[0].translation,response);
 }finally{global.fetch=original;}
});
