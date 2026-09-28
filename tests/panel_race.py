from playwright.sync_api import sync_playwright
from browser_support import chromium_options, preview_server

with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''
      window.pending=[];window.tabNumber=1;window.messages=[];
      window.chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,
        onMessage:{addListener:fn=>window.messages.push(fn)},
        sendMessage:async m=>{
          if(['LOAD','OVERRIDE'].includes(m.type))return new Promise(resolve=>pending.push({m,resolve}));
          if(m.type==='GET_SETTINGS')return {ok:true,data:{}};
          if(m.type==='CAPTURE_STATUS')return {ok:true,data:null};
          if(['NOTES','CHATS'].includes(m.type))return {ok:true,data:[]};
          return {ok:true,data:true};
        }},tabs:{query:async()=>[{id:tabNumber,url:window.tabUrl||'https://www.youtube.com/watch?v=video'+tabNumber}],onActivated:{addListener:()=>{}},onUpdated:{addListener:fn=>window.updated=fn}},
        storage:{onChanged:{addListener:()=>{}}}};
    ''')
    page.goto(base+'/extension/panel/index.html')
    page.wait_for_function('pending.length===1')
    page.evaluate("messages.forEach(fn=>fn({type:'EVENT',event:'PAGE_CHANGED',tabId:1,videoKey:'youtube:video1:1'}))")
    page.wait_for_timeout(50)
    assert page.evaluate('pending.length')==1, 'same-video page event restarted an in-flight load'
    page.evaluate('''async()=>{
      const {demoRecord}=await import('./demo.js');
      window.result=n=>{const r=demoRecord();r.id='record'+n;r.videoKey='youtube:video'+n+':1';r.videoInfo.platform='youtube';r.videoInfo.title='Video '+n;return {record:r,tracks:[]};};
      window.tabNumber=2;document.querySelector('#refresh').click();
    }''')
    # The first request has a tab ID but no record yet. Retrying and leaving
    # the panel in that state must not dereference the missing old record.
    page.wait_for_function('pending.length===2')
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    assert 'videoKey' not in page.locator('#status').inner_text()
    page.evaluate('pending[1].resolve({ok:true,data:result(2)})')
    page.wait_for_function('document.querySelector("#video-title").textContent==="Video 2"')
    page.evaluate('pending[0].resolve({ok:true,data:result(1)})')
    page.wait_for_timeout(100)
    assert page.locator('#video-title').inner_text()=='Video 2'
    # A late manual-study response must not replace the next video's state.
    page.locator('[data-tab="transcript"]').click()
    page.locator('.transcript-more>summary').click();page.locator('#open-replay').click()
    page.locator('#study-list .study-sentence').first.hover()
    page.locator('#study-list select').first.select_option('skim')
    page.wait_for_function('pending.length===3')
    page.evaluate('tabNumber=3;document.querySelector("#refresh").click()')
    page.wait_for_function('pending.length===4')
    page.evaluate('pending[3].resolve({ok:true,data:result(3)})')
    page.wait_for_function('document.querySelector("#video-title").textContent==="Video 3"')
    page.evaluate('pending[2].resolve({ok:true,data:result(2).record})')
    page.wait_for_timeout(100)
    assert page.locator('#video-title').inner_text()=='Video 3'
    page.locator('#close-replay').click()
    page.locator('[data-tab="transcript"]').click()
    page.locator('#toggle-search').click()
    page.locator('#search').fill('retrieval')
    assert page.locator('.sentence').count()==1
    page.locator('#locate').click()
    assert page.locator('.sentence').count()==10
    page.locator('#toggle-search').click()
    page.locator('#search').fill('retrieval')
    page.evaluate("tabUrl='https://www.youtube.com/watch?v=video4';updated(3,{url:tabUrl})")
    page.wait_for_function('pending.length===5')
    page.evaluate('pending[4].resolve({ok:true,data:result(4)})')
    page.wait_for_function('document.querySelector("#video-title").textContent==="Video 4"')
    assert page.locator('#search').input_value()==''
    assert not errors,errors
    browser.close()
print('Panel race regression passed: stale loads, same-tab video navigation, stale study overrides and filtered current-sentence navigation.')
