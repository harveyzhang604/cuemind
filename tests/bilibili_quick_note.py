"""Isolated real extension: Bilibili Note persistence and stale runtime recovery."""
from pathlib import Path
import tempfile,base64,io,wave
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options
ROOT=Path(__file__).resolve().parents[1]
buf=io.BytesIO()
with wave.open(buf,'wb') as f:
 f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b'\0\0'*8000*10)
audio=base64.b64encode(buf.getvalue()).decode()
with sync_playwright() as p,tempfile.TemporaryDirectory(prefix='cuemind-bili-note-') as profile:
 ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 ctx.route('https://www.bilibili.com/**',lambda r:r.fulfill(body=f'<div class="bpx-player-container" style="height:600px;position:relative"><video src="data:audio/wav;base64,{audio}"></video></div>',content_type='text/html'))
 page.goto('https://www.bilibili.com/video/BV1dnuq6dEak/?p=2');page.wait_for_function('document.querySelector("video").readyState>=2')
 panel=ctx.new_page();panel.goto(f'chrome-extension://{eid}/panel/settings.html')
 tid=worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.bilibili.com/*"}))[0].id')
 def isolated(code):
  return worker.evaluate('async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>{'+code+'}}))[0].result',tid)
 def rpc(kind,**kw):
  r=panel.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':kind,**kw});assert r['ok'],r;return r.get('data')
 record=rpc('IMPORT',info={'platform':'bilibili','videoId':'BV1dnuq6dEak','page':2,'title':'Bilibili Note fixture','url':page.url,'duration':10},raw=[{'start':0,'end':4,'text':'第一句原文。'},{'start':4,'end':8,'text':'第二句原文。'}])
 # Expose the otherwise closed shadow only in this disposable test profile.
 isolated('window.__cueMindCleanup();window.fixtureChrome=chrome;window.fixtureAttach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){return window.fixtureAttach.call(this,{...o,mode:"open"})}')
 def inject():worker.evaluate('async id=>await chrome.scripting.executeScript({target:{tabId:id},files:["content/player.js"]})',tid)
 inject();note=page.locator('#cuemind-tools').get_by_role('button',name='✎ Note · N');notice=page.locator('#cuemind-tools .notice')
 # A stale duplicate must be removed without replacing the healthy bridge.
 isolated('const ghost=document.createElement("div");ghost.id="cuemind-tools";document.querySelector(".bpx-player-container").append(ghost);window.fixtureOriginalHost=window.__cueMindToolsHost')
 assert page.locator('#cuemind-tools').count()==2;inject();assert page.locator('#cuemind-tools').count()==1
 assert isolated('return window.__cueMindToolsHost===window.fixtureOriginalHost')
 note.click();expect(notice).to_contain_text('笔记已保存');notes=rpc('NOTES');assert len(notes)==1 and notes[0]['body']=='第一句原文。' and notes[0]['videoKey']=='bilibili:BV1dnuq6dEak:2'
 # Undefined runtime (the screenshot's exact failure) must never write or show a TypeError.
 isolated('window.chrome={};document.querySelector("#cuemind-tools").shadowRoot.querySelectorAll("button")[1].click()')
 expect(notice).to_contain_text('插件连接已失效');expect(note).to_be_disabled();assert len(rpc('NOTES'))==1
 page.wait_for_timeout(400);expect(notice).to_be_visible()
 isolated('window.chrome=window.fixtureChrome');inject();assert page.locator('#cuemind-tools').count()==1
 note.click();expect(notice).to_contain_text('笔记已保存');assert len(rpc('NOTES'))==2
 # A promise rejected during a click also receives the recovery message.
 isolated('window.fixtureSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=()=>Promise.reject(new Error("Extension context invalidated."));document.querySelector("#cuemind-tools").shadowRoot.querySelectorAll("button")[1].click()')
 expect(notice).to_contain_text('插件连接已失效');assert len(rpc('NOTES'))==2
 isolated('chrome.runtime.sendMessage=window.fixtureSend');inject()
 # A pending save cannot be duplicated by a second click.
 isolated('window.fixtureSaves=0;chrome.runtime.sendMessage=m=>{if(m.type!=="QUICK_NOTE")return window.fixtureSend.call(chrome.runtime,m);window.fixtureSaves++;return new Promise(resolve=>setTimeout(()=>resolve(window.fixtureSend.call(chrome.runtime,m)),100));};const b=document.querySelector("#cuemind-tools").shadowRoot.querySelectorAll("button")[1];b.click();b.click()')
 expect(notice).to_contain_text('笔记已保存');assert isolated('return window.fixtureSaves')==1 and len(rpc('NOTES'))==3
 # A MAIN-world accidental injection cannot add an unusable toolbar.
 worker.evaluate('async id=>await chrome.scripting.executeScript({target:{tabId:id},world:"MAIN",files:["content/player.js"]})',tid)
 assert page.locator('#cuemind-tools').count()==1
 assert not errors,errors
 ctx.close()
print('Bilibili Note passed: actual extension/local DB, p=2 provenance, undefined and invalidated runtime, reinjection, pending double-click deduplication.')
