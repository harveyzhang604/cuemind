import test from 'node:test';
import assert from 'node:assert/strict';
import {promptFor,prompts} from '../extension/services/prompts.js';
import {runFocusTask} from '../extension/services/focus.js';
import {selectFocusConfig} from '../extension/core/focus.js';

test('custom preferences supplement rather than replace built-in evidence and JSON constraints',()=>{
 const custom='用简单中文解释，先回答，再解释。';
 for(const key of Object.keys(prompts)){
  assert.equal(promptFor({},key),prompts[key]);
  const output=promptFor({prompts:{[key]:custom}},key);
  assert.ok(output.startsWith(prompts[key]));assert.ok(output.endsWith(custom));assert.match(output,/不改变上述证据和输出结构约束/);
 }
 // Even a conflicting preference cannot replace the built-in output schema.
 const conflicting=promptFor({prompts:{translation:'不用返回格式，直接写译文。'}},'translation');
 assert.ok(conflicting.startsWith(prompts.translation));assert.match(conflicting,/"translations"/);
});
test('focus sends saved preferences and refreshes only current goal when preferences change',async()=>{
 const previous=globalThis.fetch,systems=[];
 globalThis.fetch=async(url,options)=>{const messages=JSON.parse(options.body).messages;systems.push(messages[0].content);const {sentences}=JSON.parse(messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items:sentences.map(s=>({sentenceId:s.sentenceId,marks:[]}))})}}]}));};
 try{
  const record={videoInfo:{title:'Example'},sentences:[{id:'s1',start:0,end:5,rawText:'Capital matters.'}],focusConfig:{goal:'finance'}};
  const settings={provider:'openai',baseUrl:'https://fixture.example/v1',apiKey:'FIXTURE',model:'fixture',prompts:{focus:'只选核心表达。'}};
  const run=()=>runFocusTask(record,settings,{},new AbortController().signal,async()=>{});
  await run();assert.ok(systems[0].includes('只选核心表达。'));assert.ok(systems[0].includes('禁止改写'));
  await run();assert.equal(systems.length,1);
  selectFocusConfig(record,{goal:'toefl'});await run();const toefl=structuredClone(record.focusCache);
  selectFocusConfig(record,{goal:'finance'});settings.prompts.focus='优先自然搭配。';await run();assert.equal(systems.length,3);assert.ok(systems[2].endsWith('优先自然搭配。'));
  selectFocusConfig(record,{goal:'toefl'});assert.deepEqual(record.focusCache,toefl);
 }finally{globalThis.fetch=previous;}
});
