import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverEquivalentLearning} from '../extension/core/record-recovery.js';
import {selectFocusConfig} from '../extension/core/focus.js';

const sentences=()=>[
  {id:'s1',rawText:'Listen carefully.',start:0,end:2},
  {id:'s2',rawText:'Repeat after me.',start:2,end:4}
];
const record=id=>({id,videoKey:'youtube:abc:1',schemaVersion:2,sentences:sentences(),rawCaptions:[{id:'c1'}]});

test('an identical subtitle revision reuses completed translations and focus analysis',()=>{
  const old=record('old'),signature='["deepseek","url","model","简体中文",""]';
  old.sentences[0].translation='认真听。';old.sentences[1].translation='跟我重复。';
  old.translationCaches={[signature]:{s1:{source:'Listen carefully.',text:'认真听。'},s2:{source:'Repeat after me.',text:'跟我重复。'}}};
  old.tasks={translation:{signature,done:[0],failed:[]}};
  selectFocusConfig(old,{goal:'toefl',overlay:true});
  old.focusCache.marks=[{sentenceId:'s1',start:0,end:6,text:'Listen',level:3}];
  old.focusCache.done=[0];old.focusCache.status='complete';
  const fresh=record('new'),result=recoverEquivalentLearning(fresh,[fresh,old]);
  assert.equal(result.translations,2);assert.equal(result.focus,1);
  assert.deepEqual(fresh.sentences.map(s=>s.translation),['认真听。','跟我重复。']);
  assert.equal(fresh.tasks.translation.signature,signature);
  assert.equal(fresh.focusConfig.goal,'toefl');
  assert.equal(fresh.focusCache.marks[0].text,'Listen');
  assert.equal(old.sentences[0].rawText,'Listen carefully.');
});

test('changed source sentence never imports another revision’s AI data',()=>{
  const old=record('old');old.sentences[0].translation='认真听。';
  selectFocusConfig(old,{goal:'toefl'});old.focusCache.marks=[{sentenceId:'s1',start:0,end:6,text:'Listen',level:3}];
  const fresh=record('new');fresh.sentences[0].rawText='Listen again.';
  const result=recoverEquivalentLearning(fresh,[old]);
  assert.equal(result.translations,0);assert.equal(result.focus,0);
  assert.equal(fresh.sentences[0].translation,undefined);
  assert.equal(fresh.focusCache,undefined);
});

test('changed sentence IDs and one revised cue preserve only matching annotations',()=>{
  const old=record('old');
  old.sentences[0].translation='认真听。';
  old.sentences[1].translation='跟我重复。';
  selectFocusConfig(old,{goal:'toefl'});
  old.focusCache.marks=[
    {sentenceId:'s1',start:0,end:6,text:'Listen',level:3},
    {sentenceId:'s2',start:0,end:6,text:'Repeat',level:2}
  ];
  old.focusCache.done=[0];old.focusCache.status='complete';
  const fresh=record('new');
  fresh.sentences[0].id='new-s1';
  fresh.sentences[1].id='new-s2';
  fresh.sentences[1].rawText='Repeat once more.';
  const result=recoverEquivalentLearning(fresh,[old]);
  assert.equal(result.translations,1);
  assert.equal(result.focus,1);
  assert.equal(fresh.sentences[0].translation,'认真听。');
  assert.equal(fresh.sentences[1].translation,undefined);
  assert.deepEqual(fresh.focusCache.marks.map(mark=>[mark.sentenceId,mark.text,mark.level]),[['new-s1','Listen',3]]);
  assert.deepEqual(fresh.focusCache.done,[]);
  assert.equal(fresh.focusCache.status,'partial');
});

test('a uniquely matching phrase survives a caption-track timing shift',()=>{
  const old=record('old');old.sentences[0].translation='认真听。';
  selectFocusConfig(old,{goal:'toefl'});
  old.focusCache.marks=[{sentenceId:'s1',start:0,end:6,text:'Listen',level:3}];
  const fresh=record('new');fresh.sentences[0].id='shifted';fresh.sentences[0].start=4;fresh.sentences[0].end=6;
  const result=recoverEquivalentLearning(fresh,[old]);
  assert.equal(result.translations,1);
  assert.equal(result.focus,1);
  assert.equal(fresh.focusCache.marks[0].sentenceId,'shifted');
});

test('translations from a different model or target language stay out of the active display',()=>{
  const old=record('old');old.sentences[0].translation='认真听。';
  old.tasks={translation:{signature:'chinese',done:[0],failed:[]}};
  old.translationCaches={chinese:{s1:{source:'Listen carefully.',text:'认真听。'}}};
  const fresh=record('new');
  const result=recoverEquivalentLearning(fresh,[old],{translationSignature:'japanese'});
  assert.equal(result.translations,0);
  assert.equal(result.cacheEntries,1);
  assert.equal(fresh.sentences[0].translation,undefined);
  assert.equal(fresh.translationCaches.chinese.s1.text,'认真听。');
});
