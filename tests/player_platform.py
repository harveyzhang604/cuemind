from playwright.sync_api import sync_playwright
from pathlib import Path
import tempfile,json,base64,io,wave
from browser_support import chromium_options
ROOT=Path(__file__).resolve().parents[1]
CHROME=Path.home()/'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
buf=io.BytesIO()
with wave.open(buf,'wb') as f:
 f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b'\0\0'*8000*12)
audio=base64.b64encode(buf.getvalue()).decode()
with sync_playwright() as p:
 with tempfile.TemporaryDirectory(prefix='cuemind-player-') as profile:
  ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension','--autoplay-policy=no-user-gesture-required'])
  worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
  page=ctx.new_page()
  response={'videoDetails':{'videoId':'fixture','title':'Native captions fixture','author':'CueMind','lengthSeconds':'12'},'microformat':{'playerMicroformatRenderer':{'defaultAudioLanguage':'en'}},'captions':{'playerCaptionsTracklistRenderer':{'captionTracks':[{'languageCode':'fr','name':{'simpleText':'French'},'baseUrl':'https://www.youtube.com/api/timedtext?v=fixture&lang=fr'},{'languageCode':'en','kind':'asr','name':{'simpleText':'English (auto-generated)'},'baseUrl':'https://www.youtube.com/api/timedtext?v=fixture&lang=en'}]}}}
  html=f'<html><body><video controls src="data:audio/wav;base64,{audio}"></video><script>window.ytInitialPlayerResponse={json.dumps(response)}</script></body></html>'
  caption_state={'empty':True,'requests':0}
  def youtube(route):
   if '/api/timedtext' in route.request.url:
    caption_state['requests']+=1
    if caption_state['empty']:route.fulfill(body='',content_type='application/json')
    else:route.fulfill(json={'events':[{'tStartMs':0,'dDurationMs':2000,'segs':[{'utf8':'Hello world.'}]},{'tStartMs':3000,'dDurationMs':2000,'segs':[{'utf8':'A second sentence.'}]}]})
   else:route.fulfill(body=html,content_type='text/html')
  ctx.route('https://www.youtube.com/**',youtube)
  page.goto('https://www.youtube.com/watch?v=fixture');page.wait_for_function('document.querySelector("video").readyState >= 2')
  panel=ctx.new_page();panel.goto(f'chrome-extension://{eid}/panel/index.html');panel.wait_for_load_state('networkidle')
  tid=worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.youtube.com/*"}))[0].id')
  def rpc(kind,**data):return panel.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':kind,**data})
  empty=rpc('LOAD',tabId=tid,trackId='auto');assert empty['ok'] and empty['data']['needASR'],empty
  caption_state['empty']=False
  loaded=rpc('LOAD',tabId=tid,trackId='auto');assert loaded['ok'],loaded
  record=loaded['data']['record'];assert len(record['sentences'])==2
  assert record['transcriptMeta']['language']=='en' and record['transcriptMeta']['isAi'] is True
  assert record['sentences'][1]['start']==3
  # Page scripts cannot read settings or keys through content-script messages.
  denied=worker.evaluate('async tabId=>(await chrome.scripting.executeScript({target:{tabId},world:"ISOLATED",func:()=>chrome.runtime.sendMessage({type:"GET_SETTINGS"})}))[0].result',tid)
  assert not denied['ok'] and '仅允许' in denied['error'],denied
  requests=caption_state['requests'];assert rpc('LOAD',tabId=tid)['ok'];assert caption_state['requests']==requests
  chosen=rpc('LOAD',tabId=tid,trackId='0');assert chosen['ok'] and chosen['data']['record']['transcriptMeta']['language']=='fr'
  reopened=rpc('LOAD',tabId=tid);assert reopened['data']['record']['id']==chosen['data']['record']['id']
  assert reopened['data']['record']['transcriptMeta']['selectedByUser'] is True
  assert rpc('LOAD',tabId=tid,trackId='1')['data']['record']['id']==record['id']
  def command(**kw):
   result=rpc('PLAYER_COMMAND',tabId=tid,command={'videoKey':record['videoKey'],**kw});assert result['ok'],result;return result.get('data')
  panel.evaluate("window.playbackEvents=[];chrome.runtime.onMessage.addListener(m=>{if(m.event==='PLAYER_TICK'&&m.playbackEvent)playbackEvents.push({event:m.playbackEvent,paused:m.paused,tabId:m.tabId});});")
  page.bring_to_front()
  command(action='play')
  panel.wait_for_function("playbackEvents.some(m=>m.event==='play'&&m.paused===false)")
  command(action='pause')
  panel.wait_for_function("playbackEvents.some(m=>m.event==='pause'&&m.paused===true)")
  assert panel.evaluate('(id)=>playbackEvents.every(m=>m.tabId===id)',tid)
  # Exit a live looping range without rewinding, then toggle ordinary playback.
  command(action='range',start=1,end=3,repeat=-1,pre=0,post=0)
  page.wait_for_function('document.querySelector("video").currentTime>1.2')
  before_exit=command(action='state')['time']
  command(action='play');state=command(action='state')
  assert not state['session'] and not state['paused'] and state['time']>=before_exit,state
  command(action='toggle');assert command(action='state')['paused']
  command(action='toggle');state=command(action='state');assert not state['session'] and not state['paused']
  command(action='pause')
  command(action='range',start=0.5,end=1.0,pre=0,post=0)
  page.wait_for_function('document.querySelector("video").paused && document.querySelector("video").currentTime >= 1',timeout=6000)
  t=page.locator('video').evaluate('(v)=>v.currentTime');assert 1<=t<1.25,t
  # Strict selected-cue replay excludes the next cue at 1.0, even with buffers configured.
  page.evaluate('''()=>{const v=document.querySelector('video');window.strictSamples=[];window.strictStarts=0;
   window.strictSeeking=()=>{if(v.currentTime<.58)strictStarts++;};v.addEventListener('seeked',window.strictSeeking);
   window.strictMonitor=setInterval(()=>{if(!v.paused&&!v.seeking)strictSamples.push(v.currentTime);},2);}''')
  command(action='range',start=.5,end=1,repeat=3,strict=True,pre=.25,post=.25)
  page.wait_for_function('document.querySelector("video").paused && document.querySelector("video").currentTime>.9',timeout=6000)
  strict=page.evaluate('''()=>{clearInterval(strictMonitor);document.querySelector('video').removeEventListener('seeked',strictSeeking);return {starts:strictStarts,max:Math.max(...strictSamples),end:document.querySelector('video').currentTime};}''')
  assert strict['starts']==3 and strict['max']<1 and .9<strict['end']<1,strict
  command(action='range',start=0.5,end=0.8,repeat=3,pre=0,post=0)
  page.wait_for_function('document.querySelector("video").paused && document.querySelector("video").currentTime >= .8',timeout=6000)
  command(action='range',start=0.5,end=1,repeat=-1,pre=0,post=0)
  command(action='range',start=3,end=3.4,pre=0,post=0)
  page.wait_for_function('document.querySelector("video").paused && document.querySelector("video").currentTime >= 3.4',timeout=6000)
  assert page.locator('video').evaluate('(v)=>v.currentTime')<3.65
  wrong=rpc('PLAYER_COMMAND',tabId=tid,command={'action':'range','videoKey':'youtube:other:1','start':0,'end':1});assert not wrong['ok']
  command(action='bind',sentences=record['sentences'],paragraphs=record['paragraphs'])
  page.keyboard.press('Alt+k');page.wait_for_function('!document.querySelector("video").paused')
  command(action='stop');assert page.locator('video').evaluate('(v)=>v.paused')
  # The boundary must already be armed while play()'s promise is still pending.
  worker.evaluate('''async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{
    window.fixtureOriginalPlay=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){return window.fixtureOriginalPlay.call(this).then(()=>new Promise(resolve=>{window.fixtureResolvePlay=resolve;}));};
  }})''',tid)
  panel.evaluate('(m)=>{window.pendingShortReplay=chrome.runtime.sendMessage(m);}',{'type':'PLAYER_COMMAND','tabId':tid,'command':{'action':'range','videoKey':record['videoKey'],'start':.5,'end':.8,'pre':0,'post':0}})
  page.wait_for_function('document.querySelector("video").paused && document.querySelector("video").currentTime>=.8',timeout=3000)
  assert page.locator('video').evaluate('(v)=>v.currentTime')<1.05
  worker.evaluate('''async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{window.fixtureResolvePlay();HTMLMediaElement.prototype.play=window.fixtureOriginalPlay;}})''',tid)
  assert panel.evaluate('()=>window.pendingShortReplay')['ok']
  # Stop while play() is pending is a normal cancellation, not a failed exercise.
  worker.evaluate('''async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{
    window.fixtureOriginalPlay=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){return new Promise((resolve,reject)=>{window.fixtureRejectPlay=reject;});};
  }})''',tid)
  panel.evaluate('(m)=>{window.pendingReplay=chrome.runtime.sendMessage(m);}',{'type':'PLAYER_COMMAND','tabId':tid,'command':{'action':'range','videoKey':record['videoKey'],'start':.5,'end':1}})
  assert worker.evaluate('''async id=>{for(let i=0;i<100;i++){const result=(await chrome.scripting.executeScript({target:{tabId:id},func:()=>typeof window.fixtureRejectPlay==='function'}))[0].result;if(result)return true;await new Promise(resolve=>setTimeout(resolve,20));}return false}''',tid)
  command(action='stop')
  worker.evaluate('''async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>window.fixtureRejectPlay(new DOMException('Playback cancelled','AbortError'))})''',tid)
  assert panel.evaluate('()=>window.pendingReplay')['ok']
  worker.evaluate('''async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{
    HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Playback blocked','NotAllowedError'));
  }})''',tid)
  failed=rpc('PLAYER_COMMAND',tabId=tid,command={'action':'range','videoKey':record['videoKey'],'start':.5,'end':1})
  assert not failed['ok'] and 'Playback blocked' in failed['error']
  worker.evaluate('''async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{HTMLMediaElement.prototype.play=window.fixtureOriginalPlay;}})''',tid)
  command(action='play');page.keyboard.press('Escape');assert page.locator('video').evaluate('(v)=>v.paused')
  page.evaluate('history.replaceState(null,"","#comments")')
  page.wait_for_timeout(250)
  page.keyboard.press('Alt+k');page.wait_for_function('!document.querySelector("video").paused')
  command(action='stop')
  panel.bring_to_front()
  command(action='range',start=0.5,end=1.2,pre=0,post=0)
  page.wait_for_function('document.querySelector("video").paused && document.querySelector("video").currentTime >= 1.2',timeout=6000)
  assert page.locator('video').evaluate('(v)=>v.currentTime')<1.55
  # Real browser MediaRecorder / WebAudio, synthetic audio and mocked ASR only.
  recorder=ctx.new_page()
  recorder.add_init_script('''
    window.asrRequests=0;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const audio=new AudioContext(),source=audio.createOscillator(),dest=audio.createMediaStreamDestination();
      source.connect(dest);source.start();await audio.resume();window.fixtureAudio=audio;return dest.stream;
    }});
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>{
      if(String(url).endsWith('/audio/transcriptions')){
        window.asrRequests++;return new Response(JSON.stringify({segments:[{start:0,end:.5,text:'Synthetic recording.'}]}));
      }return originalFetch(url,options);
    };
  ''')
  recorder.goto(f'chrome-extension://{eid}/offscreen/index.html');recorder.wait_for_load_state('networkidle')
  worker.evaluate('()=>{chrome.tabCapture.getMediaStreamId=async()=>"fixture";chrome.offscreen.hasDocument=async()=>true;}')
  config=rpc('GET_SETTINGS')['data'];config['asrKey']='SYNTHETIC-TEST-ONLY';assert rpc('SAVE_SETTINGS',settings=config)['ok']
  command(action='seek',time=2);command(action='rate',rate=1.5)
  page.wait_for_function('!document.querySelector("video").seeking')
  started=rpc('CAPTURE_START',recordId=record['id'],tabId=tid);assert started['ok'],started
  capture_id=started['data']['id'];assert rpc('CAPTURE_STATUS')['data']['recordId']==capture_id
  assert not rpc('TASK',recordId=capture_id,capability='translation')['ok']
  assert not rpc('PLAYER_COMMAND',tabId=tid,command={'action':'seek','time':6})['ok']
  page.wait_for_timeout(1400)
  assert rpc('CAPTURE_STOP')['ok']
  panel.wait_for_function('async()=>!(await chrome.runtime.sendMessage({type:"CAPTURE_STATUS"})).data',timeout=15000)
  captured=rpc('GET_RECORD',recordId=capture_id)['data']
  assert len(captured['rawCaptions'])==1,captured
  assert 2<=captured['rawCaptions'][0]['start']<2.5,captured
  assert recorder.evaluate('window.asrRequests')==1
  assert command(action='state')['rate']==1.5
  page.evaluate('document.querySelector("video").insertAdjacentHTML("afterend",\'<div id="movie_player" class="ad-showing"></div>\')')
  assert command(action='state')['isAd']
  ad=rpc('PLAYER_COMMAND',tabId=tid,command={'action':'range','start':0,'end':1})
  assert not ad['ok'] and '广告' in ad['error'],ad
  page.evaluate('document.querySelector("#movie_player").remove()')
  # Disposed content scripts must not reattach tools or duplicate shortcuts.
  page.evaluate('document.body.insertAdjacentHTML("beforeend",\'<div id="movie_player"></div>\')')
  worker.evaluate('async tabId=>await chrome.scripting.executeScript({target:{tabId},func:()=>window.__cueMindCleanup()})',tid)
  page.wait_for_timeout(1200)
  assert page.locator('#cuemind-tools').count()==0
  for _ in range(2):worker.evaluate('async tabId=>await chrome.scripting.executeScript({target:{tabId},files:["content/player.js"]})',tid)
  page.wait_for_timeout(1200)
  assert page.locator('#cuemind-tools').count()==1
  recorder.evaluate('()=>window.fixtureAudio.close()');recorder.close()
  print('Player/platform fixture passed: native captions, time ranges, 3x loop, session replacement, wrong-video rejection, keyboard and stop.')
  ctx.close()
