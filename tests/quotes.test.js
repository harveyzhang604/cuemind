import test from 'node:test';
import assert from 'node:assert/strict';
import {selectQuotes} from '../extension/services/overview.js';
test('quote curation preserves exact source and chronology, permits no worthy quotes',()=>{
 const q=[{start:20,quote:'original B'},{start:1,quote:'original A'}];
 assert.deepEqual(selectQuotes(q,[0,1],2),[q[1],q[0]]);
 assert.deepEqual(selectQuotes(q,[],2),[]);
 for(const indexes of [[0,0],[2],[-1],[.5],null,[0,1]])assert.throws(()=>selectQuotes(q,indexes,1));
});

test('detail curation repairs invalid indexes and reuses original candidates without repeating requests',async()=>{
 const {curateDetails}=await import('../extension/services/overview.js');
 const original=global.fetch;let calls=0;const input=[];
 global.fetch=async(u,options)=>{calls++;input.push(JSON.parse(JSON.parse(options.body).messages[1].content));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({indexes:calls===1?[0,0]:[1]})}}]}));};
 try{
  const candidates=[0,1].map(i=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,title:'Method '+i,body:'Body '+i,start:i,end:i+1}));
  const r={videoInfo:{duration:200},analysisChunks:{0:{explanations:candidates}},analysis:{explanations:[candidates[0]],detailsSignature:'legacy'}};
  await curateDetails(r,{apiKey:'test'},new AbortController().signal);
  assert.equal(r.analysis.explanations[0],candidates[1]);assert.equal(calls,2);assert.equal(input[0].candidates.length,2);assert.ok(input[1].repair);
  await curateDetails(r,{apiKey:'test'},new AbortController().signal);assert.equal(calls,2);
 }finally{global.fetch=original;}
});

test('quote review keeps exact sources and uses neighboring context, cached after deletions',async()=>{
 const {reviewQuotes}=await import('../extension/services/overview.js');const original=global.fetch;let calls=0,input;
 global.fetch=async(u,o)=>{calls++;input=JSON.parse(JSON.parse(o.body).messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:'{"indexes":[1]}'}}]}));};
 try{
  const originalQuotes=[{sentenceId:'a',start:0,quote:'Wrong path.'},{sentenceId:'b',start:2,quote:'Practice consistently.'}];
  const record={videoInfo:{title:'Speaking practice'},sentences:[{id:'a',rawText:'Wrong path.'},{id:'b',rawText:'Practice consistently.'}],analysis:{quotes:originalQuotes}};
  await reviewQuotes(record,{apiKey:'test'},new AbortController().signal);assert.equal(record.analysis.quotes[0],originalQuotes[1]);assert.ok(input.candidates[0].context.includes('Practice consistently.'));
  await reviewQuotes(record,{apiKey:'test'},new AbortController().signal);assert.equal(calls,1);
 }finally{global.fetch=original;}
});
