import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCaptions,splitTimedCaptions,parseSubtitle,parseJSON3,videoKey,formatTime,timestampUrl} from '../extension/core/transcript.js';
import {localSentences,boundarySentences,paragraphs,alignTranslations,validateRanges,mergeStudy,activeIndex,batches,relatedStudySentences} from '../extension/core/sentence.js';
import {retrieve,qaContext,validateAnswer} from '../extension/core/retrieval.js';
import {markdown,mindmap,subtitles} from '../extension/core/export.js';
import {endpoint,parseJson,completion} from '../extension/services/ai-provider.js';
import {runTask} from '../extension/services/tasks.js';
import WBI from '../extension/services/wbi.js';
const raw=normalizeCaptions([{start:0,end:1,text:'Hello'},{start:1,end:3,text:'world.'},{start:3.1,end:5,text:'Try again!'},{start:7,end:8,text:'Never'},{start:8,end:10,text:'give up.'}]);
const sentences=localSentences(raw);
test('fragmented captions reconstructed once, IDs and times from source',()=>{assert.equal(sentences.length,3);assert.equal(sentences[0].rawText,'Hello world.');assert.deepEqual(sentences.flatMap(s=>s.sourceIds),raw.map(r=>r.id));assert.equal(sentences[0].end,3);});
test('Chinese punctuation and technical abbreviations are preserved',()=>{const r=normalizeCaptions([{start:0,end:1,text:'Dr.'},{start:1,end:2,text:'Zhang uses API v2.'},{start:2,end:3,text:'这是'},{start:3,end:4,text:'一个例子。'}]);const s=localSentences(r);assert.equal(s.length,2);assert.equal(s[1].rawText,'这是一个例子。');});
test('10000 fragmented captions have complete ordered provenance',()=>{const r=normalizeCaptions(Array.from({length:10000},(_,i)=>({start:i*.3,end:i*.3+.3,text:'word'})));const s=localSentences(r);assert.deepEqual(s.flatMap(x=>x.sourceIds),r.map(x=>x.id));assert.ok(s.length<r.length/10);});
test('AI only specifies end IDs, source text cannot be changed',()=>{const s=boundarySentences(raw,[{endId:'raw-2',text:'forged',start:900},{endId:'raw-4'}]);assert.equal(s[0].start,0);assert.equal(s[0].end,5);assert.equal(s[0].rawText,'Hello world. Try again!');});
for(const [name,b]of [['missing tail',[{endId:'raw-1'}]],['duplicate',[{endId:'raw-1'},{endId:'raw-1'}]],['unknown',[{endId:'invented'}]],['reversed',[{endId:'raw-3'},{endId:'raw-2'}]]])test(`AI rejects ${name}`,()=>assert.throws(()=>boundarySentences(raw,b)));
test('paragraphs preserve all sentence IDs and derive ranges',()=>{const p=paragraphs(sentences);assert.deepEqual(p.flatMap(x=>x.sentenceIds),sentences.map(x=>x.id));assert.equal(p[0].start,0);assert.equal(p.at(-1).end,10);});
test('translation order is irrelevant; absent IDs retain original',()=>{const s=alignTranslations(sentences,[{id:sentences[2].id,text:'不要放弃'},{id:'fake',text:'wrong'},{id:sentences[0].id,text:'你好世界'}]);assert.equal(s[0].translation,'你好世界');assert.equal(s[1].translation,undefined);assert.equal(s[2].translation,'不要放弃');});
test('study ranges reject invented and reversed anchors',()=>{const r=validateRanges(sentences,[{fromSentenceId:sentences[2].id,toSentenceId:sentences[0].id,level:'repeat'},{fromSentenceId:'fake',toSentenceId:'fake',level:'repeat'},{fromSentenceId:sentences[0].id,toSentenceId:sentences[1].id,level:'repeat',start:900}]);assert.equal(r.length,1);assert.equal(r[0].start,0);assert.equal(r[0].end,5);});
test('manual classification wins and unspecified ranges normal',()=>{const map=mergeStudy(sentences,[],{[sentences[0].id]:'skim'});assert.equal(map[0].level,'skim');assert.equal(map[1].level,'normal');});
test('active sentence lookup returns no match for timeline gaps',()=>{assert.equal(activeIndex(sentences,1),0);assert.equal(activeIndex(sentences,6),-1);assert.equal(activeIndex(sentences,99),-1);});
test('SRT / VTT timestamps survive import and export',()=>{const r=parseSubtitle('WEBVTT\n\n00:00:01.200 --> 00:00:03.500\nHello <b>there</b>.\n');assert.equal(r[0].start,1.2);assert.equal(r[0].text,'Hello there.');const back=parseSubtitle(subtitles({sentences:localSentences(r)}));assert.equal(back[0].end,3.5);});
test('json3 uses word timestamps, not generated timing',()=>{const r=parseJSON3({events:[{tStartMs:1000,dDurationMs:3000,segs:[{utf8:'hello ',tOffsetMs:0},{utf8:'world',tOffsetMs:1500}]}]});assert.equal(r[1].start,2.5);assert.equal(r[1].end,4);});
test('a long timed caption becomes spoken sentences within its original interval',()=>{
 const raw=splitTimedCaptions(normalizeCaptions([{start:183,end:205,text:'Thank you. See? That sounds better. What did you do this morning? I woke up at 7:00.'}]));
 const list=localSentences(raw);
 assert.deepEqual(list.map(s=>s.rawText),['Thank you.','See?','That sounds better.','What did you do this morning?','I woke up at 7:00.']);
 assert.equal(list[0].start,183);assert.equal(list.at(-1).end,205);
 assert.ok(list.every(s=>s.estimatedTiming));
 assert.deepEqual(list.flatMap(s=>s.sourceIds),raw.map(s=>s.id));
});
test('retrieval includes selected caption and nearby context',()=>{const list=Array.from({length:500},(_,i)=>({id:`s${i}`,start:i*10,end:i*10+9,rawText:i===450?'Transformer attention explained':'Other topic '.repeat(10)}));const c=retrieve(list,'transformer',0,['s450'],1500);assert.ok(c.some(s=>s.id==='s450'));assert.ok(c.some(s=>s.id==='s451'));assert.ok(c.reduce((n,s)=>n+s.rawText.length,0)<1500);});
test('question scopes keep the selected sentence local and whole-video followups retrievable',()=>{const list=Array.from({length:100},(_,i)=>({id:`s${i}`,start:i*10,end:i*10+8,rawText:i===80?'Think directly in English.':`Unrelated line ${i}.`}));assert.deepEqual(qaContext(list,{scope:'sentence',selectedIds:['s80']}).map(s=>s.id),['s79','s80','s81']);const segment=qaContext(list,{scope:'segment',selectedIds:['s80']});assert.ok(segment.some(s=>s.id==='s80'));assert.ok(segment.every(s=>s.start>=770&&s.start<=838));assert.ok(qaContext(list,{scope:'video',question:'why',history:[{question:'Think directly in English'}]}).some(s=>s.id==='s80'));});
test('citation requires both supplied ID and exact source quote',()=>{const a=validateAnswer({answer:'Answer',citations:[{sentenceId:sentences[0].id,quote:'Hello'},{sentenceId:sentences[0].id,quote:'made up'},{sentenceId:'fake',quote:'Hello'}]},sentences);assert.equal(a.citations.length,1);assert.equal(a.citations[0].start,0);});
test('answer without valid sources is visibly unverified',()=>assert.equal(validateAnswer({answer:'No proof',citations:[]},sentences).verified,false));
test('batching overlaps safely and always makes progress',()=>{const b=batches(sentences,1,3);assert.equal(b.length,sentences.length);});
test('part key separates Bilibili pages',()=>assert.notEqual(videoKey({platform:'bilibili',videoId:'BV1',page:1}),videoKey({platform:'bilibili',videoId:'BV1',page:2})));
test('timestamp URLs reject script URLs',()=>assert.equal(timestampUrl({url:'javascript:alert(1)'},20),''));
test('export references real source timestamps and requires chapters for mindmap',()=>{const r={videoInfo:{title:'Test',platform:'youtube',url:'https://www.youtube.com/watch?v=abc'},sentences};assert.match(markdown(r,[],true),/t=0/);assert.throws(()=>mindmap(r));assert.equal(formatTime(3661),'1:01:01');});
test('model endpoints disallow plaintext external hosts and embedded credentials',()=>{assert.equal(endpoint('http://localhost:11434/v1/'),'http://localhost:11434/v1');assert.throws(()=>endpoint('http://example.com'));assert.throws(()=>endpoint('https://key:secret@example.com'));});
test('structured output parses fenced JSON and rejects prose',()=>{assert.deepEqual(parseJson('```json\n{"a":1}\n```'),{a:1});assert.throws(()=>parseJson('hello'));});
test('Bilibili WBI signing keeps deterministic key order and known MD5',()=>{assert.equal(WBI.md5(''),'d41d8cd98f00b204e9800998ecf8427e');const signed=WBI.signParams({b:2,a:'hello world'}, {imgKey:'a'.repeat(32),subKey:'b'.repeat(32)}, 1700000000);assert.equal(signed.wts,1700000000);assert.deepEqual(Object.keys(signed).sort(),['a','b','w_rid','wts']);assert.match(WBI.signedUrl('https://api.bilibili.com/x/player/wbi/v2',{b:2,a:'hello world'},{imgKey:'a'.repeat(32),subKey:'b'.repeat(32)},1700000000),/w_rid=[0-9a-f]{32}/);});
test('AI provider uses native Gemini API body and secret header',async()=>{const original=global.fetch;let captured;global.fetch=async(url,init)=>{captured={url,...init};return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"answer":"ok"}'}]}}]}));};try{const r=await completion({provider:'gemini',baseUrl:'https://example.com/v1beta',model:'test',apiKey:'secret'},'system',{text:'source'});assert.equal(r.answer,'ok');assert.ok(!captured.url.includes('secret'));assert.equal(captured.headers['x-goog-api-key'],'secret');assert.ok(JSON.parse(captured.body).system_instruction);}finally{global.fetch=original;}});
test('translation partial results persist and retry only missing batches',async()=>{const original=global.fetch;global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:[{id:sentences[0].id,text:'translated'}]})}}]}));let saves=0;try{const result=await runTask({videoInfo:{title:'test'},sentences:structuredClone(sentences)},'translation',{apiKey:'test'},{},new AbortController().signal,async()=>saves++,()=>{});assert.equal(result.partial,true);assert.equal(result.record.sentences[0].translation,'translated');assert.equal(saves,1);}finally{global.fetch=original;}});
test('cancellation rejects before performing model request',async()=>{const c=new AbortController();c.abort();await assert.rejects(()=>runTask({videoInfo:{title:'x'},sentences},'translation',{}, {},c.signal,async()=>{},()=>{}),{name:'AbortError'});});

test('bilingual explanation preserves both languages and validates evidence',async()=>{
  const original=global.fetch;let prompt;
  global.fetch=async(url,init)=>{prompt=JSON.parse(init.body).messages[0].content;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({pronunciation:'/həˈləʊ/',meaning:'你好',answer:'向世界问好。',answerEn:'A greeting to the world.',citations:[{sentenceId:sentences[0].id,quote:'Hello world.'}]})}}]}));};
  try{const result=await runTask({videoInfo:{title:'test'},sentences},'explain',{apiKey:'test'},{selectedText:'Hello',selectedIds:[sentences[0].id]},new AbortController().signal,async()=>{},()=>{});assert.equal(result.pronunciation,'/həˈləʊ/');assert.equal(result.meaning,'你好');assert.equal(result.answer,'向世界问好。');assert.equal(result.answerEn,'A greeting to the world.');assert.equal(result.verified,true);assert.match(prompt,/answerEn/);}finally{global.fetch=original;}
});

test('related learning units stop at chapter edges, gaps, other reasons and manual labels',()=>{
 const items=Array.from({length:6},(_,i)=>({id:'s'+i,start:i*3,end:i*3+3}));
 const map=items.map(s=>({fromSentenceId:s.id,level:'repeat',reason:'One idea'}));
 assert.equal(relatedStudySentences(items.slice(0,3),map,'s1').length,3);
 map[2].reason='Another idea';
 assert.deepEqual(relatedStudySentences(items,map,'s1').map(s=>s.id),['s0','s1']);
 map[1].manual=true;assert.equal(relatedStudySentences(items,map,'s1').length,1);
 items[5].start=100;items[5].end=103;assert.equal(relatedStudySentences(items,map,'s5').length,1);
});

test('segment context covers the whole selected span without truncating dense captions',()=>{const list=Array.from({length:200},(_,i)=>({id:`dense${i}`,start:i,end:i+1,rawText:`Line ${i}`}));const result=qaContext(list,{scope:'segment',selectedIds:['dense40','dense170']});assert.ok(result.some(s=>s.id==='dense170'));assert.ok(!result.some(s=>s.id==='dense199'));assert.equal(result.at(-1).id,'dense170');assert.ok(result.length>100);});
test('identical evidence is displayed only once',()=>{const source=[{id:'quote',start:12,end:15,rawText:'Exact quotation.'}];const ref={sentenceId:'quote',quote:'Exact quotation.'};assert.equal(validateAnswer({answer:'Answer',citations:[ref,ref]},source).citations.length,1);});
