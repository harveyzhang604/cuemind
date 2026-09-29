"""Migu's displayed programme clock must drive the panel and video captions."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_support import chromium_options

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<html><body>
<div current-content-id="967772705"></div>
<section id="mod-player" style="position:relative;width:800px;height:450px">
  <video style="width:800px;height:450px"></video>
  <span class="cur-time">05:15</span><span class="end-time">03:16:48</span>
</section></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **chromium_options())
    page = browser.new_page()
    page.route('https://www.miguvideo.com/**', lambda route: route.fulfill(body=HTML, content_type='text/html'))
    page.add_init_script('''window.playerListeners=[];window.chrome={runtime:{id:'fixture',getManifest:()=>({}),
      sendMessage:async()=>({ok:true}),onMessage:{addListener:f=>playerListeners.push(f),removeListener:()=>{}}}};''')
    page.goto('https://www.miguvideo.com/p/live/120000587094')
    page.evaluate('''() => {const v=document.querySelector('video');
      Object.defineProperties(v,{currentTime:{value:229,writable:true},duration:{value:11808},
        readyState:{value:4,writable:true},paused:{value:false}})}''')
    page.add_script_tag(path=str(ROOT / 'extension/content/player.js'))
    def command(**data):
        return page.evaluate('''data=>new Promise(resolve=>playerListeners[0](
          {type:'PLAYER',videoKey:'migu:120000587094:967772705',...data},
          {id:'fixture'},resolve))''', data)
    state = command(action='state')
    assert state['ok'] and state['data']['time'] == 315 and not state['data']['unavailable'], state
    cue = lambda id, start, text: {'id':id,'start':start,'end':start+20,'rawText':text,'translation':'中文',
                                    'parts':[{'text':text,'level':0}]}
    configured = command(action='focusCaptions',enabled=True,language='bilingual',
                         sentences=[cue('old',225,'Old fight commentary.'),cue('current',310,'Current intro.')])
    assert configured['ok'], configured
    body = page.locator('#cuemind-focus-captions .body')
    assert body.is_visible() and 'Current intro.' in body.inner_text(), body.inner_text()
    # ASR writes can replace a cue without changing its ID or its time span.
    command(action='focusCaptions',enabled=True,language='bilingual',refreshCurrent=True,
            sentences=[cue('old',225,'Old fight commentary.'),cue('current',310,'Corrected intro.')])
    assert 'Corrected intro.' in body.inner_text(), body.inner_text()
    page.evaluate("document.querySelector('video').readyState=0")
    page.wait_for_timeout(250)
    assert not page.locator('#cuemind-focus-captions').is_visible()
    stalled = command(action='state')
    assert stalled['data']['unavailable'] is True, stalled
    browser.close()

print('Migu clock passed: displayed time, current caption refresh, and stalled media guard.')
