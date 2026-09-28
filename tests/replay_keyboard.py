"""Real extension bridge: video keyboard single seek, double expand, replay Space."""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from browser_support import chromium_options
import tempfile, json, base64, io, wave
ROOT=Path(__file__).resolve().parents[1]
buf=io.BytesIO()
with wave.open(buf,'wb') as f:
 f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b'\0\0'*8000*40)
audio=base64.b64encode(buf.getvalue()).decode()
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='cuemind-keyboard-') as profile:
 ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension','--autoplay-policy=no-user-gesture-required'])
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
 page=ctx.new_page()
 response={'videoDetails':{'videoId':'fixture','title':'Keyboard fixture','author':'CueMind','lengthSeconds':'40'},'microformat':{'playerMicroformatRenderer':{'defaultAudioLanguage':'en'}},'captions':{'playerCaptionsTracklistRenderer':{'captionTracks':[{'languageCode':'en','baseUrl':'https://www.youtube.com/api/timedtext?v=fixture&lang=en'}]}}}
 html=f'<html><body tabindex="0"><input id="search"><video controls src="data:audio/wav;base64,{audio}"></video><script>window.ytInitialPlayerResponse={json.dumps(response)};document.addEventListener("keydown",e=>{{if(!e.defaultPrevented&&e.target.tagName!=="INPUT"&&["ArrowLeft","ArrowRight"].includes(e.key))document.querySelector("video").currentTime+=e.key==="ArrowLeft"?-5:5;}},true);document.addEventListener("keyup",e=>{{if(!e.defaultPrevented&&e.key===" "&&e.target.tagName!=="INPUT"){{const v=document.querySelector("video");window.nativeSpaceCount=(window.nativeSpaceCount||0)+1;v.paused?v.play():v.pause();}}}},true);</script></body></html>'
 def route(r):
  if '/api/timedtext' in r.request.url:r.fulfill(json={'events':[{'tStartMs':i*2000,'dDurationMs':2000,'segs':[{'utf8':f'This is sentence number {i}.'}]} for i in range(20)]})
  else:r.fulfill(body=html,content_type='text/html')
 ctx.route('https://www.youtube.com/**',route)
 page.goto('https://www.youtube.com/watch?v=fixture');page.wait_for_function('document.querySelector("video").readyState>=2')
 panel=ctx.new_page()
 panel.add_init_script("const originalQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=()=>originalQuery({url:'https://www.youtube.com/*'});")
 panel.goto(f'chrome-extension://{eid}/panel/index.html');expect(panel.locator('.sentence')).to_have_count(20)
 tid=worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.youtube.com/*"}))[0].id')
 def command(**data):
  result=panel.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':'PLAYER_COMMAND','tabId':tid,'command':{'videoKey':'youtube:fixture:1',**data}});assert result['ok'],result;return result.get('data')
 command(action='seek',time=10);command(action='pause');page.wait_for_timeout(250)
 # No seek on the first tap of a double press, and no native duplicate.
 page.keyboard.press('ArrowLeft');assert abs(command(action='state')['time']-10)<.05
 page.wait_for_timeout(300);page.keyboard.press('ArrowLeft');expect(panel.locator('#replay')).to_have_text('↺ 复听 2 句')
 assert command(action='state')['paused'] and abs(command(action='state')['time']-10)<.05
 panel.wait_for_timeout(100);stable_scroll=panel.evaluate('scrollY')
 page.keyboard.press('ArrowRight');page.keyboard.press('ArrowRight');expect(panel.locator('#replay')).to_have_text('↺ 复听 3 句')
 assert panel.locator('.replay-selected').evaluate_all('rows=>rows.map(r=>r.querySelector("time")?.textContent||r.querySelector(".timestamp").textContent)')==['00:08','00:10','00:12']
 page.keyboard.press('ArrowLeft');page.keyboard.press('ArrowLeft');expect(panel.locator('#replay')).to_have_text('↺ 复听 4 句')
 page.keyboard.press('ArrowRight');page.keyboard.press('ArrowRight');expect(panel.locator('#replay')).to_have_text('↺ 复听 5 句')
 assert panel.locator('.replay-selected .timestamp').all_text_contents()==['00:06','00:08','00:10','00:12','00:14']
 panel.wait_for_timeout(100);assert abs(panel.evaluate('scrollY')-stable_scroll)<2
 page.keyboard.press('Space');page.wait_for_timeout(250);assert page.evaluate('window.nativeSpaceCount||0')==0, 'Native Space keyup also handled the extension replay key';assert not command(action='state')['paused']
 page.wait_for_timeout(300);before_exit=command(action='state')['time']
 page.keyboard.press('Space');page.wait_for_timeout(200);state=command(action='state')
 assert not state['session'] and not state['paused'] and state['time']>=before_exit,state
 assert page.evaluate('window.nativeSpaceCount||0')==0
 # Select five again and replay three complete passes via Space while a footer
 # arrow retains focus. Native button activation must not add a sixth sentence.
 command(action='pause');command(action='seek',time=10);page.wait_for_timeout(250)
 for key in ['ArrowLeft','ArrowRight','ArrowLeft','ArrowRight']:
  page.keyboard.press(key);page.keyboard.press(key)
 expect(panel.locator('#replay')).to_have_text('↺ 复听 5 句')
 panel.locator('#loop').click();expect(panel.locator('#loop')).to_have_text('听 3 次');command(action='rate',rate=4)
 page.evaluate('()=>{window.replayStarts=0;const v=document.querySelector("video");v.addEventListener("seeked",()=>{if(Math.abs(v.currentTime-6)<.5)window.replayStarts++});}')
 panel.locator('#next').press('Space');page.wait_for_timeout(300)
 assert command(action='state')['session'] and not command(action='state')['paused']
 expect(panel.locator('#replay')).to_have_text('↺ 复听 5 句')
 page.wait_for_function('document.querySelector("video").paused&&document.querySelector("video").currentTime>15',timeout=15000)
 assert page.evaluate('window.replayStarts')==3
 finished=command(action='state');assert not finished['session'] and 15.9<finished['time']<16
 panel.locator('#loop').click();panel.locator('#loop').click();command(action='rate',rate=1)
 # Ordinary page Space is left to the native player, no forced replay.
 command(action='pause');command(action='seek',time=10);page.wait_for_timeout(200)
 page.keyboard.press('ArrowRight');page.wait_for_timeout(600)
 assert abs(command(action='state')['time']-15)<.05
 expect(panel.locator('#replay')).to_have_text('↺ 复听 1 句')
 page.locator('#search').fill('ab');page.locator('#search').press('ArrowLeft');page.locator('#search').press('ArrowLeft');page.wait_for_timeout(350)
 assert abs(command(action='state')['time']-15)<.05
 # Two taps 400 ms apart must remain two single seeks, not expand.
 page.locator('body').focus();command(action='seek',time=10)
 page.keyboard.press('ArrowRight');page.wait_for_timeout(400);page.keyboard.press('ArrowRight');page.wait_for_timeout(400)
 assert abs(command(action='state')['time']-20)<.05
 expect(panel.locator('#replay')).to_have_text('↺ 复听 1 句')
 command(action='seek',time=15)
 # Disabling the bridge restores the native single press immediately.
 panel.locator('[data-tab=study]').click();page.locator('body').focus();command(action='keyboard',keyboardEnabled=False)
 page.keyboard.press('ArrowLeft');assert abs(command(action='state')['time']-10)<.05
 # Hot reload then immediate bind must survive the first periodic player tick.
 panel.locator('[data-tab=transcript]').click();command(action='pause');command(action='seek',time=10)
 worker.evaluate('async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>window.__cueMindCleanup()})',tid)
 worker.evaluate('async id=>await chrome.scripting.executeScript({target:{tabId:id},files:["content/player.js"]})',tid)
 command(action='bind',sentences=[{'id':'k'+str(i),'start':i*2,'end':i*2+2} for i in range(20)],keyboardEnabled=True,replayArmed=False)
 page.wait_for_timeout(300);page.locator('body').focus()
 page.keyboard.press('ArrowLeft');page.keyboard.press('ArrowLeft');expect(panel.locator('#replay')).to_have_text('↺ 复听 2 句')
 assert abs(command(action='state')['time']-10)<.05
 ctx.close()
print('Replay keyboard passed: actual background bridge, double tap no seek, contiguous 2/3/4/5 cues and reload, video Space replay/exit, single seek, input and disabled-bridge protection.')
