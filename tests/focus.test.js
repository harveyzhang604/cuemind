import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFocusConfig,focusCacheKey,validateFocusMarks,effectiveFocusMarks,focusParts,parseGlossary,normalizeFocusCache,selectFocusConfig} from '../extension/core/focus.js';
import {runFocusTask,focusState} from '../extension/services/focus.js';
import {taskConflict} from '../extension/core/task-lock.js';
const sentence={id:'s1',rawText:'😀 Working capital grows; capital is not capitalism.',start:0,end:4};
const cfg=normalizeFocusConfig({goal:'finance'});
const mark=(text,level=2)=>({sentenceId:'s1',start:sentence.rawText.indexOf(text),end:sentence.rawText.indexOf(text)+text.length,text,level,source:'ai',reason:'金融含义'});
test('focus preserves exact original phrase offsets and rejects hallucinations, overlaps, substrings',()=>{
 const valid=validateFocusMarks([sentence],[mark('Working capital',3),mark('capital'),{...mark('grows'),text:'growth'},mark('capitalis'),{...mark('grows'),level:4}, {...mark('grows'),sentenceId:'unknown'}]);
 assert.equal(valid.length,1);assert.equal(valid[0].text,'Working capital');assert.equal(valid[0].start,3);
 const parts=focusParts(sentence,valid);assert.equal(parts.map(x=>x.text).join(''),sentence.rawText);assert.equal(parts.find(x=>x.level===3).text,'Working capital');
});
test('glossary full phrases and mastered override retain cached AI and restore without another request',()=>{
 const glossary=parseGlossary('working capital:3, grows:1\ncapital:2');assert.equal(glossary.length,3);
 const enabled=normalizeFocusConfig({...cfg,glossary}),marks=[mark('grows')];
 let effective=effectiveFocusMarks([sentence],marks,enabled);assert.equal(effective.filter(m=>m.source==='glossary').length,3);assert.equal(effective[0].level,3);
 const known=normalizeFocusConfig({...enabled,mastered:['WORKING CAPITAL','capital']});effective=effectiveFocusMarks([sentence],marks,known);assert.deepEqual(effective.map(m=>m.text),['grows']);
 assert.equal(focusCacheKey([sentence],known),focusCacheKey([sentence],cfg));
 assert.deepEqual(effectiveFocusMarks([sentence],marks,{...cfg,goal:'off'}),[]);
});
test('config clamps display values, strips unknown credentials, key ignores display and includes original text/goal',()=>{
 const safe=normalizeFocusConfig({goal:'toefl',baseSize:900,videoSize:1,apiKey:'secret',glossary:[{term:'<script>',level:3}],overlayLanguage:'wrong'});
 assert.equal(safe.baseSize,28);assert.equal(safe.videoSize,14);assert.equal(safe.overlayLanguage,'bilingual');assert.ok(!('apiKey'in safe));assert.equal(safe.glossary.length,0);
 assert.equal(safe.videoTranslationSize,18);
 assert.equal(normalizeFocusConfig({videoSize:32,videoTranslationSize:99}).videoTranslationSize,48);
 assert.equal(normalizeFocusConfig({videoSize:32,videoTranslationSize:8}).videoTranslationSize,12);
 assert.equal(focusCacheKey([sentence],cfg),focusCacheKey([sentence],{...cfg,baseSize:22,overlay:true,overlayLanguage:'original'}));
 assert.equal(focusCacheKey([sentence],cfg),focusCacheKey([sentence],{...cfg,videoSize:36,videoTranslationSize:24}));
 assert.notEqual(focusCacheKey([sentence],cfg),focusCacheKey([{...sentence,rawText:sentence.rawText+' Again.'}],cfg));
 assert.notEqual(focusCacheKey([sentence],cfg),focusCacheKey([sentence],{...cfg,goal:'toefl'}));
 const cache=normalizeFocusCache([sentence],cfg,{key:'forged',version:1,marks:[mark('grows')],done:[0],status:'complete'});assert.equal(cache.status,'idle');assert.equal(cache.marks.length,0);
});
test('focus may coexist with questions and notes but not another record writer or duplicate analysis',()=>{
 for(const safe of ['qa','explain','refine','note']){assert.equal(taskConflict('focus',safe),false);assert.equal(taskConflict(safe,'focus'),false);}
 for(const unsafe of ['focus','translation','boundary','analysis','study','focus-config','override'])assert.equal(taskConflict('focus',unsafe),true);
 assert.equal(taskConflict('translation','note'),true);
});
const aiSettings={provider:'compatible',baseUrl:'http://localhost:8888/v1',model:'test',maxTokens:6000};
function record(){return {id:'r1',videoInfo:{title:'Finance training'},focusConfig:cfg,sentences:Array.from({length:33},(_,i)=>({id:'s'+i,rawText:'Working capital matters.',start:i*10,end:i*10+5}))};}
function response(input){return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items:input.sentences.map(s=>({sentenceId:s.sentenceId,marks:[{text:'Working capital',occurrence:0,level:3,reason:'核心术语'}]}))})}}]}));}
test('analysis processes current neighborhood first, persists partial failures and retries only failed batch',async()=>{
 const r=record(),prior=global.fetch,requests=[];let fail=true;
 global.fetch=async(url,opts)=>{const input=JSON.parse(JSON.parse(opts.body).messages[1].content);requests.push(input.sentences.map(s=>s.sentenceId));if(fail&&input.sentences[0].sentenceId==='s0')return new Response('{}',{status:401});return response(input);};
 try{let saves=0;const first=await runFocusTask(r,aiSettings,{currentTime:325},new AbortController().signal,async()=>saves++);
 assert.equal(requests[0][0],'s32');assert.equal(first.cache.status,'partial');assert.deepEqual(first.cache.done,[2,1]);assert.equal(first.cache.failed.length,1);assert.equal(first.cache.marks.length,17);assert.ok(saves>=4);
 fail=false;const before=requests.length;const second=await runFocusTask(r,aiSettings,{},new AbortController().signal,async()=>{});assert.equal(requests.length-before,1);assert.equal(second.cache.status,'complete');assert.equal(second.cache.marks.length,33);
 const again=requests.length;r.focusConfig={...r.focusConfig,mastered:['Working capital'],baseSize:23};await runFocusTask(r,aiSettings,{},new AbortController().signal,async()=>{});assert.equal(requests.length,again);
 }finally{global.fetch=prior;}
});
test('malformed focus batch is split automatically; an irreparable sentence stays readable',async()=>{
 const r={...record(),sentences:record().sentences.slice(0,4)},prior=global.fetch;let calls=0;
 global.fetch=async(url,opts)=>{calls++;const input=JSON.parse(JSON.parse(opts.body).messages[1].content),list=input.sentences;
  const items=list.length>1||list[0].sentenceId==='s2'?[]:list.map(s=>({sentenceId:s.sentenceId,marks:[{text:'Working capital',occurrence:0,level:3,reason:'关键表达'}]}));
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items})}}]}));};
 try{const result=await runFocusTask(r,aiSettings,{},new AbortController().signal,async()=>{});
  assert.equal(result.cache.status,'complete');assert.equal(result.cache.failed.length,0);assert.deepEqual(result.cache.marks.map(m=>m.sentenceId),['s0','s1','s3']);
  assert.deepEqual(result.cache.warnings.map(w=>w.sentenceId),['s2']);assert.ok(calls>4);
 }finally{global.fetch=prior;}
});
test('abort keeps completed batches and never writes returned annotations after cancellation',async()=>{
 const r=record(),prior=global.fetch,controller=new AbortController();let n=0;
 global.fetch=async(url,opts)=>{const input=JSON.parse(JSON.parse(opts.body).messages[1].content);if(++n===2)controller.abort();return response(input);};
 try{await assert.rejects(runFocusTask(r,aiSettings,{currentTime:325},controller.signal,async()=>{}),{name:'AbortError'});assert.equal(r.focusCache.status,'cancelled');assert.deepEqual(r.focusCache.done,[2]);assert.equal(r.focusCache.marks.length,1);}finally{global.fetch=prior;}
});

test('backup sanitizes focus preferences and never imports forged completion or invalid marks',async()=>{
 const {validateBackup}=await import('../extension/core/backup.js');const {demoRecord}=await import('../extension/panel/demo.js');const r={...demoRecord(),studyChunks:{}};
 r.focusConfig={...cfg,apiKey:'not-allowed',overlayLanguage:'<img>'};const s=r.sentences[0];
 r.focusCache={key:focusCacheKey(r.sentences,cfg),version:1,marks:[{sentenceId:s.id,start:0,end:4,text:'fake',level:3,source:'glossary'}],done:[0],failed:[],total:1,status:'complete'};
 const restored=validateBackup({format:'cuemind',version:1,videos:[r],notes:[],chats:[]}).videos[0];assert.ok(!('apiKey'in restored.focusConfig));assert.equal(restored.focusConfig.overlayLanguage,'bilingual');assert.equal(restored.focusCache.marks.length,0);assert.deepEqual(restored.focusCache.done,[]);assert.equal(restored.focusCache.status,'idle');
});


test('unspaced CJK industry terms retain exact offsets while Latin partial words are rejected',()=>{
 const s={id:'zh',rawText:'这里介绍人工智能的应用，机器学习可以辅助医生。capitalism',start:0,end:5};
 const config=normalizeFocusConfig({goal:'technology',glossary:[{term:'人工智能',level:3},{term:'机器学习',level:2},{term:'capital',level:1}]});
 const marks=effectiveFocusMarks([s],[],config);assert.deepEqual(marks.map(x=>x.text),['人工智能','机器学习']);assert.deepEqual(marks.map(x=>x.level),[3,2]);
 assert.equal(marks[0].start,s.rawText.indexOf('人工智能'));assert.equal(focusParts(s,marks).map(x=>x.text).join(''),s.rawText);
 const known=effectiveFocusMarks([s],marks,{...config,mastered:['人工智能']});assert.deepEqual(known.map(x=>x.text),['机器学习']);
 const jp={id:'ja',rawText:'生成モデルのテストです。',start:0,end:1};assert.equal(effectiveFocusMarks([jp],[],{goal:'technology',glossary:[{term:'モデル',level:2}]}).length,1);
});


test('mastering a component word does not suppress an unfamiliar whole expression',()=>{
 const s={id:'phrase',rawText:'Working capital matters. Capital differs.',start:0,end:3};
 const config=normalizeFocusConfig({goal:'finance',glossary:[{term:'Working capital',level:3},{term:'capital',level:2}],mastered:['capital']});
 const marks=effectiveFocusMarks([s],[],config);assert.deepEqual(marks.map(m=>m.text),['Working capital']);
 assert.deepEqual(effectiveFocusMarks([s],[],{...config,mastered:['capital','working capital']}),[]);
 const zh={id:'zh',rawText:'人工智能是智能技术。',start:0,end:2};
 const terms={goal:'technology',glossary:[{term:'人工智能',level:3},{term:'智能',level:1}],mastered:['智能']};
 assert.deepEqual(effectiveFocusMarks([zh],[],terms).map(m=>m.text),['人工智能']);
});

test('one video retains distinct goal results across switches, reload, disabled goal and font changes without model calls',async()=>{
 const r=record(),prior=global.fetch;let calls=0;
 global.fetch=async(url,opts)=>{calls++;const input=JSON.parse(JSON.parse(opts.body).messages[1].content);const term=input.goal==='托福备考'?'matters':'Working capital';return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items:input.sentences.map(s=>({sentenceId:s.sentenceId,marks:[{text:term,occurrence:0,level:input.goal==='托福备考'?2:3}]}))})}}]}));};
 try{
  await runFocusTask(r,aiSettings,{},new AbortController().signal,async()=>{});
  const finance=structuredClone(r.focusCache);
  assert.equal(selectFocusConfig(r,{goal:'toefl'}).cache.marks.length,0);
  await runFocusTask(r,aiSettings,{},new AbortController().signal,async()=>{});const toefl=structuredClone(r.focusCache),before=calls;
  assert.equal(selectFocusConfig(r,{goal:'custom',customGoal:'医学访谈'}).cache.marks.length,0);
  assert.deepEqual(selectFocusConfig(r,{goal:'finance',baseSize:22,overlay:true}).cache,finance);
  assert.deepEqual(selectFocusConfig(r,{goal:'toefl',customGoal:'医学访谈'}).cache,toefl);
  assert.equal(selectFocusConfig(r,{goal:'off'}).cache.marks.length,0);
  const reloaded=JSON.parse(JSON.stringify(r));assert.deepEqual(selectFocusConfig(reloaded,{goal:'toefl'}).cache,toefl);
  await runFocusTask(reloaded,aiSettings,{},new AbortController().signal,async()=>{});assert.equal(calls,before);
  assert.deepEqual(selectFocusConfig(reloaded,{goal:'finance'}).cache,finance);
  assert.equal(reloaded.sentences[0].rawText,'Working capital matters.');
 }finally{global.fetch=prior;}
});
test('custom descriptions are independent, preset goals ignore stale descriptions, text changes invalidate all results',()=>{
 const r=record();const a=selectFocusConfig(r,{goal:'custom',customGoal:'金融谈判'}).cache;
 a.marks=[{sentenceId:'s0',start:0,end:15,text:'Working capital',level:3}];a.done=[0];a.status='cancelled';
 assert.equal(selectFocusConfig(r,{goal:'custom',customGoal:'医学访谈'}).cache.marks.length,0);
 assert.equal(selectFocusConfig(r,{goal:'custom',customGoal:'金融谈判'}).cache.marks.length,1);
 assert.equal(focusCacheKey(r.sentences,{goal:'toefl',customGoal:'金融谈判'}),focusCacheKey(r.sentences,{goal:'toefl',customGoal:'医学访谈'}));
 assert.notEqual(focusCacheKey(r.sentences,{goal:'custom',customGoal:'金融谈判'}),focusCacheKey(r.sentences,{goal:'custom',customGoal:'医学访谈'}));
 r.sentences[0].rawText='Working capital matters again.';
 assert.equal(focusState(r).cache.marks.length,0);selectFocusConfig(r,r.focusConfig);
 assert.equal(Object.keys(r.focusCaches).length,1);assert.deepEqual(r.focusCache.done,[]);
});
test('legacy single goal migrates, cancelled progress resumes after switching without redoing completed batches',async()=>{
 const r=record(),prior=global.fetch,controller=new AbortController();let calls=0;
 global.fetch=async(url,opts)=>{const input=JSON.parse(JSON.parse(opts.body).messages[1].content);if(++calls===2)controller.abort();return response(input);};
 try{
  await assert.rejects(runFocusTask(r,aiSettings,{currentTime:325},controller.signal,async()=>{}),{name:'AbortError'});
  delete r.focusCaches;const original=structuredClone(r.focusCache);
  selectFocusConfig(r,{goal:'ielts'});assert.deepEqual(selectFocusConfig(r,cfg).cache,original);
  global.fetch=async(url,opts)=>{calls++;return response(JSON.parse(JSON.parse(opts.body).messages[1].content));};const before=calls;
  await runFocusTask(r,aiSettings,{},new AbortController().signal,async()=>{});assert.equal(calls-before,2);assert.equal(r.focusCache.status,'complete');
 }finally{global.fetch=prior;}
});
test('backup retains each goal and revalidates inactive goal marks and progress',async()=>{
 const {validateBackup}=await import('../extension/core/backup.js');const {demoRecord}=await import('../extension/panel/demo.js');const r={...demoRecord(),studyChunks:{}},s=r.sentences[0];
 const a=selectFocusConfig(r,{goal:'toefl'}).cache;a.marks=[{sentenceId:s.id,start:0,end:s.rawText.length,text:s.rawText,level:3}];a.done=[0];a.status='complete';
 const b=selectFocusConfig(r,{goal:'custom',customGoal:'口语'}).cache;b.marks=[{sentenceId:s.id,start:0,end:4,text:'fake',level:2}];b.done=[0];b.status='complete';
 const restored=validateBackup({format:'cuemind',version:1,videos:[structuredClone(r)],notes:[],chats:[]}).videos[0];
 assert.equal(Object.keys(restored.focusCaches).length,2);assert.equal(selectFocusConfig(restored,{goal:'toefl'}).cache.marks.length,1);assert.deepEqual(restored.focusCache.done,[]);assert.equal(restored.focusCache.status,'idle');
 assert.equal(selectFocusConfig(restored,{goal:'custom',customGoal:'口语'}).cache.marks.length,0);
});
test('old preset cache with a hidden custom description migrates to the stable preset identity',()=>{
 const r={sentences:[{id:'s',rawText:'Working capital matters.'}],focusConfig:{goal:'toefl',customGoal:'英语口语表达'},focusCache:{key:'focus-1-f1561a65ea7dce49',version:1,marks:[{sentenceId:'s',start:0,end:15,text:'Working capital',level:3}],done:[0],failed:[],status:'cancelled'}};
 selectFocusConfig(r,{goal:'custom',customGoal:'医学'});
 const restored=selectFocusConfig(r,{goal:'toefl',customGoal:''});
 assert.equal(restored.cache.key,focusCacheKey(r.sentences,{goal:'toefl'}));assert.equal(restored.cache.marks.length,1);assert.deepEqual(restored.cache.done,[0]);assert.equal(restored.cache.status,'cancelled');
});
