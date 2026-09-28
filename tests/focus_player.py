"""Real Chromium layout/lifecycle test; synthetic video and platform DOM, no external requests."""
from playwright.sync_api import sync_playwright
from browser_support import chromium_options
from pathlib import Path
import tempfile
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='cuemind-focus-player-') as profile:
 ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 page=ctx.new_page();page.set_viewport_size({'width':1000,'height':760})
 html='''<html><body style="margin:0"><div id="movie_player" style="position:relative;width:800px;height:450px;margin:20px;background:#222"><video style="width:100%;height:100%"></video><div class="ytp-caption-window-container">Native captions</div></div></body></html>'''
 ctx.route('https://www.youtube.com/**',lambda route:route.fulfill(body=html,content_type='text/html'))
 page.goto('https://www.youtube.com/watch?v=focusfixture')
 tid=worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.youtube.com/*"}))[0].id')
 def inject():worker.evaluate('async id=>await chrome.scripting.executeScript({target:{tabId:id},files:["content/player.js"]})',tid)
 inject()
 def command(**kwargs):
  result=worker.evaluate('async x=>chrome.tabs.sendMessage(x.id,{type:"PLAYER",...x.command})',{'id':tid,'command':{'videoKey':'youtube:focusfixture:1',**kwargs}})
  assert result['ok'],result
  return result.get('data')
 def seek(t):page.eval_on_selector('video','(v,t)=>{v.currentTime=t;v.dispatchEvent(new Event("timeupdate"));}',t);page.wait_for_timeout(220)
 def visible():return page.locator('#cuemind-focus-captions').count()>0 and page.locator('#cuemind-focus-captions').is_visible()
 def native():return page.locator('.ytp-caption-window-container').evaluate('(e)=>getComputedStyle(e).visibility')
 cues=[{'id':'first','start':0,'end':3,'rawText':'Normal term important critical.','translation':'普通、相关、重要、关键。','parts':[{'text':'Normal ','level':0},{'text':'term ','level':1},{'text':'important ','level':2},{'text':'critical.','level':3}]},{'id':'second','start':5,'end':8,'rawText':'<img src=x onerror=alert(1)> Safe literal.','translation':'按文字显示。','parts':[{'text':'forged','level':3}]}]
 def configure(**kw):command(action='focusCaptions',enabled=True,baseSize=28,language='original',sentences=cues,**kw)
 assert not visible() and native()=='visible'
 configure();seek(1)
 assert visible() and native()=='hidden'
 close=page.locator('#cuemind-focus-captions .close')
 assert close.evaluate('(e)=>getComputedStyle(e).opacity')=='0'
 page.locator('#cuemind-focus-captions .caption-shell').hover()
 assert close.evaluate('(e)=>getComputedStyle(e).opacity')=='1'
 body_box=page.locator('#cuemind-focus-captions .body').bounding_box();close_box=close.bounding_box()
 assert abs(close_box['x']+close_box['width']-body_box['x']-body_box['width'])<1
 page.mouse.move(0,0)
 assert close.evaluate('(e)=>getComputedStyle(e).opacity')=='0'
 close.focus();assert close.evaluate('(e)=>getComputedStyle(e).opacity')=='1'
 close.evaluate('(e)=>e.blur()')
 sizes=page.locator('#cuemind-focus-captions .body span').evaluate_all('(nodes)=>nodes.map(n=>parseFloat(getComputedStyle(n).fontSize))')
 assert sizes==[28,30.8,35,39.2],sizes
 assert page.locator('#cuemind-focus-captions .body').inner_text()==cues[0]['rawText']
 # Updating future marks must not restyle or flash the cue already being read.
 updated=[{**cues[0],'parts':[{'text':cues[0]['rawText'],'level':3}]},cues[1]]
 command(action='focusCaptions',enabled=True,baseSize=28,language='original',sentences=updated)
 assert page.locator('#cuemind-focus-captions .level-1').count()==1
 command(action='focusCaptions',enabled=True,baseSize=28,language='original',sentences=updated,refreshCurrent=True)
 assert page.locator('#cuemind-focus-captions .level-1').count()==0
 assert page.locator('#cuemind-focus-captions .level-3').inner_text()==cues[0]['rawText']
 command(action='rate',rate=1.5);seek(2);assert visible()
 seek(4);assert not visible() and native()=='visible'
 seek(6);assert visible() and page.locator('#cuemind-focus-captions img').count()==0
 assert page.locator('#cuemind-focus-captions .body').inner_text()==cues[1]['rawText']
 assert page.locator('#cuemind-focus-captions [class^=level]').count()==0
 page.locator('#movie_player').evaluate('(e)=>e.classList.add("ad-showing")');page.wait_for_timeout(220)
 assert not visible() and native()=='visible'
 configure();assert not visible() # Config permitted while ad plays, no overlay.
 page.locator('#movie_player').evaluate('(e)=>e.classList.remove("ad-showing")');page.wait_for_timeout(220)
 assert visible() and native()=='hidden'
 command(action='focusCaptions',enabled=True,baseSize=28,language='bilingual',sentences=cues);seek(1)
 assert page.locator('#cuemind-focus-captions .translation').inner_text()==cues[0]['translation']
 font=page.locator('#cuemind-focus-captions .body').evaluate('(e)=>({original:parseFloat(getComputedStyle(e).fontSize),translation:parseFloat(getComputedStyle(e.querySelector(".translation")).fontSize)})')
 assert font['original']==28 and abs(font['translation']-18)<.02,font
 command(action='focusCaptions',enabled=True,baseSize=28,translationSize=22,language='bilingual',sentences=cues)
 font=page.locator('#cuemind-focus-captions .body').evaluate('(e)=>({original:parseFloat(getComputedStyle(e).fontSize),translation:parseFloat(getComputedStyle(e.querySelector(".translation")).fontSize)})')
 assert font['original']==28 and font['translation']==22,font
 command(action='focusCaptions',enabled=True,baseSize=34,translationSize=22,language='bilingual',sentences=cues)
 font=page.locator('#cuemind-focus-captions .body').evaluate('(e)=>({original:parseFloat(getComputedStyle(e).fontSize),translation:parseFloat(getComputedStyle(e.querySelector(".translation")).fontSize)})')
 assert font['original']==34 and font['translation']==22,font
 command(action='focusCaptions',enabled=True,baseSize=32,language='translated',sentences=cues)
 assert page.locator('#cuemind-focus-captions .body').inner_text()==cues[0]['translation']
 font=page.locator('#cuemind-focus-captions .body').evaluate('(e)=>({original:parseFloat(getComputedStyle(e).fontSize),translation:parseFloat(getComputedStyle(e.querySelector(".translation")).fontSize)})')
 assert font['original']==32 and font['translation']==18,font
 assert page.locator('#cuemind-focus-captions .level-3').count()==0
 # Real fullscreen API: overlay remains in fullscreen subtree, geometry follows video.
 page.locator('#movie_player').evaluate('(e)=>e.requestFullscreen()');page.wait_for_timeout(250)
 assert page.evaluate('document.fullscreenElement.contains(document.querySelector("#cuemind-focus-captions"))')
 page.evaluate('document.exitFullscreen()');page.wait_for_timeout(250)
 # A normal upper-bound sentence at standard player width keeps the requested readable type.
 normal=('Working capital supports daily operations, while long-term assets serve a different purpose. '*3)[:280]
 command(action='focusCaptions',enabled=True,baseSize=28,language='bilingual',sentences=[{'id':'normal','start':0,'end':8,'rawText':normal,'translation':'营运资金用于日常经营，长期资产服务于不同的目标。'*3,'parts':[{'text':normal,'level':0}]}])
 normal_size=float(page.locator('#cuemind-focus-captions .body').evaluate('(e)=>getComputedStyle(e).fontSize').removesuffix('px'));assert normal_size>=20,normal_size
 # Narrow/long cue preserves all text, contained in viewport; accessible scroll is last resort.
 long='A very long professional expression and its detailed explanation. '*70
 command(action='focusCaptions',enabled=True,baseSize=48,language='original',sentences=[{'id':'long','start':0,'end':8,'rawText':long,'parts':[{'text':long,'level':3}]}])
 page.locator('#movie_player').evaluate('(e)=>{e.style.width="280px";e.style.height="170px";}');page.wait_for_timeout(250)
 body=page.locator('#cuemind-focus-captions .body');assert body.text_content()==long
 box=body.bounding_box();video=page.locator('video').bounding_box()
 assert box['x']>=video['x'] and box['x']+box['width']<=video['x']+video['width']+1,(box,video)
 assert box['height']<=video['height']*.55+1,(box,video)
 assert body.get_attribute('tabindex')=='0' and '滚动' in body.get_attribute('aria-label')
 page.locator('#cuemind-focus-captions .caption-shell').hover();page.locator('#cuemind-focus-captions .close').click();assert not visible() and native()=='visible'
 assert command(action='state')['focusCaptionsClosed'] is True
 assert command(action='state')['focusCaptionsVideoKey']=='youtube:focusfixture:1'
 configure();assert visible()
 command(action='focusCaptions',enabled=False);assert page.locator('#cuemind-focus-captions').count()==0 and native()=='visible'
 configure();page.evaluate('history.pushState(null,"","/watch?v=otherfixture")');page.wait_for_timeout(220)
 assert not visible() and native()=='visible'
 page.evaluate('history.pushState(null,"","/watch?v=focusfixture")');page.wait_for_timeout(220);configure()
 worker.evaluate('async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>window.__cueMindCleanup()})',tid)
 page.wait_for_timeout(1100);assert page.locator('#cuemind-focus-captions').count()==0 and native()=='visible'
 assert page.locator('style[data-cuemind-focus-native]').count()==0
 inject();inject();configure();assert page.locator('#cuemind-focus-captions').count()==1
 # Invalid intervals and levels safely fall back to ordinary text or no overlay.
 command(action='focusCaptions',enabled=True,sentences=[{'id':'bad','start':4,'end':2,'rawText':'invalid'}]);assert not visible() and native()=='visible'
 # Equivalent Bilibili player DOM, including a second native player that must remain untouched.
 ctx.route('https://www.bilibili.com/**',lambda route:route.fulfill(body=html.replace('id="movie_player"','class="bpx-player-container"').replace('ytp-caption-window-container','bpx-player-subtitle-panel'),content_type='text/html'))
 page.goto('https://www.bilibili.com/video/BVfixture?p=2');inject()
 page.evaluate("""document.body.insertAdjacentHTML("beforeend",'<div class="bpx-player-container"><div class="bpx-player-subtitle-panel">Other native</div></div>')""")
 result=worker.evaluate('async x=>chrome.tabs.sendMessage(x.id,{type:"PLAYER",action:"focusCaptions",videoKey:"bilibili:BVfixture:2",enabled:true,sentences:x.cues})',{'id':tid,'cues':cues});assert result['ok'],result
 seek(1);assert visible()
 natives=page.locator('.bpx-player-subtitle-panel').evaluate_all('(nodes)=>nodes.map(e=>getComputedStyle(e).visibility)');assert natives==['hidden','visible'],natives
 page.locator('#cuemind-focus-captions .caption-shell').hover();page.locator('#cuemind-focus-captions .close').click()
 assert page.locator('.bpx-player-subtitle-panel').evaluate_all('(nodes)=>nodes.every(e=>getComputedStyle(e).visibility==="visible")')
 print('Focus player passed: real typography ratios, literal text safety, shared parts validation, stable cue, gap/ad/native restoration, bilingual, fullscreen, narrow long cue, close, navigation and cleanup/reinject.')
 ctx.close()
