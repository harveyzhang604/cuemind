import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {speechSettings} from '../extension/services/speech.js';
import {defaults} from '../extension/services/ai-provider.js';
import {groundedTranslation} from '../extension/services/tasks.js';
import {validateBackup} from '../extension/core/backup.js';
import {validateSettings} from '../extension/services/settings.js';
import {normalizeCaptions,deduplicateAsrCaptions,splitTimedCaptions,splitAsrCaptions,videoKey,SCHEMA_VERSION} from '../extension/core/transcript.js';
import {localSentences,paragraphs} from '../extension/core/sentence.js';
import {keyFromUrl,matchesVideoUrl} from '../extension/core/video.js';
import {captureClockProblem,planAsrSegments,skipRecognizedAudio} from '../extension/core/asr-progress.js';
import {canReuseTranscript,mismatchedOriginalTrack} from '../extension/services/platform.js';
import {taskConflict} from '../extension/core/task-lock.js';
import {clearLearningCache,dataActions} from '../extension/core/local-data.js';
import {recoverEquivalentLearning,recoverOrphanedFocus} from '../extension/core/record-recovery.js';
import {selectFocusConfig} from '../extension/core/focus.js';
import {explanationCacheKey} from '../extension/services/explanation-cache.js';
async function fixture(existingStorage){
 const noop=()=>{},listeners=[],stores={videos:new Map(),notes:new Map(),chats:new Map(),audio:new Map(),aiCache:new Map()},storage=existingStorage||{settings:{...defaults,transcriptProvider:'supadata',supadataApiKey:'fixture'}};
 const inspection={info:{platform:'youtube',videoId:'sHieyY4r0-k',page:1,title:'Fixture',duration:30,audioLanguage:'en',url:'https://www.youtube.com/watch?v=sHieyY4r0-k'},tracks:[]};
 const audioClips=async key=>[...stores.audio.values()].filter(clip=>!key||clip.videoKey===key).map(({blob,...clip})=>clip);
 const audioCoverage=clips=>({ranges:clips.map(clip=>({start:clip.start,end:clip.end}))});
 const saveAudio=async clip=>{stores.audio.set(clip.videoKey+':'+clip.segmentId,{...clip,id:clip.videoKey+':'+clip.segmentId,bytes:clip.blob.size});};
 const context={checkSpeechNetwork:async()=>({status:405}),speechSettings,groundedTranslation,console,URL,DOMException,AbortController,ReadableStream,Blob,structuredClone,crypto:globalThis.crypto,Date,Map,Set,setInterval:noop,setTimeout:()=>1,clearTimeout:noop,defaults,validateSettings,normalizeCaptions,deduplicateAsrCaptions,splitTimedCaptions,splitAsrCaptions,videoKey,SCHEMA_VERSION,localSentences,paragraphs,keyFromUrl,matchesVideoUrl,captureClockProblem,planAsrSegments,skipRecognizedAudio,canReuseTranscript,mismatchedOriginalTrack,selectFocusConfig,taskConflict,clearLearningCache,dataActions,recoverEquivalentLearning,recoverOrphanedFocus,inspection,audioClips,audioCoverage,saveAudio,getAudio:async id=>stores.audio.get(id),fetch,inspectAudioSource:()=>{},
 db:{get:async(name,id)=>structuredClone(stores[name].get(id)),all:async name=>structuredClone([...stores[name].values()]),put:async(name,value)=>{stores[name].set(value.id,structuredClone(value));return value;},remove:async(name,id)=>stores[name].delete(id),deleteVideoHistory:async key=>{const ids=[...stores.videos.values()].filter(v=>v.videoKey===key).map(v=>v.id);for(const [name,store] of Object.entries(stores)){if(name==='aiCache'){store.clear();continue;}for(const [id,value] of store)if(value.videoKey===key||ids.includes(value.recordId))store.delete(id);}return ids;},updateNote:async(id,expected,change)=>{const n=stores.notes.get(id);if(n?.updatedAt!==expected)return null;const next={...n,...change};stores.notes.set(id,structuredClone(next));return next;},manage:async(action,transform)=>{if(action==='reset'){Object.values(stores).forEach(s=>s.clear());}else if(action==='delete-notes')stores.notes.clear();else{stores.chats.clear();for(const [id,r]of stores.videos)stores.videos.set(id,transform(r));}}},
 chrome:{storage:{local:{setAccessLevel:noop,get:async k=>({[k]:storage[k]}),set:async v=>Object.assign(storage,v),remove:async k=>{delete storage[k];},clear:async()=>Object.keys(storage).forEach(k=>delete storage[k])}},sidePanel:{setPanelBehavior:noop},action:{onClicked:{addListener:noop}},scripting:{executeScript:async()=>[{result:[]}]},tabs:{get:async()=>({id:1,url:inspection.info.url,status:'complete'}),query:async()=>[{id:1,url:inspection.info.url,status:'complete'}],create:async({url})=>({id:2,url,status:'complete'}),update:async()=>{},remove:async()=>{},sendMessage:async()=>({ok:true,data:{time:.6,isAd:false}}),onRemoved:{addListener:noop}},permissions:{contains:async()=>true},runtime:{id:'fixture',getURL:path=>'chrome-extension://fixture/'+path,sendMessage:async()=>{},onMessage:{addListener:fn=>listeners.push(fn)}}}};
 context.cachedCompletion=(...args)=>context.completion(...args.slice(0,5));
 const source=(await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import [\s\S]*?;\s*/gm,'');vm.createContext(context);vm.runInContext(source+'\npage=async()=>structuredClone(inspection);globalThis.router=route;',context);return {context,stores,storage,inspection,listeners,route:context.router};
}
test('learning history keeps video links and independently downloaded audio',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:normalizeCaptions([{start:0,end:2,text:'Study this video.'}]),language:'en'});
 const {record}=await f.route({type:'LOAD',tabId:1});
 let history=await f.route({type:'AUDIO_LIBRARY'});
 assert.equal(history[0].url,'https://www.youtube.com/watch?v=sHieyY4r0-k');
 assert.equal(history[0].clips.length,0);
 const mediaUrl='https://rr1.googlevideo.com/videoplayback?id=fixture';
 f.context.chrome.scripting.executeScript=async()=>[{result:[{url:mediaUrl,mimeType:'audio/mp4',bytes:4}]}];
 f.context.fetch=async()=>({ok:true,status:200,url:mediaUrl,headers:{get:()=> '4'},body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3,4]));controller.close();}})});
 assert.equal((await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1})).state,'saving');
 for(let i=0;i<20 && !f.stores.audio.size;i++)await new Promise(resolve=>setImmediate(resolve));
 history=await f.route({type:'AUDIO_LIBRARY'});
 assert.equal(history[0].clips.length,1);
 assert.equal(history[0].clips[0].start,0);
 assert.equal(history[0].clips[0].end,30);
 assert.equal(f.stores.audio.values().next().value.blob.size,4);
 assert.equal((await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1})).state,'saved');
});
test('Bilibili English audio never reuses a cached Chinese translation as the original',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'bilibili',videoId:'BVfixture',page:1,title:'【Easy English】英语口语练习',duration:60,audioLanguage:'en',url:'https://www.bilibili.com/video/BVfixture/?p=1'};
 f.inspection.tracks=[{id:'zh-track',language:'ai-zh',label:'中文',isAi:true}];
 const key=videoKey(f.inspection.info),old={id:key+':zh-track',videoKey:key,videoInfo:f.inspection.info,rawCaptions:[{id:'old',start:0,end:3,text:'你好'}],transcriptMeta:{source:'bilibili_native',trackId:'zh-track',language:'ai-zh'},schemaVersion:SCHEMA_VERSION,updatedAt:1};
 f.stores.videos.set(old.id,old);f.storage['lastRecord:'+key]=old.id;
 const result=await f.route({type:'LOAD',tabId:1,trackId:'auto',videoKey:key});
 assert.equal(result.needASR,true);
 assert.equal(result.record.transcriptMeta.source,'bilibili_audio');
 assert.equal(result.record.sentences.length,0);
 assert.match(result.warning,/原声音频语言不一致/);
 assert.equal(f.stores.videos.get(old.id).rawCaptions.length,1);
});
test('unknown Bilibili audio does not discard saved Chinese narration based on its English lesson title',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'bilibili',videoId:'BVfixture',page:1,title:'英语口语：中文讲解',duration:60,audioLanguage:'',url:'https://www.bilibili.com/video/BVfixture/?p=1'};
 f.inspection.tracks=[{id:'zh-track',language:'ai-zh',label:'中文',isAi:true}];
 const key=videoKey(f.inspection.info),old={id:key+':zh-track',videoKey:key,videoInfo:f.inspection.info,rawCaptions:[{id:'old',start:0,end:3,text:'今天讲英语口语。'}],sentences:[],transcriptMeta:{source:'bilibili_native',trackId:'zh-track',language:'ai-zh'},schemaVersion:SCHEMA_VERSION,updatedAt:1};
 f.stores.videos.set(old.id,old);f.storage['lastRecord:'+key]=old.id;
 const result=await f.route({type:'LOAD',tabId:1,trackId:'auto',videoKey:key});
 assert.equal(result.cached,true);
 assert.equal(result.record.id,old.id);
 assert.equal(result.record.rawCaptions[0].text,'今天讲英语口语。');
 assert.match(result.warning,/未提供原声语言/);
});
test('automatic audio save refreshes an expired CDN URL before using playback',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:[],language:'en'});
 const {record}=await f.route({type:'LOAD',tabId:1});
 let inspections=0,fetches=0;
 f.context.chrome.scripting.executeScript=async()=>[{result:[{url:`https://rr1.googlevideo.com/videoplayback?generation=${++inspections}`,mimeType:'audio/mp4',bytes:4}]}];
 f.context.fetch=async url=> ++fetches===1 ? {ok:false,status:403,url} : {ok:true,status:200,url,headers:{get:()=> '4'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3,4]));c.close();}})};
 await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1});
 for(let i=0;i<40&&!f.stores.audio.size;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(inspections,2);assert.equal(fetches,2);
 assert.equal((await f.route({type:'AUDIO_LIBRARY'}))[0].audioStatus.state,'saved');
 assert.equal(await f.route({type:'CAPTURE_STATUS'}),null);
});
test('automatic Bilibili fallback saves full audio and restores the original player without changing captions',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'bilibili',videoId:'BVfixture',page:1,title:'Fixture',duration:30,audioLanguage:'en',url:'https://www.bilibili.com/video/BVfixture/?p=1'};
 const {record}=await f.route({type:'LOAD',tabId:1});
 const before=structuredClone(f.stores.videos.get(record.id));
 const url='https://a.hdslb.com/audio.m4s';
 f.context.chrome.scripting.executeScript=async()=>[{result:[{url,mimeType:'audio/mp4',bytes:4}]}];
 f.context.fetch=async()=>({ok:false,status:403,url});
 const commands=[],state={time:7,duration:30,paused:true,rate:1.5,readyState:4,seeking:false,isAd:false,videoKey:record.videoKey};
 f.context.chrome.tabs.sendMessage=async(_id,m)=>{commands.push(m);if(m.action==='seek')state.time=m.time;if(m.action==='play')state.paused=false;if(m.action==='pause')state.paused=true;if(m.action==='rate')state.rate=m.rate;return {ok:true,data:structuredClone(state)};};
 f.context.chrome.offscreen={hasDocument:async()=>true};f.context.chrome.tabCapture={getMediaStreamId:async()=> 'stream'};f.context.chrome.runtime.sendMessage=async()=>({ok:true});
 await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1});
 for(let i=0;i<40&&!commands.some(x=>x.action==='play');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(commands.some(x=>x.action==='seek'&&x.time===0));
 await f.context.saveAudio({videoKey:record.videoKey,recordId:record.id,segmentId:'full',start:0,end:30,blob:new Blob([new Uint8Array(1500)],{type:'audio/webm'})});
 const send=message=>new Promise(resolve=>f.listeners[0](message,{id:'fixture',url:'chrome-extension://fixture/offscreen/index.html'},resolve));
 assert.equal((await send({type:'ASR_FINISHED',recordId:record.id})).ok,true);
 assert.equal(state.time,7);assert.equal(state.paused,true);assert.equal(state.rate,1.5);
 assert.equal((await f.route({type:'AUDIO_LIBRARY'}))[0].audioStatus.state,'saved');
 assert.deepEqual(f.stores.videos.get(record.id),before);
});
test('unavailable direct audio leaves history intact and can be retried',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:[],language:'en'});
 const {record}=await f.route({type:'LOAD',tabId:1});
 const mediaUrl='https://rr1.googlevideo.com/videoplayback?id=fixture';
 f.context.chrome.scripting.executeScript=async()=>[{result:[{url:mediaUrl,mimeType:'audio/mp4',bytes:4}]}];
 f.context.fetch=async()=>({ok:false,status:403,url:mediaUrl});
 await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1});
 let history;
 for(let i=0;i<20;i++){history=await f.route({type:'AUDIO_LIBRARY'});if(history[0].audioStatus?.state==='failed')break;await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(history[0].clips.length,0);
 assert.equal(history[0].audioStatus.state,'failed');
 assert.equal(history[0].url,'https://www.youtube.com/watch?v=sHieyY4r0-k');
 f.context.fetch=async()=>({ok:true,status:200,url:mediaUrl,headers:{get:()=> '4'},body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3,4]));controller.close();}})});
 assert.equal((await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1,retry:true})).state,'saving');
 for(let i=0;i<20 && !f.stores.audio.size;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.stores.audio.size,1);
});
test('deleting a history item removes every revision and related learning data',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:normalizeCaptions([{start:0,end:2,text:'Save this.'}]),language:'en'});
 const {record}=await f.route({type:'LOAD',tabId:1});
 const copy={...structuredClone(record),id:record.id+':revision'};f.stores.videos.set(copy.id,copy);
 f.stores.notes.set('note',{id:'note',recordId:record.id,videoKey:record.videoKey});
 f.stores.chats.set('chat',{id:'chat',recordId:copy.id});
 f.stores.audio.set('audio',{id:'audio',recordId:record.id,videoKey:record.videoKey,bytes:10,start:0,end:2});
 f.stores.aiCache.set('shared',{id:'shared',value:'cached result'});
 f.storage['watch:'+record.videoKey]={time:42};
 f.storage['reading:'+record.videoKey]={scrollY:100};
 assert.equal((await f.route({type:'AUDIO_LIBRARY'})).length,1);
 assert.equal(await f.route({type:'DELETE_VIDEO_HISTORY',videoKey:record.videoKey}),true);
 assert.equal((await f.route({type:'AUDIO_LIBRARY'})).length,0);
 for(const store of Object.values(f.stores))assert.equal(store.size,0);
 assert.equal(f.storage['lastRecord:'+record.videoKey],undefined);
 assert.equal(f.storage['watch:'+record.videoKey],undefined);
 assert.equal(f.storage['reading:'+record.videoKey],undefined);
});
test('Migu full-audio capture starts at zero and never writes fake ASR results',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'migu',videoId:'120000587094',page:967772705,title:'Main card',duration:20,url:'https://www.miguvideo.com/p/live/120000587094'};
 const {record}=await f.route({type:'LOAD',tabId:1});
 const commands=[];
 f.context.chrome.tabs.sendMessage=async(_id,m)=>{commands.push(m);return {ok:true,data:{time:0,duration:20,paused:false,rate:1,readyState:4,seeking:false,isAd:false,videoKey:record.videoKey}};};
 f.context.chrome.offscreen={hasDocument:async()=>true};
 f.context.chrome.tabCapture={getMediaStreamId:async()=> 'stream'};
 f.context.chrome.runtime.sendMessage=async()=>({ok:true});
 assert.equal((await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1,retry:true})).state,'saving');
 for(let i=0;i<40&&!commands.some(x=>x.action==='play');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(commands.some(x=>x.action==='seek'&&x.time===0));
 assert.ok(commands.some(x=>x.action==='play'));
 assert.equal(f.stores.videos.get(record.id).transcriptMeta.asrSegments?.length||0,0);
 const clip={videoKey:record.videoKey,recordId:record.id,segmentId:'captured',start:0,end:20,blob:new Blob([new Uint8Array(1500)],{type:'audio/webm'})};
 await f.context.saveAudio(clip);
 const sender={id:'fixture',url:'chrome-extension://fixture/offscreen/index.html'};
 const send=message=>new Promise(resolve=>f.listeners[0](message,sender,resolve));
 assert.equal((await send({type:'ASR_CHUNK',recordId:record.id,segmentId:'captured',completed:1})).ok,true);
 assert.equal((await send({type:'ASR_FINISHED',recordId:record.id})).ok,true);
 const history=await f.route({type:'AUDIO_LIBRARY'});
 assert.equal(history[0].audioStatus.state,'saved');
 assert.equal(f.stores.videos.get(record.id).transcriptMeta.asrSegments?.length||0,0);
});
test('automatic YouTube save falls back to playback capture when a direct audio URL is denied',async()=>{
 const f=await fixture();f.context.fetchSupadata=async()=>({raw:[],language:'en'});
 const {record}=await f.route({type:'LOAD',tabId:1});
 const mediaUrl='https://rr1.googlevideo.com/videoplayback?id=fixture';
 f.context.chrome.scripting.executeScript=async()=>[{result:[{url:mediaUrl,mimeType:'audio/mp4',bytes:4}]}];
 f.context.fetch=async()=>({ok:false,status:403,url:mediaUrl});
 const commands=[];
 f.context.chrome.tabs.sendMessage=async(_id,m)=>{commands.push(m);return {ok:true,data:{time:0,duration:30,paused:false,rate:1,readyState:4,seeking:false,isAd:false,videoKey:record.videoKey}};};
 f.context.chrome.offscreen={hasDocument:async()=>true};
 f.context.chrome.tabCapture={getMediaStreamId:async()=> 'stream'};
 f.context.chrome.runtime.sendMessage=async()=>({ok:true});
 assert.equal((await f.route({type:'SAVE_VIDEO_AUDIO',recordId:record.id,tabId:1})).state,'saving');
 for(let i=0;i<40&&!commands.some(x=>x.action==='play');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(commands.some(x=>x.action==='seek'&&x.time===0));
 assert.equal((await f.route({type:'AUDIO_LIBRARY'}))[0].audioStatus.method,'playback');
 assert.equal(f.stores.videos.get(record.id).transcriptMeta.asrSegments?.length||0,0);
});
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
 assert.deepEqual(Array.from(queries.url),['https://www.youtube.com/*','https://www.bilibili.com/*','https://www.miguvideo.com/*','https://miguvideo.com/*']);
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

test('Migu audio recognition resumes saved audio but invalidates legacy ungrounded translations', async () => {
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
 f.storage.settings = {...f.storage.settings,asrRouting:'platform',asrKey:'fixture-overseas',domesticAsrKey:'fixture-domestic'};
 f.context.player = async (_tabId, command) => {
  if(command.action==='seek'){seeks.push(command.time);playback.time=command.time;}
  if(command.action==='play')playback.paused=false;
  if(command.action==='pause')playback.paused=true;
  return {...playback,videoKey:prior.videoKey};
 };
 f.context.chrome.offscreen = {hasDocument:async()=>true};
 f.context.chrome.tabCapture = {getMediaStreamId:async()=>'fixture-stream'};
 let speechConfig;
 f.context.chrome.runtime.sendMessage = async m => {if(m.type==='START')speechConfig=m.settings;return {ok:true,data:m.type==='EVENT'?null:true};};
 const next = await f.route({type:'CAPTURE_START',recordId:prior.id,tabId:1});
 assert.equal(speechConfig.asrKey,'fixture-domestic');
 assert.equal(speechConfig.asrModel,'qwen-audio-3.1-asr-flash');
 assert.ok(seeks[0]>=70&&seeks[0]<71,'the saved minute must not be recognized again');
 assert.equal(next.transcriptMeta.asrSegments[0].start,seeks[0]);
 assert.equal(next.transcriptMeta.asrSegments[0].end,seeks[0]+10);
 assert.equal(next.rawCaptions.length,1);
 assert.equal(next.sentences[0].translation,undefined);
 const listener = f.listeners[0],sender={id:'fixture',url:'chrome-extension://fixture/offscreen/index.html'};
 const event = m => new Promise((resolve,reject)=>{
  const pending=listener(m,sender,reply=>reply?.ok?resolve(reply):reject(new Error(reply?.error||'missing reply')));
  if(!pending)reject(new Error('event was not handled'));
 });
 const firstSegment = next.transcriptMeta.asrSegments[0];
 await event({type:'ASR_PROGRESS',recordId:next.id,segmentId:firstSegment.id,status:'capturing'});
 await event({type:'ASR_CHUNK',recordId:next.id,segmentId:firstSegment.id,capturedEnd:80,segments:[{start:71,end:73,text:'Second round.'}],completed:1});
 const saved = f.stores.videos.get(next.id);
 assert.equal(saved.rawCaptions.length,2);
 assert.equal(saved.sentences[0].translation,undefined);
 assert.equal(saved.sentences[1].rawText,'Second round.');
 assert.equal(saved.transcriptMeta.asrSegments[0].status,'source-ready');
 playback.time=130;
 await event({type:'ASR_FINISHED',recordId:next.id});
 assert.equal(f.stores.videos.get(next.id).transcriptMeta.capturedUntil,80);
 assert.equal(seeks.length,1,'continuous recognition does not rewind the player');
});

test('saved Migu ASR paragraphs split on load without discarding correct short translations',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'migu',videoId:'120000587094',page:967772705,title:'Fixture',duration:200,url:'https://www.miguvideo.com/p/live/120000587094'};
 const loaded=await f.route({type:'LOAD',tabId:1});
 const old=f.stores.videos.get(loaded.record.id);
 old.rawCaptions=normalizeCaptions([{start:1,end:3,text:'Already done.'},{start:3,end:18,text:'He was great.And then he left.He came back.'}],'whisper');
 old.sentences=localSentences(old.rawCaptions);
 old.sentences[0].translation='已经完成。';old.sentences[1].translation='旧段落译文。';
 old.paragraphs=paragraphs(old.sentences);
 old.transcriptMeta={...old.transcriptMeta,source:'whisper',translationRevision:2,asrSegments:[{id:'seg',start:1,end:18,status:'done'}]};
 old.tasks={translation:{signature:'same-model',done:[0],failed:[]}};
 f.stores.videos.set(old.id,old);
 const next=await f.route({type:'GET_RECORD',recordId:old.id});
 assert.deepEqual(next.sentences.map(s=>s.rawText),['Already done.','He was great.','And then he left.','He came back.']);
 assert.equal(next.sentences[0].translation,'已经完成。');
 assert.ok(next.sentences.slice(1).every(s=>!s.translation));
 assert.equal(next.transcriptMeta.asrSegments[0].status,'source-ready');
 assert.equal(next.tasks.translation.signature,'same-model');
 assert.equal(next.tasks.translation.done.length,0);
 assert.equal(validateBackup({format:'cuemind',version:1,videos:[structuredClone(next)],notes:[],chats:[]}).videos.length,1);
 assert.equal((await f.route({type:'GET_RECORD',recordId:old.id})).sentences.length,4);
});
test('matching old bilingual paragraphs reuse sentence-aligned translations without model calls',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'migu',videoId:'120000587094',page:967772705,title:'Fixture',duration:100,url:'https://www.miguvideo.com/p/live/120000587094'};
 const loaded=await f.route({type:'LOAD',tabId:1});
 const old=f.stores.videos.get(loaded.record.id);
 const source='He was great.And then he left.He came back.';
 const translation='他很出色。然后他离开了。后来他回来了。';
 old.rawCaptions=normalizeCaptions([{start:3,end:18,text:source}],'whisper');
 old.sentences=localSentences(old.rawCaptions);
 old.sentences[0].translation=translation;
 old.transcriptMeta={...old.transcriptMeta,source:'whisper',translationRevision:2};
 old.translationCaches={'same-model':{[old.sentences[0].id]:{source,text:translation}}};
 f.stores.videos.set(old.id,old);
 const result=await f.route({type:'GET_RECORD',recordId:old.id});
 assert.equal(result.sentences.length,3);
 assert.deepEqual(Array.from(result.sentences,s=>s.translation),['他很出色。','然后他离开了。','后来他回来了。']);
 assert.equal(result.translationCaches['same-model'][result.sentences[2].id].source,'He came back.');
 const migrated=f.stores.videos.get(old.id);
 migrated.sentences.forEach(s=>delete s.translation);
 migrated.transcriptMeta.alignedTranslationRevision=undefined;
 migrated.translationCaches={'same-model':{[old.sentences[0].id]:{source,text:translation}}};
 f.stores.videos.set(old.id,migrated);
 const recovered=await f.route({type:'GET_RECORD',recordId:old.id});
 assert.equal(recovered.sentences.filter(s=>s.translation).length,3,'already-split records can reuse the old paragraph cache');
});
test('translated sentence spanning ASR chunks completes both saved progress rows',async()=>{
 const f=await fixture();
 f.inspection.info={platform:'migu',videoId:'120000587094',page:967772705,title:'Fixture',duration:20,url:'https://www.miguvideo.com/p/live/120000587094'};
 const loaded=await f.route({type:'LOAD',tabId:1});
 const record=f.stores.videos.get(loaded.record.id);
 record.transcriptMeta={...record.transcriptMeta,source:'whisper',translationRevision:2,sentenceRevision:4,alignedTranslationRevision:1,asrSegments:[{id:'first',start:8,end:10,status:'source-ready'},{id:'second',start:10,end:15,status:'source-ready'}]};
 record.sentences=[{id:'s0',start:8,end:15,rawText:'A sentence crosses the recording boundary.',sourceIds:['r0']}];
 f.stores.videos.set(record.id,record);
 f.storage.settings.apiKey='fixture';
 f.context.runTask=async r=>{r.sentences[0].translation='一句话跨越了录音边界。';return {record:r,errors:[]};};
 const result=await f.route({type:'TASK',recordId:record.id,capability:'translation',args:{}});
 assert.deepEqual(result.record.transcriptMeta.asrSegments.map(segment=>segment.status),['done','done']);
 const stale=f.stores.videos.get(record.id);
 stale.transcriptMeta.asrSegments[1].status='source-ready';
 f.stores.videos.set(record.id,stale);
 const recovered=await f.route({type:'GET_RECORD',recordId:record.id});
 assert.equal(recovered.transcriptMeta.asrSegments[1].status,'done');
});

test('unreachable ASR stops before capturing audio or replacing saved captions', async()=>{
 const f=await fixture();
 f.inspection.info={platform:'migu',videoId:'120000587094',page:967772705,title:'Fixture',duration:300,url:'https://www.miguvideo.com/p/live/120000587094'};
 const loaded=await f.route({type:'LOAD',tabId:1});
 f.storage.settings={...f.storage.settings,asrRouting:'platform',domesticAsrKey:'fixture'};
 let starts=0;
 f.context.chrome.runtime.sendMessage=async m=>{if(m.type==='START')starts++;return {ok:true};};
 f.context.checkSpeechNetwork=async()=>{throw new Error('Network unavailable');};
 await assert.rejects(()=>f.route({type:'CAPTURE_START',recordId:loaded.record.id,tabId:1}),/Network unavailable/);
 assert.equal(starts,0);assert.equal(f.stores.videos.size,1);
 assert.equal(await f.route({type:'CAPTURE_STATUS'}),null);
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
 assert.deepEqual(Array.from(started.transcriptMeta.asrSegments.slice(0,2),s=>[s.start,s.end]),[[0,10],[10,70]]);
 const listener = f.listeners[0],sender={id:'fixture',url:'chrome-extension://fixture/offscreen/index.html'};
 const event = m => new Promise((resolve,reject)=>{
  const pending=listener(m,sender,reply=>reply?.ok?resolve(reply):reject(new Error(reply?.error||'missing reply')));
  if(!pending)reject(new Error('event was not handled'));
 });
 const [first,second,third] = started.transcriptMeta.asrSegments;
 await event({type:'ASR_PROGRESS',recordId:started.id,segmentId:first.id,status:'capturing'});
 await event({type:'ASR_PROGRESS',recordId:started.id,segmentId:first.id,status:'recognizing',audioBytes:1500,audioLevel:.12});
 assert.equal(f.stores.videos.get(started.id).transcriptMeta.asrSegments[0].audioBytes,1500);
 assert.equal(f.stores.videos.get(started.id).transcriptMeta.asrSegments[0].audioLevel,.12);
 await event({type:'ASR_CHUNK',recordId:started.id,segmentId:first.id,capturedEnd:10,segments:[{start:1,end:3,text:'Hello.'}],completed:1});
 await vm.runInContext('capture.translationQueue',f.context);
 assert.equal(f.stores.videos.get(started.id).sentences[0].translation,'中：Hello.');
 assert.equal(f.stores.videos.get(started.id).transcriptMeta.asrSegments[0].status,'done');
 await event({type:'ASR_CHUNK',recordId:started.id,segmentId:second.id,capturedEnd:60,segments:[{start:11,end:14,text:'How are you?'}],completed:2});
 await vm.runInContext('capture.translationQueue',f.context);
 const saved = f.stores.videos.get(started.id);
 assert.deepEqual(Array.from(saved.sentences,s=>s.translation),['中：Hello.','中：How are you?']);
 assert.equal(saved.transcriptMeta.asrSegments[1].status,'done');
 assert.equal(saved.transcriptMeta.asrSegments[1].end,60);
 assert.equal(saved.transcriptMeta.asrSegments[2].status,'pending');
 assert.equal(saved.transcriptMeta.asrSegments[2].start,60);
 assert.equal(saved.transcriptMeta.asrSegments[2].end,70);
 assert.deepEqual(calls.map(ids=>ids.length),[1,1],'previous bilingual lines must not be sent again');
 await event({type:'ASR_PROGRESS',recordId:started.id,segmentId:third.id,status:'failed',error:'ASR unavailable'});
 await event({type:'ASR_FINISHED',recordId:started.id,error:'ASR unavailable'});
 const finished=f.stores.videos.get(started.id);
 assert.equal(finished.transcriptMeta.asrSegments.find(s=>s.id===third.id).status,'failed');
 assert.equal(finished.transcriptMeta.asrSegments[4].status,'pending');
 assert.equal(finished.transcriptMeta.partial,true);
});
test('retrying interrupted full-audio capture resumes from saved coverage with overlap', async () => {
  const f = await fixture();
  f.context.fetchSupadata = async () => ({ raw: [], language: 'en' });
  const { record } = await f.route({ type: 'LOAD', tabId: 1 });
  await f.context.saveAudio({
    videoKey: record.videoKey,
    recordId: record.id,
    segmentId: 'previous',
    start: 0,
    end: 12,
    blob: new Blob([new Uint8Array(1500)], { type: 'audio/webm' }),
  });
  const mediaUrl = 'https://rr1.googlevideo.com/videoplayback?id=fixture';
  f.context.chrome.scripting.executeScript = async () => [
    { result: [{ url: mediaUrl, mimeType: 'audio/mp4', bytes: 4 }] },
  ];
  f.context.fetch = async () => ({ ok: false, status: 403, url: mediaUrl });
  const commands = [];
  let time = 0;
  f.context.chrome.tabs.sendMessage = async (_id, m) => {
    commands.push(m);
    if (m.action === 'seek') time = m.time;
    return {
      ok: true,
      data: {
        time,
        duration: 30,
        paused: false,
        rate: 1,
        readyState: 4,
        seeking: false,
        isAd: false,
        videoKey: record.videoKey,
      },
    };
  };
  f.context.chrome.offscreen = { hasDocument: async () => true };
  f.context.chrome.tabCapture = { getMediaStreamId: async () => 'stream' };
  f.context.chrome.runtime.sendMessage = async () => ({ ok: true });
  assert.equal(
    (await f.route({ type: 'SAVE_VIDEO_AUDIO', recordId: record.id, tabId: 1, retry: true })).state,
    'saving',
  );
  for (let i = 0; i < 40 && !commands.some((x) => x.action === 'play'); i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.find((x) => x.action === 'seek')?.time, 10);
  assert.ok(commands.some((x) => x.action === 'play'));
});
test('recognizing saved audio fills a missing ASR progress segment', async () => {
  const f = await fixture();
  f.context.fetchSupadata = async () => ({ raw: [], language: 'en' });
  const { record } = await f.route({ type: 'LOAD', tabId: 1 });
  await f.context.saveAudio({
    videoKey: record.videoKey,
    recordId: record.id,
    segmentId: 'saved-gap',
    start: 10,
    end: 20,
    blob: new Blob([new Uint8Array(100)], { type: 'audio/webm' }),
  });
  const clipId = `${record.videoKey}:saved-gap`;
  f.context.cachedTranscribe = async () => [{ start: 1, end: 3, text: 'Recognized words.' }];
  const updated = await f.route({
    type: 'RETRY_SAVED_AUDIO',
    recordId: record.id,
    clipId,
    dataUrl: 'data:audio/webm;base64,AA==',
  });
  assert.ok(updated.sentences.some((sentence) => sentence.rawText === 'Recognized words.'));
  assert.ok(
    updated.transcriptMeta.asrSegments.some(
      (segment) => segment.id === 'saved-gap' && segment.status === 'source-ready',
    ),
  );
});
test('saved-audio retry completes translation in the background before reporting success', async () => {
  const f = await fixture();
  f.storage.settings.apiKey = 'fixture';
  f.context.fetchSupadata = async () => ({ raw: [], language: 'en' });
  const { record } = await f.route({ type: 'LOAD', tabId: 1 });
  await f.context.saveAudio({
    videoKey: record.videoKey,
    recordId: record.id,
    segmentId: 'translated-gap',
    start: 10,
    end: 20,
    blob: new Blob([new Uint8Array(100)], { type: 'audio/webm' }),
  });
  f.context.cachedTranscribe = async () => [{ start: 1, end: 3, text: 'Recognized words.' }];
  f.context.runTask = async (updated, capability, _settings, args, _signal, store) => {
    assert.equal(capability, 'translation');
    for (const sentence of updated.sentences)
      if (args.selectedIds.includes(sentence.id)) sentence.translation = '已识别。';
    await store(updated);
    return { errors: [] };
  };
  const updated = await f.route({
    type: 'RETRY_SAVED_AUDIO',
    recordId: record.id,
    clipId: `${record.videoKey}:translated-gap`,
    dataUrl: 'data:audio/webm;base64,AA==',
  });
  assert.ok(updated.sentences.some((sentence) => sentence.translation === '已识别。'));
  assert.ok(
    updated.transcriptMeta.asrSegments.some(
      (segment) => segment.id === 'translated-gap' && segment.status === 'done',
    ),
  );
});
