import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,restoreSettings} from '../extension/services/settings.js';
import {validateBackup} from '../extension/core/backup.js';
import {demoRecord} from '../extension/panel/demo.js';
import {parseJson,limitedText,transcribe,defaults} from '../extension/services/ai-provider.js';
import {runTask} from '../extension/services/tasks.js';
import {localSentences,paragraphs,validateRanges,uncoveredIds,mergeStudy} from '../extension/core/sentence.js';
import {normalizeCaptions} from '../extension/core/transcript.js';
import {keyFromUrl} from '../extension/core/video.js';

test('settings whitelist blocks extra credential fields and invalid numeric values',()=>{
  const s=validateSettings({extraSecret:'secret',prompts:{unknown:'ignored'}});
  assert.equal(s.extraSecret,undefined);assert.equal(s.prompts.unknown,undefined);
  for(const value of [NaN,Infinity,-1,181000])assert.throws(()=>validateSettings({timeout:value}));
  assert.throws(()=>validateSettings({models:[]}));
});
test('DeepSeek legacy model names migrate to currently supported names',()=>{
  assert.equal(validateSettings({provider:'deepseek',model:'deepseek-chat'}).model,'deepseek-flash');
  assert.equal(validateSettings({provider:'deepseek',model:'deepseek-reasoner'}).model,'deepseek-v4-pro');
  assert.equal(validateSettings({provider:'compatible',model:'deepseek-chat'}).model,'deepseek-chat');
});
test('restore preserves credentials only for the exact endpoint and provider',()=>{
  const old=validateSettings({apiKey:'original',asrKey:'asr'});
  assert.equal(restoreSettings({...old,apiKey:'forged'},old).apiKey,'original');
  assert.equal(restoreSettings({...old,baseUrl:old.baseUrl+'/other'},old).apiKey,'');
  assert.equal(restoreSettings({...old,provider:'gemini'},old).apiKey,'');
  assert.equal(restoreSettings({...old,asrUrl:'https://new.invalid'},old).asrKey,'');
});
const backup=()=>({format:'cuemind',version:1,videos:[{...demoRecord(),studyChunks:{}}],notes:[],chats:[]});
test('backup accepts complete provenance and rejects corrupted derived data',()=>{
  assert.equal(validateBackup(backup()).videos.length,1);
  for(const mutate of [b=>b.videos[0].sentences[0].rawText='forged',b=>b.videos[0].analysis.chapters={},b=>b.videos[0].studyMap=[null],b=>b.videos[0].tasks={translation:{done:null,failed:[]}},b=>b.notes.push({id:'bad'})]){
    const b=backup();mutate(b);assert.throws(()=>validateBackup(b));
  }
});
test('AI output requires object and response reader enforces byte limit',async()=>{
  for(const x of ['null','[]','"text"','2','true'])assert.throws(()=>parseJson(x));
  assert.equal(await limitedText(new Response('中文'),6),'中文');
  await assert.rejects(()=>limitedText(new Response('中文'),5),/过大/);
});
test('overlapping cues cannot shorten a reconstructed sentence or paragraph',()=>{
  const s=localSentences(normalizeCaptions([{start:0,end:10,text:'Hello'},{start:1,end:2,text:'world.'}]));
  assert.equal(s[0].end,10);assert.equal(paragraphs(s)[0].end,10);
});
test('overlapping YouTube sentence timestamps do not cause false missing coverage or misclassification',()=>{
  const s=[{id:'a',start:0,end:10},{id:'b',start:2,end:5},{id:'c',start:4,end:6}];
  const ranges=validateRanges(s,[{fromSentenceId:'a',toSentenceId:'b',level:'repeat'}]);
  assert.equal(ranges[0].end,10);
  assert.deepEqual(uncoveredIds(s,ranges),['c']);
  assert.deepEqual(mergeStudy(s,ranges).map(x=>x.level),['repeat','repeat','normal']);
});
test('previous false-positive study failures recover from cached IDs without another paid request',async()=>{
  const s=[{id:'a',start:0,end:10,rawText:'Long.'},{id:'b',start:2,end:5,rawText:'Short.'}];
  const cfg={...defaults,apiKey:'test'};
  const signature=JSON.stringify([cfg.provider,cfg.baseUrl,cfg.model,cfg.targetLanguage,'']);
  const r={videoInfo:{title:'overlap'},sentences:s,tasks:{study:{signature,done:[],failed:[{index:0,error:'学习地图有未覆盖句子，可重试失败部分。'}]}},studyChunks:{0:{summary:'Cached',ranges:[{fromSentenceId:'a',toSentenceId:'b',level:'repeat',start:0,end:5}]}}};
  const original=global.fetch;global.fetch=()=>{throw new Error('Must not re-request');};
  try{const out=await runTask(r,'study',cfg,{},new AbortController().signal,async()=>{},()=>{});assert.equal(out.partial,false);assert.deepEqual(r.tasks.study.done,[0]);assert.equal(r.studyMap[0].level,'repeat');}finally{global.fetch=original;}
});
test('incomplete overview chapter batches recover by splitting and preserve full source coverage',async()=>{
  const r=demoRecord();r.sentences=Array.from({length:4},(_,i)=>({id:`s${i}`,start:i*4,end:i*4+4,rawText:`Sentence ${i}.`}));
  r.videoInfo.duration=16;delete r.analysis;delete r.analysisChunks;r.tasks={};
  const previous=global.fetch;let localCalls=0,globalCalls=0;
  global.fetch=async(_url,options)=>{
    const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content);
    let output;
    if(input.items){
      localCalls++;
      const first=input.items[0].id,last=input.items.at(-1).id;
      output={chapters:[{fromSentenceId:first,toSentenceId:input.items.length===4?'s1':last,title:'Part',summary:'Summary'}],quotes:[],explanations:[]};
    }else{globalCalls++;output={chapters:[{from:globalCalls===1?1:0,to:1,title:'Whole',summary:'Summary'}],quoteIndexes:[]};}
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
  };
  try{
    const out=await runTask(r,'analysis',{...defaults,apiKey:'test'},{},new AbortController().signal,async()=>{},()=>{});
    assert.equal(out.partial,false);assert.equal(localCalls,4);assert.equal(globalCalls,2);
    assert.deepEqual(uncoveredIds(r.sentences,r.analysis.chapters),[]);
    assert.deepEqual(r.tasks.analysis.failed,[]);
  }finally{global.fetch=previous;}
});
test('only supported video URLs produce platform keys',()=>{
  assert.equal(keyFromUrl('https://www.youtube.com/watch?v=abc'),'youtube:abc:1');
  for(const url of ['https://evil.invalid/watch?v=a','https://www.bilibili.com/video/BV123?p=-1','javascript:alert(1)'])assert.equal(keyFromUrl(url),null);
});
test('domestic and overseas speech routes isolate keys and backups reject substituted credentials',async()=>{
  const {speechSettings,DOUBAO_ASR_URL}=await import('../extension/services/speech.js');
  const cfg=validateSettings({asrRouting:'platform',asrKey:'overseas-fixture',domesticAsrKey:'domestic-fixture'});
  assert.equal(speechSettings(cfg,'youtube').asrKey,'overseas-fixture');
  for(const platform of ['migu','bilibili']) {
    assert.equal(speechSettings(cfg,platform).asrKey,'domestic-fixture');
    assert.equal(speechSettings(cfg,platform).asrUrl,DOUBAO_ASR_URL);
  }
  assert.equal(speechSettings({...cfg,domesticAsrKey:''},'migu').asrKey,'');
  assert.equal(restoreSettings({...cfg,domesticAsrKey:'forged'},cfg).domesticAsrKey,'domestic-fixture');
  assert.equal(restoreSettings({...cfg,domesticAsrUrl:'https://other.invalid',domesticAsrKey:'forged'},cfg).domesticAsrKey,'');
});
test('Doubao uploads WAV with independent credentials and converts millisecond utterances',async()=>{
  const {DOUBAO_ASR_URL,DOUBAO_ASR_RESOURCE,pcmWave}=await import('../extension/services/speech.js');
  const previous=global.fetch;let sent;let status='20000000';
  const audio=pcmWave(new Float32Array([0,-1,1]));
  const view=new DataView(await audio.arrayBuffer());
  assert.equal(view.getUint32(24,true),16000);assert.equal(view.getInt16(46,true),-32768);
  global.fetch=async(url,options)=>{
    sent={url,...options};
    return new Response(JSON.stringify({result:{utterances:[{start_time:450,end_time:1530,text:'Hello.'}]}}),{headers:{'X-Api-Status-Code':status}});
  };
  try {
    const cfg={asrUrl:DOUBAO_ASR_URL,asrModel:DOUBAO_ASR_RESOURCE,asrKey:'domestic-fixture',apiKey:'text-fixture'};
    const result=await transcribe(audio,cfg);
    assert.deepEqual(result,[{start:.45,end:1.53,text:'Hello.'}]);
    assert.equal(sent.url,DOUBAO_ASR_URL);assert.equal(sent.headers['X-Api-Key'],'domestic-fixture');
    assert.equal(sent.headers.Authorization,undefined);assert.ok(!sent.body.includes('text-fixture'));
    assert.equal(Buffer.from(JSON.parse(sent.body).audio.data,'base64').toString('ascii',0,4),'RIFF');
    status='20000003';assert.deepEqual(await transcribe(audio,cfg),[]);
    status='45000151';await assert.rejects(()=>transcribe(audio,cfg),/音频格式/);
  } finally {global.fetch=previous;}
});
test('speech network check sends neither keys nor audio and accepts method-not-allowed as reachable',async()=>{
  const {checkSpeechNetwork}=await import('../extension/services/speech.js');
  const previous=global.fetch;let sent;
  global.fetch=async(url,options)=>{sent=options;return new Response('',{status:405});};
  try {
    assert.equal((await checkSpeechNetwork({asrUrl:'https://speech.example/v1',asrKey:'secret'})).status,405);
    assert.equal(sent.method,'HEAD');assert.equal(sent.body,undefined);assert.equal(sent.headers,undefined);
    await assert.rejects(()=>checkSpeechNetwork({asrUrl:'https://api.deepseek.com'}),/用于文本翻译/);
    global.fetch=async()=>{throw new TypeError('Failed to fetch');};
    await assert.rejects(()=>checkSpeechNetwork({asrUrl:'https://speech.example/v1'}),/无法连接语音服务 speech.example/);
  } finally {global.fetch=previous;}
});
test('ASR preserves original audio filename and rejects invalid timestamps',async()=>{
  const previous=global.fetch;let form,valid=true;
  global.fetch=async(url,options)=>{form=options.body;return new Response(JSON.stringify({segments:[{start:valid?0:-1,end:2,text:'speech'}]}));};
  try{
    await transcribe(new Blob(['audio'],{type:'audio/mpeg'}),{asrKey:'test'},undefined,'clip.mp3');
    assert.equal(form.get('file').name,'clip.mp3');
    valid=false;await assert.rejects(()=>transcribe(new Blob(['audio']),{asrKey:'test'}),/时间戳/);
  }finally{global.fetch=previous;}
});
test('ASR request timeout aborts a stalled upload and reports the configured wait',async()=>{
  const previous=global.fetch;let requests=0;
  global.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>{
    requests++;
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  try{
    await assert.rejects(
      ()=>transcribe(new Blob(['audio'],{type:'audio/webm'}),{asrKey:'test'},undefined,undefined,{timeoutMs:5000}),
      /上传音频或等待服务响应阶段超过 5 秒仍无响应；已采集 1 KB 音频/
    );
    assert.equal(requests,1);
  }finally{global.fetch=previous;}
});
test('changed translation configuration removes stale language before partial retry',async()=>{
  const previous=global.fetch;
  const r=demoRecord();r.tasks={translation:{signature:'old',done:[0],failed:[]}};
  global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:[{id:r.sentences[0].id,text:'new language'}]})}}]}));
  try{
    const out=await runTask(r,'translation',{...defaults,apiKey:'test',targetLanguage:'French'},{},new AbortController().signal,async()=>{},()=>{});
    assert.ok(out.partial);assert.equal(r.sentences[0].translation,'new language');assert.equal(r.sentences[1].translation,undefined);
  }finally{global.fetch=previous;}
});
test('invalid AI boundaries preserve source and remain marked retryable',async()=>{
  const previous=global.fetch;let requests=0;
  const r=demoRecord();r.sentences.forEach(s=>delete s.translation);
  global.fetch=async()=>{requests++;return new Response(JSON.stringify({choices:[{message:{content:'{"boundaries":[null]}'}}]}));};
  try{
    const out=await runTask(r,'boundary',{apiKey:'test'},{},new AbortController().signal,async()=>{},()=>{});
    assert.equal(requests,2);assert.ok(out.partial);assert.deepEqual(r.sentences.flatMap(s=>s.sourceIds),r.rawCaptions.map(s=>s.id));assert.equal(r.tasks.boundary.done.length,0);
  }finally{global.fetch=previous;}
});

test('study cards group adjacent matching reasons without losing source IDs or merging different levels',async()=>{
  const {studyGroups}=await import('../extension/core/sentence.js');
  const ranges=[{fromSentenceId:'a',toSentenceId:'a',start:0,end:5,reason:'同一理由',level:'repeat'},{fromSentenceId:'b',toSentenceId:'b',start:3,end:4,reason:'同一理由',level:'repeat'},{fromSentenceId:'c',toSentenceId:'c',start:6,end:8,reason:'同一理由',level:'normal'},{fromSentenceId:'d',toSentenceId:'d',start:9,end:10,reason:'另一理由',level:'normal'}];
  const groups=studyGroups(ranges);assert.equal(groups.length,3);assert.equal(groups[0].end,5);assert.equal(groups[0].toSentenceId,'b');assert.deepEqual(groups.flatMap(g=>g.items.map(r=>r.fromSentenceId)),['a','b','c','d']);assert.equal(ranges[0].toSentenceId,'a');
});

test('global overview merges source spans and rejects omitted or overlapping chapters',async()=>{
 const {overviewPlan}=await import('../extension/services/overview.js');
 const source=Array.from({length:4},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*60,end:(i+1)*60+2}));
 const groups=[{from:0,to:1,title:'主题一',summary:'归纳前两个局部摘要'},{from:2,to:3,title:'主题二',summary:'归纳后两个局部摘要'}];
 const result=overviewPlan(source,groups);assert.equal(result.length,2);assert.equal(result[0].start,0);assert.equal(result[0].end,122);assert.equal(result[1].toSentenceId,'s3');
 assert.throws(()=>overviewPlan(source,groups.slice(0,1)));assert.throws(()=>overviewPlan(source,[groups[0],{...groups[1],from:1}]));assert.throws(()=>overviewPlan(source,[{...groups[0],title:''},groups[1]]));
});
