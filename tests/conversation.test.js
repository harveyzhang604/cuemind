import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationTopics,noteSources} from '../extension/core/conversation.js';
import {qaContext,validateAnswer} from '../extension/core/retrieval.js';
test('topics preserve chronological turns and order topics by most recently updated',()=>{
 const a={topicId:'a',question:'First'},b={topicId:'b',question:'Other'},c={topicId:'a',question:'Followup'};
 const topics=conversationTopics([a,b,c]);assert.deepEqual(topics.map(t=>t.id),['a','b']);assert.deepEqual(topics[0].items,[a,c]);
});
test('legacy records remain independent, recoverable topics',()=>{assert.equal(conversationTopics([{id:'old1'},{id:'old2'},{}]).length,3);});
test('segment uses complete semantic paragraph, explicit selection uses exact span',()=>{
 const sentences=Array.from({length:30},(_,i)=>({id:'s'+i,start:i*10,end:i*10+8,rawText:'Line '+i}));
 assert.deepEqual(qaContext(sentences,{scope:'segment',selectedIds:['s12'],paragraphs:[{sentenceIds:['s10','s11','s12','s13']}]}).map(s=>s.id),['s10','s11','s12','s13']);
 assert.deepEqual(qaContext(sentences,{scope:'segment',selectedIds:['s12','s14']}).map(s=>s.id),['s12','s13','s14']);
});
test('note sources omit intervening unrelated sentences and keep chronology',()=>{const s=[{id:'a'},{id:'b'},{id:'c'}];assert.deepEqual(noteSources({sentenceIds:['c','a']},s),[s[0],s[2]]);});
test('supplement remains separate from validated video quotations',()=>{const answer=validateAnswer({answer:'Meaning',supplement:'An invented example.',citations:[]},[]);assert.equal(answer.verified,false);assert.equal(answer.supplement,'An invented example.');});

test('task persists topic, selection, language and isolates supplementary knowledge',async()=>{
 const {runTask}=await import('../extension/services/tasks.js');const original=global.fetch;let input;
 global.fetch=async(url,init)=>{const body=JSON.parse(init.body);input=JSON.parse(body.messages.at(-1).content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'Meaning',supplement:'Example',citations:[{sentenceId:'s1',quote:'Example sentence.'}]})}}]}));};
 try{const result=await runTask({videoInfo:{title:'Video'},sentences:[{id:'s1',start:0,end:4,rawText:'Example sentence.'}],paragraphs:[]},'qa',{apiKey:'fixture'},{question:'Explain',topicId:'topic-1',scope:'sentence',selectedIds:['s1'],selectedText:'Example',answerLanguage:'bilingual',history:[]},new AbortController().signal,async()=>{},()=>{});assert.equal(result.topicId,'topic-1');assert.equal(result.context.selectedText,'Example');assert.equal(result.context.answerLanguage,'bilingual');assert.equal(input.answerLanguage,'bilingual');assert.equal(result.supplement,'Example');assert.equal(result.verified,true);}finally{global.fetch=original;}
});

test('long video retrieval includes evidence near the beginning, middle and end',()=>{
 const sentences=Array.from({length:1000},(_,i)=>({id:'s'+i,start:i*4,end:i*4+4,rawText:'A long discussion about understanding ideas. '.repeat(3)}));
 const context=qaContext(sentences,{scope:'video',question:'What is the overall message?'});
 assert.ok(context.some(s=>s.id==='s0'));assert.ok(context.some(s=>s.id==='s999'));assert.ok(context.some(s=>s.start>1600&&s.start<2400));
 assert.ok(context.reduce((sum,s)=>sum+s.rawText.length+70,0)<=18000);
});

test('deep explanations are selected semantically by validated indexes and cached',async()=>{
 const {curateDetails}=await import('../extension/services/overview.js');const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({indexes:[2,19,40]})}}]}));};
 try{const record={videoInfo:{duration:3600},analysis:{chapters:[],explanations:Array.from({length:70},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*40,end:i*40+30,title:'Topic '+i,body:'Explanation '+i}))}};await curateDetails(record,{apiKey:'fixture'},new AbortController().signal);assert.deepEqual(record.analysis.explanations.map(x=>x.title),['Topic 2','Topic 19','Topic 40']);await curateDetails(record,{apiKey:'fixture'},new AbortController().signal);assert.equal(calls,2);}finally{global.fetch=original;}
});
test('invalid evidence is counted rather than silently presented as fully grounded',()=>{
 const a=validateAnswer({answer:'Claim',citations:[{sentenceId:'s',quote:'True quote'},{sentenceId:'fake',quote:'Unsupported'}]},[{id:'s',start:0,rawText:'True quote'}]);assert.equal(a.citations.length,1);assert.equal(a.rejectedCitations,1);
});
