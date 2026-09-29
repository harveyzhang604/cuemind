import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {defaults} from '../extension/services/ai-provider.js';
import {validateSettings} from '../extension/services/settings.js';
import {normalizeCaptions,splitTimedCaptions,videoKey,SCHEMA_VERSION} from '../extension/core/transcript.js';
import {localSentences,paragraphs} from '../extension/core/sentence.js';
import {keyFromUrl,matchesVideoUrl} from '../extension/core/video.js';
import {planAsrSegments,skipRecognizedAudio} from '../extension/core/asr-progress.js';
import {canReuseTranscript} from '../extension/services/platform.js';
import {taskConflict} from '../extension/core/task-lock.js';
import {clearLearningCache,dataActions} from '../extension/core/local-data.js';
import {recoverEquivalentLearning} from '../extension/core/record-recovery.js';
import {selectFocusConfig} from '../extension/core/focus.js';
import {explanationCacheKey} from '../extension/services/explanation-cache.js';
async function fixture(existingStorage){
 const noop=()=>{},listeners=[],stores={videos:new Map(),notes:new Map(),chats:new Map()},storage=existingStorage||{settings:{...defaults,transcriptProvider:'supadata',supadataApiKey:'fixture'}};
 const inspection={info:{platform:'youtube',videoId:'sHieyY4r0-k',page:1,title:'Fixture',audioLanguage:'en',url:'https://www.youtube.com/watch?v=sHieyY4r0-k'},tracks:[]};
 const context={console,URL,DOMException,AbortController,structuredClone,crypto:globalThis.crypto,Date,Map,Set,setInterval:noop,setTimeout:()=>1,clearTimeout:noop,defaults,validateSettings,normalizeCaptions,splitTimedCaptions,videoKey,SCHEMA_VERSION,localSentences,paragraphs,keyFromUrl,matchesVideoUrl,planAsrSegments,skipRecognizedAudio,canReuseTranscript,selectFocusConfig,taskConflict,clearLearningCache,dataActions,recoverEquivalentLearning,inspection,
 db:{get:async(name,id)=>structuredClone(stores[name].get(id)),all:async name=>structuredClone([...stores[name].values()]),put:async(name,value)=>{stores[name].set(value.id,structuredClone(value));return value;},remove:async(name,id)=>stores[name].delete(id),updateNote:async(id,expected,change)=>{const n=stores.notes.get(id);if(n?.updatedAt!==expected)return null;const next={...n,...change};stores.notes.set(id,structuredClone(next));return next;},manage:async(action,transform)=>{if(action==='reset'){Object.values(stores).forEach(s=>s.clear());}else if(action==='delete-notes')stores.notes.clear();else{stores.chats.clear();for(const [id,r]of stores.videos)stores.videos.set(id,transform(r));}}},
 chrome:{storage:{local:{setAccessLevel:noop,get:async k=>({[k]:storage[k]}),set:async v=>Object.assign(storage,v),clear:async()=>Object.keys(storage).forEach(k=>delete storage[k])}},sidePanel:{setPanelBehavior:noop},action:{onClicked:{addListener:noop}},tabs:{get:async()=>({url:inspection.info.url}),sendMessage:async()=>({ok:true,data:{time:.6,isAd:false}}),onRemoved:{addListener:noop}},permissions:{contains:async()=>true},runtime:{id:'fixture',getURL:path=>'chrome-extension://fixture/'+path,sendMessage:async()=>{},onMessage:{addListener:fn=>listeners.push(fn)}}}};
 context.cachedCompletion=(...args)=>context.completion(...args.slice(0,5));
 const source=(await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import [\s\S]*?;\s*/gm,'');vm.createContext(context);vm.runInContext(source+'\npage=async()=>structuredClone(inspection);globalThis.router=route;',context);return {context,stores,storage,inspection,listeners,route:context.router};
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


test('toolbar opens the workspace on unsupported tabs without enabling video processing', async () => {
 const f = await fixture(), options = [], opened = [], behavior = [], listeners = {};
 f.context.chrome.sidePanel = {
  setPanelBehavior: value => behavior.push(value),
  setOptions: async value => options.push(value),
  open: async value => opened.push(value),
  close: async () => { throw new Error('Workspace must remain available'); },
 };
 f.context.chrome.action.onClicked = {addListener: fn => {listeners.clicked = fn;}};
 f.context.chrome.tabs.onActivated = {addListener: fn => {listeners.activated = fn;}};
 f.context.chrome.tabs.onUpdated = {addListener: fn => {listeners.updated = fn;}};
 f.context.chrome.tabs.get = async id => ({id, url: 'https://www.miguvideo.com/p/live/120000587094'});
 const source = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')).replace(/^import [\s\S]*?;\s*/gm, '');
 vm.runInContext(source.slice(source.indexOf('chrome.storage.local.setAccessLevel'), source.indexOf('const notify =')), f.context);
 assert.equal(behavior[0].openPanelOnActionClick, false);
 listeners.clicked({id: 7, url: 'https://www.miguvideo.com/p/live/120000587094'});
 assert.equal(opened[0].tabId, 7);
 await listeners.activated({tabId: 7});
 assert.equal(options[0].tabId, 7);
 assert.equal(options[0].enabled, true);
 await vm.runInContext("panelForTab({id: 7, url: 'https://www.youtube.com/watch?v=fixture'})", f.context);
 assert.equal(options[1].enabled, true);
 assert.equal(keyFromUrl('https://www.miguvideo.com/p/live/120000587094'), 'migu:120000587094:1');
 assert.equal(f.stores.videos.size, 0);
 assert.equal(f.stores.notes.size, 0);
});


test('Migu cache is isolated by programme and reuses imported/transcribed captions', async () => {
 const f = await fixture();
 f.inspection.info = {platform:'migu',videoId:'120000587094',page:967772705,title:'English main card',duration:11808,url:'https://www.miguvideo.com/p/live/120000587094'};
 const first = await f.route({type:'LOAD',tabId:1});
 assert.equal(first.needASR,true);
 assert.equal(first.record.videoKey,'migu:120000587094:967772705');
 assert.equal(first.record.focusConfig.overlay,true);
 const raw = normalizeCaptions([{start:10,end:13,text:'The next round begins.'}], 'whisper');
 const saved = await f.route({type:'IMPORT',info:f.inspection.info,raw});
 assert.equal(saved.focusConfig.overlay,true);
 f.inspection.info.duration = 0;
 const restored = await f.route({type:'LOAD',tabId:1});
 assert.equal(restored.record.id,saved.id);
 assert.equal(restored.record.videoInfo.duration,11808);
 f.inspection.info.page = 967772639;
 const chinese = await f.route({type:'LOAD',tabId:1});
 assert.equal(chinese.needASR,true);
 assert.notEqual(chinese.record.videoKey,saved.videoKey);
 assert.equal(chinese.record.rawCaptions.length,0);
 assert.equal(matchesVideoUrl(saved.videoKey,'https://www.miguvideo.com/p/live/999'),false);
 assert.equal(matchesVideoUrl(saved.videoKey,'https://evil.invalid/p/live/120000587094'),false);
});

test('Migu audio recognition continues after saved audio and reuses prior translations', async () => {
 const f = await fixture(), seeks = [], playback = {time:10,duration:180,rate:1,paused:true,isAd:false};
 f.inspection.info = {platform:'migu',videoId:'120000587094',page:967772705,title:'English main card',duration:180,url:'https://www.miguvideo.com/p/live/120000587094'};
 const loaded = await f.route({type:'LOAD',tabId:1});
 const prior = f.stores.videos.get(loaded.record.id);
 prior.rawCaptions = normalizeCaptions([{start:10,end:13,text:'First round.'}], 'whisper');
 prior.sentences = localSentences(prior.rawCaptions);
 prior.sentences[0].translation = '第一回合。';
 prior.paragraphs = paragraphs(prior.sentences);
 prior.transcriptMeta = {...prior.transcriptMeta,source:'whisper',capturedUntil:70};
 const cfg = f.storage.settings;
 prior.tasks = {translation:{signature:JSON.stringify([cfg.provider,cfg.baseUrl,cfg.models?.translation||cfg.model,cfg.targetLanguage,cfg.prompts?.translation||'']),done:[0],failed:[]}};
 f.stores.videos.set(prior.id,prior);
 f.storage.settings = {...f.storage.settings,asrKey:'fixture-asr'};
 f.context.player = async (_tabId, command) => {
  if(command.action==='seek'){seeks.push(command.time);playback.time=command.time;}
  if(command.action==='play')playback.paused=false;
  if(command.action==='pause')playback.paused=true;
  return {...playback,videoKey:prior.videoKey};
 };
 f.context.chrome.offscreen = {hasDocument:async()=>true};
 f.context.chrome.tabCapture = {getMediaStreamId:async()=>'fixture-stream'};
 f.context.chrome.runtime.sendMessage = async m => ({ok:true,data:m.type==='EVENT'?null:true});
 const next = await f.route({type:'CAPTURE_START',recordId:prior.id,tabId:1});
 assert.ok(seeks[0]>=70&&seeks[0]<71,'the saved minute must not be recognized again');
 assert.equal(next.transcriptMeta.asrSegments[0].start,seeks[0]);
 assert.equal(next.transcriptMeta.asrSegments[0].end,seeks[0]+30);
 assert.equal(next.rawCaptions.length,1);
 assert.equal(next.sentences[0].translation,'第一回合。');
 const listener = f.listeners[0],sender={id:'fixture',url:'chrome-extension://fixture/offscreen/index.html'};
 const event = m => new Promise((resolve,reject)=>{
  const pending=listener(m,sender,reply=>reply?.ok?resolve(reply):reject(new Error(reply?.error||'missing reply')));
  if(!pending)reject(new Error('event was not handled'));
 });
 const firstSegment = next.transcriptMeta.asrSegments[0];
 await event({type:'ASR_PROGRESS',recordId:next.id,segmentId:firstSegment.id,status:'capturing'});
 await event({type:'ASR_CHUNK',recordId:next.id,segmentId:firstSegment.id,capturedEnd:100,segments:[{start:71,end:73,text:'Second round.'}],completed:1});
 const saved = f.stores.videos.get(next.id);
 assert.equal(saved.rawCaptions.length,2);
 assert.equal(saved.sentences[0].translation,'第一回合。');
 assert.equal(saved.sentences[1].rawText,'Second round.');
 assert.equal(saved.transcriptMeta.asrSegments[0].status,'source-ready');
 playback.time=130;
 await event({type:'ASR_FINISHED',recordId:next.id});
 assert.equal(f.stores.videos.get(next.id).transcriptMeta.capturedUntil,100);
 assert.equal(seeks.length,1,'continuous recognition does not rewind the player');
});

test('rolling ASR saves each source segment, translates it, and keeps earlier bilingual lines', async () => {
 const f = await fixture(), calls = [], playback = {time:0,duration:300,rate:1,paused:true,isAd:false};
 f.inspection.info = {platform:'migu',videoId:'120000587094',page:967772705,title:'English main card',duration:300,url:'https://www.miguvideo.com/p/live/120000587094'};
 const loaded = await f.route({type:'LOAD',tabId:1});
 f.storage.settings = {...f.storage.settings,asrKey:'fixture-asr',apiKey:'fixture-text'};
 f.context.player = async (_tabId, command) => {
  if(command.action==='play')playback.paused=false;
  if(command.action==='pause')playback.paused=true;
  return {...playback,videoKey:loaded.record.videoKey};
 };
 f.context.chrome.offscreen = {hasDocument:async()=>true};
 f.context.chrome.tabCapture = {getMediaStreamId:async()=>'fixture-stream'};
 f.context.chrome.runtime.sendMessage = async () => ({ok:true});
 f.context.runTask = async (record,capability,_settings,args) => {
  assert.equal(capability,'translation');
  calls.push([...args.selectedIds]);
  for(const row of record.sentences)
   if(args.selectedIds.includes(row.id))row.translation='中：'+row.rawText;
  return {record,errors:[]};
 };
 const started = await f.route({type:'CAPTURE_START',recordId:loaded.record.id,tabId:1});
 assert.deepEqual(Array.from(started.transcriptMeta.asrSegments.slice(0,2),s=>[s.start,s.end]),[[0,30],[30,150]]);
 const listener = f.listeners[0],sender={id:'fixture',url:'chrome-extension://fixture/offscreen/index.html'};
 const event = m => new Promise((resolve,reject)=>{
  const pending=listener(m,sender,reply=>reply?.ok?resolve(reply):reject(new Error(reply?.error||'missing reply')));
  if(!pending)reject(new Error('event was not handled'));
 });
 const [first,second,third] = started.transcriptMeta.asrSegments;
 await event({type:'ASR_PROGRESS',recordId:started.id,segmentId:first.id,status:'capturing'});
 await event({type:'ASR_PROGRESS',recordId:started.id,segmentId:first.id,status:'recognizing'});
 await event({type:'ASR_CHUNK',recordId:started.id,segmentId:first.id,capturedEnd:30,segments:[{start:1,end:3,text:'Hello.'}],completed:1});
 await vm.runInContext('capture.translationQueue',f.context);
 assert.equal(f.stores.videos.get(started.id).sentences[0].translation,'中：Hello.');
 assert.equal(f.stores.videos.get(started.id).transcriptMeta.asrSegments[0].status,'done');
 await event({type:'ASR_CHUNK',recordId:started.id,segmentId:second.id,capturedEnd:100,segments:[{start:31,end:34,text:'How are you?'}],completed:2});
 await vm.runInContext('capture.translationQueue',f.context);
 const saved = f.stores.videos.get(started.id);
 assert.deepEqual(Array.from(saved.sentences,s=>s.translation),['中：Hello.','中：How are you?']);
 assert.equal(saved.transcriptMeta.asrSegments[1].status,'done');
 assert.equal(saved.transcriptMeta.asrSegments[1].end,100);
 assert.equal(saved.transcriptMeta.asrSegments[2].status,'interrupted');
 assert.equal(saved.transcriptMeta.asrSegments[2].start,100);
 assert.equal(saved.transcriptMeta.asrSegments[2].end,150);
 assert.deepEqual(calls.map(ids=>ids.length),[1,1],'previous bilingual lines must not be sent again');
 await event({type:'ASR_PROGRESS',recordId:started.id,segmentId:third.id,status:'failed',error:'ASR unavailable'});
 await event({type:'ASR_FINISHED',recordId:started.id,error:'ASR unavailable'});
 const finished=f.stores.videos.get(started.id);
 assert.equal(finished.transcriptMeta.asrSegments.find(s=>s.id===third.id).status,'failed');
 assert.equal(finished.transcriptMeta.asrSegments[4].status,'pending');
 assert.equal(finished.transcriptMeta.partial,true);
});
