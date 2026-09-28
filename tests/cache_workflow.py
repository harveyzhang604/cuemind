"""Exercise every generated text capability against persistent IndexedDB caching."""
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright
from browser_support import chromium_options
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p,tempfile.TemporaryDirectory(prefix='cuemind-cache-audit-') as profile:
 context=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
 worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
 page=context.new_page();page.goto(f'chrome-extension://{worker.url.split(chr(47))[2]}/manifest.json');page.wait_for_load_state('networkidle')
 result=page.evaluate('''async()=>{
 const legacy=await new Promise((resolve,reject)=>{const request=indexedDB.open('cuemind',1);request.onupgradeneeded=()=>{for(const name of ['videos','notes','chats'])request.result.createObjectStore(name,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 await new Promise((resolve,reject)=>{const t=legacy.transaction('notes','readwrite');t.objectStore('notes').put({id:'legacy-note',body:'Keep me'});t.oncomplete=resolve;t.onerror=()=>reject(t.error);});legacy.close();
 const {runTask}=await import('../services/tasks.js'),{cachedCompletion,cachedTranscribe}=await import('../services/completion-cache.js'),db=await import('../storage/db.js');
 const {selectFocusConfig}=await import('../core/focus.js');
 const cfg={provider:'openai',apiKey:'FIXTURE',asrKey:'FIXTURE',baseUrl:'https://example.com/v1',model:'fixture',targetLanguage:'简体中文'};
 const raw=Array.from({length:4},(_,i)=>({id:'raw'+i,start:i*3,end:i*3+3,text:'Learning sentence '+i+'.'}));
 const record={id:'fixture',videoKey:'youtube:fixture:1',videoInfo:{title:'Fixture',duration:12},rawCaptions:raw,sentences:raw.map((s,i)=>({id:'s'+i,start:s.start,end:s.end,rawText:s.text,sourceIds:[s.id]})),paragraphs:[]};
 let calls=0;globalThis.fetch=async(url,init)=>{calls++;let data;
 if(url.endsWith('/audio/transcriptions'))data={segments:[{start:0,end:2,text:'Audio transcript.'}]};
 else{const body=JSON.parse(init.body),system=body.messages[0].content,input=JSON.parse(body.messages.at(-1).content);let out;
 if(input.sentences)out={items:input.sentences.map(s=>({sentenceId:s.sentenceId,marks:[]}))};
 else if(input.items&&system.includes('boundaries'))out={boundaries:input.items.map(s=>({endId:s.id}))};
 else if(input.items&&system.includes('ranges'))out={summary:'Learning',ranges:[{fromSentenceId:input.items[0].id,toSentenceId:input.items.at(-1).id,level:'repeat',reason:'Core'}]};
 else if(input.items&&system.includes('chapters'))out={chapters:[{fromSentenceId:input.items[0].id,toSentenceId:input.items.at(-1).id,title:'Learning',summary:'Summary'}],quotes:[{sentenceId:input.items[0].id,quote:input.items[0].text}],explanations:[{fromSentenceId:input.items[0].id,toSentenceId:input.items[0].id,title:'Detail',body:'Detailed method'}]};
 else if(input.items)out={translations:input.items.map(s=>({id:s.id,text:'译文'}))};
 else if(input.sections)out={chapters:[{from:0,to:input.sections.length-1,title:'Whole video',summary:'Whole summary'}],quoteIndexes:[0]};
 else if(input.candidates)out={indexes:[0]};
 else if(input.quotes)out={translations:input.quotes.map(s=>({id:s.id,text:'金句译文'}))};
 else if(input.body||input.sourceText)out={body:'Clean note.'};
 else out={answer:'中文解释',answerEn:'English explanation',citations:[]};
 data={choices:[{message:{content:JSON.stringify(out)}}]};}
 return new Response(JSON.stringify(data),{status:200});};
 const checks=[];if((await db.get('notes','legacy-note'))?.body!=='Keep me')throw new Error('Upgrade lost existing note');checks.push('legacy-db-upgrade');
 for(const capability of ['boundary','translation','study','analysis','qa','explain','refine','focus']){
 const r=structuredClone(record);if(capability==='focus')selectFocusConfig(r,{goal:'toefl'});
 const args={selectedText:'Learning',question:'What is learning?',body:capability==='refine'?'My note.':undefined,selectedIds:['s0'],currentTime:1};
 if(capability==='translation')delete args.selectedIds;
 const before=calls;await runTask(structuredClone(r),capability,cfg,args,new AbortController().signal,async()=>{},()=>{});const first=calls-before;
 await runTask(structuredClone(r),capability,cfg,{...args,currentTime:2},new AbortController().signal,async()=>{},()=>{});
 if(calls-before!==first||first===0)throw new Error('Cache failure for '+capability+': '+first+'/'+(calls-before));checks.push(capability);
 }
 const extra=structuredClone(record);extra.analysis={quotes:[{sentenceId:'s0',start:0,quote:record.sentences[0].rawText},{sentenceId:'s1',start:3,quote:record.sentences[1].rawText}],explanations:[{fromSentenceId:'s0',toSentenceId:'s0',start:0,end:3,title:'New detail',body:'New method'}]};extra.analysisChunks={0:{quotes:extra.analysis.quotes}};
 for(const capability of ['quoteTranslation','curateDetails']){const before=calls;await runTask(structuredClone(extra),capability,cfg,{},new AbortController().signal,async()=>{},()=>{});const after=calls;await runTask(structuredClone(extra),capability,cfg,{},new AbortController().signal,async()=>{},()=>{});if(calls!==after)throw new Error('Cache failure for '+capability);checks.push(capability);}
 const valid=data=>typeof data?.body==='string'&&!!data.body.trim(),before=calls;
 for(let i=0;i<2;i++)await cachedCompletion(cfg,'Polish a note.',{sourceText:'Original note.'},new AbortController().signal,'refine',valid);
 if(calls!==before+1)throw new Error('Quick note duplicate');checks.push('quick-note-polish');
 const audio=new Blob(['fixture-audio'],{type:'audio/wav'}),audioBefore=calls;
 for(let i=0;i<2;i++)await cachedTranscribe(audio,cfg,new AbortController().signal,'test.wav');
 if(calls!==audioBefore+1)throw new Error('ASR duplicate');checks.push('audio-file-asr');
 const entries=await db.all('aiCache');if(!entries.length||JSON.stringify(entries).includes('FIXTURE'))throw new Error('Cache missing or secret stored');
 const usage=await db.statistics();
 if(usage.notes.count!==1||usage.aiCache.count!==entries.length||usage.aiCache.bytes<=0||JSON.stringify(usage).includes('Clean note'))throw new Error('Unsafe or inaccurate storage summary');checks.push('storage-summary');
 await db.put('chats',{id:'keep-chat',answer:'Keep me'});
 await db.put('videos',{id:'keep-video',sentences:[]});
 await db.manage('delete-notes',r=>r);
 if((await db.all('notes')).length||(await db.all('aiCache')).length!==entries.length||!(await db.get('chats','keep-chat'))||!(await db.get('videos','keep-video')))throw new Error('Deleting notes changed learning data');
 const preservedCalls=calls;
 await cachedTranscribe(audio,cfg,new AbortController().signal,'test.wav');
 await cachedCompletion(cfg,'Polish a note.',{sourceText:'Original note.'},new AbortController().signal,'refine',valid);
 if(calls!==preservedCalls)throw new Error('Deleting notes caused duplicate paid requests');checks.push('delete-notes-preserves-cache');
 await db.manage('clear-cache',r=>r);if((await db.all('aiCache')).length)throw new Error('Cache clear failed');
 return {checks,requests:calls,cacheEntries:entries.length};
 }''')
 print(result);context.close()
print('Persistent cache audit passed: each unchanged second request performs zero network calls; cache clear removes response storage.')
