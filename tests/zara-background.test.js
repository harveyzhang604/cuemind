import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {defaults} from '../extension/services/ai-provider.js';
import {validateSettings} from '../extension/services/settings.js';
import {normalizeCaptions,splitTimedCaptions,videoKey,SCHEMA_VERSION} from '../extension/core/transcript.js';
import {localSentences,paragraphs} from '../extension/core/sentence.js';
import {keyFromUrl} from '../extension/core/video.js';
import {canReuseTranscript} from '../extension/services/platform.js';
import {taskConflict} from '../extension/core/task-lock.js';
import {clearLearningCache,dataActions} from '../extension/core/local-data.js';
import {recoverEquivalentLearning} from '../extension/core/record-recovery.js';
import {selectFocusConfig} from '../extension/core/focus.js';
import {explanationCacheKey} from '../extension/services/explanation-cache.js';
async function fixture(existingStorage){
 const noop=()=>{},stores={videos:new Map(),notes:new Map(),chats:new Map()},storage=existingStorage||{settings:{...defaults,transcriptProvider:'supadata',supadataApiKey:'fixture'}};
 const inspection={info:{platform:'youtube',videoId:'sHieyY4r0-k',page:1,title:'Fixture',audioLanguage:'en',url:'https://www.youtube.com/watch?v=sHieyY4r0-k'},tracks:[]};
 const context={console,URL,DOMException,AbortController,structuredClone,crypto:globalThis.crypto,Date,Map,Set,setInterval:noop,defaults,validateSettings,normalizeCaptions,splitTimedCaptions,videoKey,SCHEMA_VERSION,localSentences,paragraphs,keyFromUrl,canReuseTranscript,taskConflict,clearLearningCache,dataActions,recoverEquivalentLearning,inspection,
 db:{get:async(name,id)=>structuredClone(stores[name].get(id)),all:async name=>structuredClone([...stores[name].values()]),put:async(name,value)=>{stores[name].set(value.id,structuredClone(value));return value;},remove:async(name,id)=>stores[name].delete(id),updateNote:async(id,expected,change)=>{const n=stores.notes.get(id);if(n?.updatedAt!==expected)return null;const next={...n,...change};stores.notes.set(id,structuredClone(next));return next;},manage:async(action,transform)=>{if(action==='reset'){Object.values(stores).forEach(s=>s.clear());}else if(action==='delete-notes')stores.notes.clear();else{stores.chats.clear();for(const [id,r]of stores.videos)stores.videos.set(id,transform(r));}}},
 chrome:{storage:{local:{setAccessLevel:noop,get:async k=>({[k]:storage[k]}),set:async v=>Object.assign(storage,v),clear:async()=>Object.keys(storage).forEach(k=>delete storage[k])}},sidePanel:{setPanelBehavior:noop},action:{onClicked:{addListener:noop}},tabs:{get:async()=>({url:inspection.info.url}),sendMessage:async()=>({ok:true,data:{time:.6,isAd:false}}),onRemoved:{addListener:noop}},permissions:{contains:async()=>true},runtime:{sendMessage:async()=>{},onMessage:{addListener:noop}}}};
 context.cachedCompletion=(...args)=>context.completion(...args.slice(0,5));
 const source=(await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import [\s\S]*?;\s*/gm,'');vm.createContext(context);vm.runInContext(source+'\npage=async()=>structuredClone(inspection);globalThis.router=route;',context);return {context,stores,storage,inspection,route:context.router};
}
test('background Supadata load deduplicates requests, caches results, refresh keeps note provenance',async()=>{
 const f=await fixture();let calls=0;f.context.fetchSupadata=async()=>{calls++;return {raw:normalizeCaptions([{start:.179,end:2,text:'Exact words.'}],'supadata_native'),language:'en',availableLangs:['en']};};
 const m={type:'LOAD',tabId:1,trackId:'auto',videoKey:videoKey(f.inspection.info)};
 const [a,b]=await Promise.all([f.route(m),f.route(m)]);assert.equal(calls,1);assert.equal(a.record.id,b.record.id);assert.equal(a.record.transcriptMeta.source,'supadata_native');assert.equal(a.record.rawCaptions[0].start,.179);
 await f.route(m);assert.equal(calls,1);
 const note=await f.route({type:'SAVE_NOTE',note:{recordId:a.record.id,body:'Keep',sourceText:'Exact words.',timestamp:.179,sentenceIds:[a.record.sentences[0].id]}});
 const refresh=await f.route({...m,refresh:true});assert.equal(calls,2);assert.notEqual(refresh.record.id,a.record.id);assert.ok(f.stores.videos.has(note.recordId));assert.equal(f.stores.notes.get(note.id).sentenceIds[0],a.record.sentences[0].id);
});
test('word explanations reuse persisted results and invalidate when evidence or model preferences change',async()=>{
 const f=await fixture();f.context.explanationCacheKey=explanationCacheKey;let calls=0;
 const record={id:'explanation-video',videoInfo:{title:'Fixture'},sentences:[{id:'s0',start:0,end:5,rawText:'That is shadowing.'},{id:'s1',start:5,end:10,rawText:'Repeat the speaker.'}]};
 f.stores.videos.set(record.id,record);
 f.context.runTask=async()=>{calls++;return {answer:'影子跟读法',answerEn:'Shadowing practice.',citations:[]};};
 const request={type:'TASK',recordId:record.id,capability:'explain',args:{selectedText:'shadowing',selectedIds:['s0'],currentTime:1}};
 assert.equal((await f.route(request)).cached,false);assert.equal(calls,1);
 assert.equal((await f.route({...request,args:{...request.args,currentTime:8}})).cached,true);assert.equal(calls,1);assert.equal(f.stores.chats.size,1);
 f.storage.settings.prompts={explain:'Explain for a beginner.'};await f.route(request);assert.equal(calls,2);
 f.storage.settings.model='changed-model';await f.route(request);assert.equal(calls,3);
 record.sentences[1].rawText='Follow the speaker immediately.';await f.route(request);assert.equal(calls,4);
 await f.route({...request,args:{...request.args,selectedText:'That is shadowing.'}});assert.equal(calls,5);
 f.stores.chats.clear();await f.route(request);assert.equal(calls,6);
 f.stores.chats.clear();f.context.runTask=async()=>{calls++;throw new Error('Model unavailable');};await assert.rejects(()=>f.route(request),/Model unavailable/);assert.equal(f.stores.chats.size,0);
});
test('reload of an equivalent video revision restores saved translation and word emphasis',async()=>{
 const f=await fixture();let calls=0;
 f.context.fetchSupadata=async()=>{calls++;return {raw:normalizeCaptions([{start:0,end:2,text:'Repeat clearly.'}],'supadata_native'),language:'en'};};
 const m={type:'LOAD',tabId:1,trackId:'auto',videoKey:videoKey(f.inspection.info)};
 const first=await f.route(m),old=f.stores.videos.get(first.record.id);
 const cfg=f.storage.settings;
 const signature=JSON.stringify([cfg.provider,cfg.baseUrl,cfg.models?.translation||cfg.model,cfg.targetLanguage,cfg.prompts?.translation||'']);
 old.sentences[0].translation='清楚地重复。';
 old.tasks={translation:{signature,done:[0],failed:[]}};
 selectFocusConfig(old,{goal:'toefl',overlay:true});
 old.focusCache.marks=[{sentenceId:old.sentences[0].id,start:0,end:6,text:'Repeat',level:2}];
 old.focusCache.done=[0];old.focusCache.status='complete';
 const refreshed=await f.route({...m,refresh:true});
 assert.equal(calls,2);assert.notEqual(refreshed.record.id,old.id);
 assert.equal(refreshed.recovered.translations,1);
 assert.equal(refreshed.recovered.focus,1);
 assert.equal(refreshed.record.sentences[0].translation,'清楚地重复。');
 assert.equal(refreshed.record.focusCache.marks[0].text,'Repeat');
 assert.equal(f.stores.videos.get(old.id).sentences[0].translation,'清楚地重复。');
});
test('instant quick note persists before polish, supports user editing, and rejects cleanup while model active',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:normalizeCaptions([{start:0,end:2,text:'Original exact sentence.'}]),language:'en'});f.storage.settings.apiKey='fixture-ai';let finish;
 f.context.completion=async()=>new Promise(r=>finish=r);
 await f.route({type:'LOAD',tabId:1});
 const result=await f.route({type:'QUICK_NOTE',tabId:1});assert.equal(result.note.body,'Original exact sentence.');assert.equal(f.stores.notes.size,1);assert.ok(finish);
 await assert.rejects(f.route({type:'MANAGE_DATA',action:'reset',confirmed:true}),/结束正在进行/);
 const edited=await f.route({type:'SAVE_NOTE',note:{...result.note,body:'My edited thought.'}});finish({body:'Late polished result.'});await new Promise(r=>setImmediate(r));assert.equal(f.stores.notes.get(edited.id).body,'My edited thought.');
 assert.equal(await f.route({type:'MANAGE_DATA',action:'delete-notes',confirmed:true}),true);assert.equal(f.stores.notes.size,0);assert.equal(f.stores.videos.size,1);assert.equal(f.storage.settings.apiKey,'fixture-ai');
 await assert.rejects(f.route({type:'MANAGE_DATA',action:'reset',confirmed:false}),/确认/);
});
test('late transcript from a navigated tab cannot commit',async()=>{
 const f=await fixture();let finish;
 f.context.fetchSupadata=async()=>new Promise(r=>finish=r);
 const loading=f.route({type:'LOAD',tabId:1});
 while(!finish)await new Promise(r=>setImmediate(r));
 f.inspection.info.url='https://www.youtube.com/watch?v=another7';
 finish({raw:normalizeCaptions([{start:0,end:2,text:'Old video.'}]),language:'en'});
 await assert.rejects(loading,/视频已切换/);assert.equal(f.stores.videos.size,0);
});
test('note translations cache by language and body, invalid batches do not write',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:normalizeCaptions([{start:0,end:2,text:'Original words.'}]),language:'en'});
 const {record}=await f.route({type:'LOAD',tabId:1});
 const note=await f.route({type:'SAVE_NOTE',note:{recordId:record.id,body:'Original words.',timestamp:0,sentenceIds:[record.sentences[0].id]}});
 let calls=0;f.context.completion=async(cfg,prompt,input)=>{calls++;return {translations:input.items.map(n=>({id:n.id,text:cfg.targetLanguage+' translation'}))};};
 const m={type:'TRANSLATE_NOTES',recordId:record.id,ids:[note.id]};
 await f.route(m);await f.route(m);assert.equal(calls,1);
 f.storage.settings.targetLanguage='English';await f.route(m);assert.equal(calls,2);
 f.storage.settings.targetLanguage='简体中文';await f.route(m);assert.equal(calls,2);
 await f.route({type:'SAVE_NOTE',note:{...note,body:'Edited source.'}});await f.route(m);assert.equal(calls,3);
 const before=structuredClone(f.stores.notes.get(note.id));
 f.storage.settings.targetLanguage='日本語';f.context.completion=async()=>({translations:[]});
 await assert.rejects(f.route(m),/漏项/);assert.deepEqual(f.stores.notes.get(note.id),before);
 await assert.rejects(f.route({...m,ids:[note.id,note.id]}),/1–3/);
});

test('saved subtitle service and credentials survive worker reload and cache clearing',async()=>{
 const f=await fixture();
 const config={...defaults,transcriptProvider:'fallback',supadataApiKey:'fixture-supadata',apiKey:'fixture-text',asrKey:'fixture-speech',prompts:{qa:'用简单中文回答。'}};
 await f.route({type:'SAVE_SETTINGS',settings:config});
 const restarted=await fixture(f.storage);
 const saved=await restarted.route({type:'GET_SETTINGS'});
 assert.equal(saved.transcriptProvider,'fallback');assert.equal(saved.supadataApiKey,'fixture-supadata');
 assert.equal(saved.apiKey,'fixture-text');assert.equal(saved.asrKey,'fixture-speech');assert.equal(saved.prompts.qa,config.prompts.qa);
 await restarted.route({type:'MANAGE_DATA',action:'clear-cache',confirmed:true});
 assert.deepEqual(await restarted.route({type:'GET_SETTINGS'}),saved);
});

test('older settings payload cannot erase Supadata fields but explicit clearing still works',async()=>{
 const f=await fixture();
 const current={...defaults,transcriptProvider:'fallback',supadataApiKey:'fixture-subtitle',apiKey:'fixture-ai',asrKey:'fixture-asr'};
 await f.route({type:'SAVE_SETTINGS',settings:current});
 const legacy={...current};delete legacy.transcriptProvider;delete legacy.supadataApiKey;legacy.targetLanguage='English';
 await f.route({type:'SAVE_SETTINGS',settings:legacy});
 const saved=await f.route({type:'GET_SETTINGS'});
 assert.equal(saved.transcriptProvider,'fallback');assert.equal(saved.supadataApiKey,'fixture-subtitle');assert.equal(saved.targetLanguage,'English');assert.equal(saved.apiKey,'fixture-ai');assert.equal(saved.asrKey,'fixture-asr');
 await f.route({type:'SAVE_SETTINGS',settings:{...saved,transcriptProvider:'platform',supadataApiKey:''}});
 assert.equal((await f.route({type:'GET_SETTINGS'})).supadataApiKey,'');
});

test('update reconnects only supported video tabs and tolerates a closed tab',async()=>{
 const f=await fixture();let queries,injections=[];
 f.context.chrome.tabs.query=async q=>{queries=q;return [{id:1,url:'https://www.bilibili.com/video/BVfixture/?p=2'},{id:2,url:'https://www.youtube.com/watch?v=fixture'},{id:3,url:'https://www.bilibili.com/'},{id:4,url:'https://example.com/video/BVfixture'},{id:5,url:'https://www.youtube.com/watch?v=closed'}];};
 f.context.chrome.scripting={executeScript:async arg=>{injections.push(arg);if(arg.target.tabId===5)throw new Error('Tab closed');return [];}};
 const results=await vm.runInContext('reconnectVideoTabs()',f.context);
 assert.deepEqual(Array.from(queries.url),['https://www.youtube.com/*','https://www.bilibili.com/*']);
 assert.deepEqual(injections.map(x=>x.target.tabId),[1,2,5]);
 assert.ok(injections.every(x=>x.files.length===1&&x.files[0]==='content/player.js'));
 assert.deepEqual(Array.from(results,r=>r.status),['fulfilled','fulfilled','rejected']);
 assert.equal(f.stores.notes.size,0);assert.equal(f.storage.settings.supadataApiKey,'fixture');
});
