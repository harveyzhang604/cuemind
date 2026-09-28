"""Isolated extension data operations and real panel interactions, no personal Chrome data."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
from pathlib import Path
import tempfile,json
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 with tempfile.TemporaryDirectory(prefix='cuemind-data-fixture-') as profile:
  ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
  worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'chrome-extension://{eid}/panel/settings.html');page.wait_for_load_state('networkidle')
  def rpc(kind,**data):return page.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':kind,**data})
  cfg=rpc('GET_SETTINGS')['data'];cfg.update(apiKey='FIXTURE-AI',asrKey='FIXTURE-ASR',supadataApiKey='FIXTURE-SUPADATA',transcriptProvider='fallback')
  assert rpc('SAVE_SETTINGS',settings=cfg)['ok'];page.reload();expect(page.locator('#transcriptProvider')).to_have_value('fallback');expect(page.locator('#supadataApiKey')).to_have_value('FIXTURE-SUPADATA')
  r=rpc('IMPORT',info={'platform':'youtube','videoId':'fixture7','page':1,'title':'Fixture','url':'https://www.youtube.com/watch?v=fixture7','duration':10},raw=[{'start':.179,'end':2.2,'text':'Exact selected words.'}])['data']
  n=rpc('SAVE_NOTE',note={'recordId':r['id'],'body':'Keep me','sourceText':'Exact selected words.','timestamp':.179,'sentenceIds':[r['sentences'][0]['id']]})['data']
  page.evaluate('async r=>{const db=await import("../storage/db.js");r.sentences[0].translation="译文";r.tasks={translation:{done:[0],failed:[],signature:"test"}};r.focusCaches={test:{}};await db.put("videos",r);await db.put("chats",{id:"c",recordId:r.id,question:"Q",answer:"A",citations:[]});}',r)
  backup=rpc('BACKUP');assert backup['ok'];assert all(secret not in json.dumps(backup) for secret in ['FIXTURE-AI','FIXTURE-ASR','FIXTURE-SUPADATA'])
  assert not rpc('MANAGE_DATA',action='reset',confirmed=False)['ok'];assert rpc('DATA_STATS')['data']['notes']==1
  page.locator('[data-manage=delete-notes]').click();expect(page.locator('#data-description')).to_contain_text('保留字幕');page.locator('#data-cancel').click();assert rpc('DATA_STATS')['data']['notes']==1
  page.locator('[data-manage=clear-cache]').click();page.locator('#data-proceed').click();expect(page.locator('#data-status')).to_contain_text('已完成')
  after=rpc('GET_RECORD',recordId=r['id'])['data'];assert after['sentences'][0]['id']==r['sentences'][0]['id'];assert 'translation' not in after['sentences'][0];assert 'tasks' not in after and 'focusCaches' not in after
  assert rpc('NOTES')['data'][0]['body']=='Keep me';assert rpc('CHATS',recordId=r['id'])['data']==[];assert rpc('GET_SETTINGS')['data']['supadataApiKey']=='FIXTURE-SUPADATA'
  # A delayed write may not resurrect a deleted note or overwrite an edit.
  changed=rpc('SAVE_NOTE',note={**n,'body':'User edit'})['data']
  updated=page.evaluate('async n=>(await import("../storage/db.js")).updateNote(n.id,n.updatedAt,{body:"Late AI"})',n);assert updated is None
  assert rpc('NOTES')['data'][0]['body']=='User edit'
  page.locator('[data-manage=delete-notes]').click();page.locator('#data-proceed').click();page.wait_for_function('document.querySelector("#data-counts").textContent.includes("0 条笔记")');assert rpc('GET_RECORD',recordId=r['id'])['ok'];assert rpc('GET_SETTINGS')['data']['apiKey']=='FIXTURE-AI'
  assert page.evaluate('async n=>(await import("../storage/db.js")).updateNote(n.id,n.updatedAt,{body:"Late AI"})',changed) is None
  page.locator('[data-manage=reset]').click();expect(page.locator('#data-description')).to_contain_text('API Key');page.locator('#data-proceed').click();expect(page.locator('#supadataApiKey')).to_have_value('');expect(page.locator('#transcriptProvider')).to_have_value('platform');assert rpc('DATA_STATS')['data']=={'videos':0,'notes':0,'chats':0};assert rpc('GET_SETTINGS')['data']['apiKey']==''
  for width in [320,430,900]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  page.set_viewport_size({'width':900,'height':900});page.evaluate('scrollTo(0,0)');page.screenshot(path=str(ROOT/'docs/screenshots/zara-settings-20260927.png'))
  page.locator('[data-manage=reset]').scroll_into_view_if_needed();page.screenshot(path=str(ROOT/'docs/screenshots/zara-local-data-20260927.png'))
  assert not errors,errors;ctx.close()
with preview_server() as base,sync_playwright() as p:
 b=p.chromium.launch(headless=True,**chromium_options());page=b.new_page(viewport={'width':430,'height':850});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.calls=[];window.notes=JSON.parse(sessionStorage.getItem('notes')||'[]');window.local=JSON.parse(sessionStorage.getItem('local')||'{}');window.listeners=[];window.chrome={runtime:{id:'fixture',getURL:p=>p,onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{calls.push(m);const ok=data=>({ok:true,data});
 if(m.type==='GET_SETTINGS')return ok({targetLanguage:'简体中文',supadataApiKey:'fixture',apiKey:'FIXTURE'});
 if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.id='fixture';r.videoKey='youtube:fixture7:1';r.videoInfo={...r.videoInfo,platform:'youtube',videoId:'fixture7',title:'Fixture',duration:700};r.sentences=Array.from({length:140},(_,i)=>({id:'s'+i,start:i*5,end:i*5+5,rawText:'Learning sentence '+i+'.',sourceIds:['raw'+i]}));r.paragraphs=[];r.transcriptMeta={source:'supadata_native',language:'en',trackId:'supadata'};window.recordFixture=r;return ok({record:r,tracks:[]});}
 if(m.type==='PLAYER_COMMAND'&&m.command.action==='state')return ok({videoKey:'youtube:fixture7:1',time:0,paused:true,rate:1});
 if(m.type==='NOTES')return ok(notes);if(m.type==='CHATS')return ok([]);if(m.type==='SAVE_NOTE'){const n={...m.note,id:'n'+notes.length,videoInfo:recordFixture.videoInfo};notes.push(n);sessionStorage.setItem('notes',JSON.stringify(notes));return ok(n);}
 if(m.type==='TRANSLATE_NOTES'){const result=notes.filter(n=>m.ids.includes(n.id));for(const n of result)n.translations={'简体中文':{source:n.body,text:'选中的原话'}};return ok(result);}
 return ok(null);}},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture7'}],onActivated:{addListener:()=>{}}},storage:{local:{get:async k=>({[k]:local[k]}),set:async v=>{Object.assign(local,v);sessionStorage.setItem('local',JSON.stringify(local));}},onChanged:{addListener:()=>{}}}};''')
 page.goto(base+'/extension/panel/index.html');page.locator('.sentence').first.wait_for();page.wait_for_timeout(300)
 page.locator('#transcript-mode').select_option('bilingual');page.wait_for_function('calls.some(m=>m.type==="TASK"&&m.capability==="translation")')
 page.locator('#toggle-search').click();page.locator('#search').fill('Learning');expect(page.locator('#search-count')).to_have_text('1/140 处');page.locator('#search').press('Enter');expect(page.locator('#search-count')).to_have_text('2/140 处');page.locator('#search').press('Shift+Enter');expect(page.locator('#search-count')).to_have_text('1/140 处')
 page.locator('#search').fill('sentence 130.');expect(page.locator('#search-count')).to_have_text('1/1 处');expect(page.locator('.sentence .caption-original')).to_have_text('Learning sentence 130.');page.locator('#close-search').click();page.evaluate('window.scrollTo(0,0)')
 # Select exactly a substring, then persist without invoking AI or seeking.
 page.evaluate('''()=>{const n=document.querySelector('.caption-original').firstChild;const r=document.createRange();r.setStart(n,0);r.setEnd(n,8);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}''')
 task_count=page.evaluate('calls.filter(m=>m.type==="TASK").length')
 page.locator('.selection-note').click();page.wait_for_function('notes.length===1');assert page.evaluate('notes[0].body')=='Learning';assert page.evaluate('calls.filter(m=>m.type==="TASK").length')==task_count
 page.evaluate('getSelection().removeAllRanges()');page.locator('[data-tab=notes]').click();page.locator('#translate-notes').click();expect(page.locator('#notes-list .translation')).to_have_text('选中的原话');count=page.evaluate('calls.filter(m=>m.type==="TRANSLATE_NOTES").length');page.locator('#translate-notes').click();assert page.evaluate('calls.filter(m=>m.type==="TRANSLATE_NOTES").length')==count
 page.locator('[data-tab=transcript]').click();page.locator('#transcript-mode').select_option('bilingual');page.mouse.move(200,400);page.mouse.wheel(0,600);page.wait_for_function('local["reading:youtube:fixture7:1"]?.scrollY>0');saved=page.evaluate('local["reading:youtube:fixture7:1"]');assert saved['scrollY']>0
 page.reload();page.locator('.sentence').first.wait_for();page.wait_for_timeout(500);expect(page.locator('#transcript-mode')).to_have_value('bilingual');assert abs(page.evaluate('scrollY')-saved['scrollY'])<5
 assert not errors,errors;b.close()
print('Zara integration browser passed: isolated bulk deletion/reset, cache scope, secret redaction, conditional writes, selection note, search, translation reuse, per-video reading restore.')
