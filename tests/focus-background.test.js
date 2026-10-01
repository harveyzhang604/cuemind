import {recoverOrphanedFocus} from '../extension/core/record-recovery.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeFocusConfig,normalizeFocusCache,selectFocusConfig} from '../extension/core/focus.js';
import {focusState} from '../extension/services/focus.js';
import {taskConflict} from '../extension/core/task-lock.js';
import {defaults} from '../extension/services/ai-provider.js';
import {validateSettings} from '../extension/services/settings.js';

test('real background router allows QA/note during focus, rejects duplicate/writers, and cancels only focus',async()=>{
 const stores={videos:new Map([['r',{id:'r',videoKey:'youtube:abc:1',videoInfo:{title:'Example'},sentences:[{id:'s',rawText:'Capital matters.',start:0,end:2}]}]]),notes:new Map(),chats:new Map()};
 const storage={};let resolveFocus,focusSignal,resolveQa,qaSignal;const noop=()=>{};
 const context={recoverOrphanedFocus,console,AbortController,DOMException,URL,Date,Map,Set,crypto:globalThis.crypto,setInterval:noop,normalizeFocusConfig,normalizeFocusCache,selectFocusConfig,focusState,taskConflict,defaults,validateSettings,
 db:{get:async(store,id)=>structuredClone(stores[store].get(id)),all:async store=>structuredClone([...stores[store].values()]),put:async(store,value)=>{stores[store].set(value.id,structuredClone(value));return value;},remove:async(store,id)=>stores[store].delete(id)},
 chrome:{storage:{local:{setAccessLevel:noop,get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}},sidePanel:{setPanelBehavior:noop},action:{onClicked:{addListener:noop}},tabs:{onRemoved:{addListener:noop}},runtime:{sendMessage:async()=>{},onMessage:{addListener:noop}}},
 runTask:async(record,capability,config,args,signal)=>{if(capability==='focus'){focusSignal=signal;return new Promise(r=>resolveFocus=r);}if(capability==='qa'){qaSignal=signal;return new Promise(r=>resolveQa=r);}return {};}
 };
 vm.createContext(context);const source=(await readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import [\s\S]*?;\s*/gm,'');vm.runInContext(source+'\nglobalThis.router=route;',context);
 const route=context.router;
 const first=route({type:'TASK',recordId:'r',capability:'focus'});await new Promise(r=>setImmediate(r));assert.ok(focusSignal);
 await assert.rejects(route({type:'TASK',recordId:'r',capability:'focus'}),/正在处理/);
 await assert.rejects(route({type:'SAVE_FOCUS',recordId:'r',config:{goal:'finance'}}),/正在处理/);
 const qa=route({type:'TASK',recordId:'r',capability:'qa'});await new Promise(r=>setImmediate(r));assert.ok(qaSignal);
 const n=await route({type:'SAVE_NOTE',note:{recordId:'r',timestamp:0,sentenceIds:['s'],body:'Answer',sourceText:'Capital matters.',answerKey:'answer-1'}});
 assert.ok(n.id);assert.equal(stores.notes.size,1);
 const duplicate=await route({type:'SAVE_NOTE',note:{recordId:'r',timestamp:0,sentenceIds:['s'],body:'Answer',sourceText:'Capital matters.',answerKey:'answer-1'}});assert.equal(duplicate.id,n.id);assert.equal(stores.notes.size,1);
 await route({type:'CANCEL',recordId:'r',capability:'focus'});assert.equal(focusSignal.aborted,true);assert.equal(qaSignal.aborted,false);
 resolveFocus({});await assert.rejects(first,{name:'AbortError'});resolveQa({answer:'Answer',citations:[]});await qa;assert.equal(stores.chats.size,1);
 const saved=await route({type:'SAVE_FOCUS',recordId:'r',config:{goal:'finance',overlay:true,apiKey:'secret'},makeDefault:true});assert.equal(saved.config.goal,'finance');assert.ok(!('apiKey'in storage.focusDefaults));
 // Seed a model result in the actual store, then exercise the real save/read router.
 const record=stores.videos.get('r');record.focusCache.marks=[{sentenceId:'s',start:0,end:7,text:'Capital',level:3}];record.focusCache.done=[0];record.focusCache.status='complete';
 const other=await route({type:'SAVE_FOCUS',recordId:'r',config:{goal:'toefl'}});assert.equal(other.cache.marks.length,0);
 const restored=await route({type:'SAVE_FOCUS',recordId:'r',config:{goal:'finance',baseSize:20,videoSize:31,videoTranslationSize:22}});assert.equal(restored.cache.marks[0].text,'Capital');assert.equal(restored.cache.status,'complete');
 const persisted=await route({type:'GET_FOCUS',recordId:'r'});assert.equal(persisted.cache.marks[0].level,3);assert.equal(persisted.config.videoSize,31);assert.equal(persisted.config.videoTranslationSize,22);assert.equal(Object.keys(stores.videos.get('r').focusCaches).length,2);
});
