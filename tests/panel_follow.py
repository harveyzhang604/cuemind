from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
with preview_server() as base,sync_playwright() as p:
 b=p.chromium.launch(headless=True,**chromium_options());page=b.new_page(viewport={'width':430,'height':700});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.clock=450;window.playerPaused=false;window.listeners=[];window.chrome={runtime:{id:'fixture',getURL:p=>p,onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoKey='youtube:fixture:1';r.videoInfo.platform='youtube';r.sentences=Array.from({length:200},(_,i)=>({id:'s'+i,start:i*3,end:i*3+3,rawText:'Sentence '+i,sourceIds:[]}));return {ok:true,data:{record:r,tracks:[]}};}if(m.type==='PLAYER_COMMAND'&&m.command.action==='state'){const result={ok:true,data:{videoKey:'youtube:fixture:1',time:clock,paused:playerPaused,rate:1}};if(window.holdState)return new Promise(resolve=>window.releaseState=()=>resolve(result));return result;}return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:{}};}},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
 page.goto(base+'/extension/panel/index.html')
 expect(page.locator('#play-time')).to_have_text('07:30');expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 150')
 # Automatic playback holds visible sentences still and advances one page at the edge.
 def replay_tick(i):
  page.evaluate("i=>{clock=i*3;listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:clock,rangeStart:450,session:true,paused:false,rate:1}));}",i)
 replay_tick(150);page.wait_for_timeout(100)
 moves=0;stays=0
 for i in range(151,166):
  row=page.locator('.sentence[data-id="s'+str(i)+'"]')
  before=row.evaluate('(e)=>{const b=e.getBoundingClientRect(),top=document.querySelector(".tabs").getBoundingClientRect().bottom,bottom=document.querySelector("footer").getBoundingClientRect().top;return {visible:b.top>=top+4&&b.bottom<=bottom-Math.max(48,(bottom-top)*0.3),scroll:scrollY};}')
  replay_tick(i);page.wait_for_timeout(60)
  after=page.evaluate('scrollY')
  if before['visible']:
   assert abs(after-before['scroll'])<2,(i,before,after);stays+=1
  else:
   assert row.evaluate('(e)=>Math.abs(e.getBoundingClientRect().top-document.querySelector(".tabs").getBoundingClientRect().bottom-12)')<2; moves+=1
 assert stays>=10 and 1<=moves<=4,(stays,moves)
 # Loop restart moves once when the first sentence is above the viewport.
 replay_tick(150);page.wait_for_timeout(60)
 assert page.locator('.sentence[data-id="s150"]').evaluate('(e)=>Math.abs(e.getBoundingClientRect().top-document.querySelector(".tabs").getBoundingClientRect().bottom-12)')<2
 loop_scroll=page.evaluate('scrollY');replay_tick(151);page.wait_for_timeout(60)
 assert abs(page.evaluate('scrollY')-loop_scroll)<2
 # A paragraph replay's fixed starting point cannot pin the live subtitle there.
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:453,rangeStart:450,session:true,paused:false,rate:1}))")
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 151')
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:459,rangeStart:450,session:true,paused:false,rate:1}))")
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 153')
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:450,rangeStart:450,session:true,paused:false,rate:1}))")
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 150')
 # Opening the replay browser initializes at playback, without seeking or moving the reading layout.
 page.locator('.transcript-more>summary').click();page.locator('#open-replay').click()
 expect(page.locator('#replay-dialog')).to_be_visible()
 assert page.locator('#transcript .qa-replay-tools').count()==0
 page.locator('#replay-dialog').dispatch_event('wheel',{'deltaY':100})
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true')
 page.locator('.chapter-overview').first.click()
 preview=page.locator('.study-source').all_text_contents()
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:453,paused:false,rate:1}))")
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 151')
 assert page.locator('.study-source').all_text_contents()==preview
 page.locator('#close-replay').click()
 page.wait_for_timeout(700)
 box=page.locator('.sentence.active').bounding_box()
 assert box['y']>0 and box['y']+box['height']<page.locator('footer').bounding_box()['y']
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:450,paused:false,rate:1}))")
 # Scrolling settings is not manual browsing of the transcript.
 page.locator('#focus-settings').click()
 page.locator('#focus-dialog').dispatch_event('wheel',{'deltaY':100})
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true')
 page.locator('#focus-close').click()
 page.wait_for_timeout(700)
 box=page.locator('.sentence.active').bounding_box();assert box['y']>0 and box['y']+box['height']<page.locator('footer').bounding_box()['y']
 # No broadcast: fallback polling must catch a far-away seek and page the transcript.
 page.evaluate('clock=540')
 expect(page.locator('#play-time')).to_have_text('09:00',timeout=6000)
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 180')
 # Broadcast from another tab must never change this panel.
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:2,videoKey:'youtube:fixture:1',time:0}))")
 expect(page.locator('#play-time')).to_have_text('09:00')
 # With no cue on the timeline, neither a stale replay anchor nor the prior cue is highlighted.
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:601,rangeStart:450,session:true,paused:true,rate:1}))")
 expect(page.locator('.sentence.active')).to_have_count(0)
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:540,paused:false,rate:1}))")
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 180')
 # An ad clock must not move the transcript or the current question context.
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:5,isAd:true}))")
 expect(page.locator('#play-state')).to_have_text('广告播放中')
 expect(page.locator('#play-time')).to_have_text('09:00')
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 180')
 # Manual reading pauses following briefly, then live playback resumes it.
 page.mouse.wheel(0,-250)
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 page.wait_for_timeout(700)
 before=page.evaluate('scrollY')
 page.evaluate('clock=30')
 expect(page.locator('#play-time')).to_have_text('00:30',timeout=6000)
 after=page.evaluate('scrollY');assert abs(after-before)<5,{'before':before,'after':after}
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true',timeout=8000)
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 10')
 assert page.locator('.sentence.active').is_visible()
 # Browsing away while paused: resume must relocate even if the cue ID is unchanged.
 def tick(t,paused,**extra):
  page.evaluate("m=>listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',rate:1,...m}))",{'time':t,'paused':paused,**extra})
 def visible_current():
  page.wait_for_timeout(700)
  box=page.locator('.sentence.active').bounding_box()
  assert box and box['y']>page.locator('.tabs').bounding_box()['y']+page.locator('.tabs').bounding_box()['height'] and box['y']+box['height']<page.locator('footer').bounding_box()['y'],box
 page.evaluate('playerPaused=true');tick(30,True)
 page.mouse.wheel(0,900);expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 page.evaluate('playerPaused=false');tick(30,False)
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true');visible_current()
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 10')
 # A new manual scroll during ongoing playback stays put, including explicit time ticks.
 page.mouse.wheel(0,500);expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 page.wait_for_timeout(700);before=page.evaluate('scrollY')
 tick(33,False);page.wait_for_timeout(700)
 assert abs(page.evaluate('scrollY')-before)<5
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 # Missed pause snapshot: the native play event still restores follow.
 tick(33,False,playbackEvent='play');expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true');visible_current()
 # Browsing a different page of subtitles must not strand playback outside the rendered group.
 page.evaluate('clock=540;playerPaused=true');tick(540,True)
 page.locator('.sentence').first.scroll_into_view_if_needed();page.mouse.wheel(0,-400)
 expect(page.locator('#first-subtitle')).to_be_visible();page.locator('#first-subtitle').click()
 expect(page.locator('.sentence').first.locator('.sentence-body')).to_have_text('Sentence 0')
 # Already paused following: wait for the actual wheel event, not the preexisting false flag.
 page.evaluate("window.browseWheelSeen=false;window.addEventListener('wheel',()=>window.browseWheelSeen=true,{once:true})")
 page.mouse.wheel(0,400);page.wait_for_function('browseWheelSeen')
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 page.evaluate('clock=540;playerPaused=false');tick(540,False)
 expect(page.locator('.sentence.active .sentence-body')).to_have_text('Sentence 180');visible_current()
 # Resuming inside a modal restores following but leaves the modal's scroll/preview alone.
 page.evaluate('playerPaused=true');tick(540,True)
 page.mouse.wheel(0,-350)
 page.locator('.transcript-more>summary').click();page.locator('#open-replay').click();preview=page.locator('.study-source').all_text_contents()
 before=page.locator('#replay-dialog').bounding_box()
 page.evaluate('playerPaused=false');tick(540,False)
 assert page.locator('.study-source').all_text_contents()==preview
 assert page.locator('#replay-dialog').bounding_box()==before
 page.locator('#close-replay').click();visible_current()
 # Fallback polling also detects pause/resume when broadcasts are absent.
 page.evaluate('playerPaused=true')
 expect(page.locator('#play-state')).to_have_text('已暂停',timeout=6000)
 page.mouse.wheel(0,600);expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 before=page.evaluate('scrollY')
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:2,videoKey:'youtube:fixture:1',time:540,paused:false,playbackEvent:'play'}))")
 tick(5,False,isAd=True,playbackEvent='play')
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 page.wait_for_timeout(700);assert abs(page.evaluate('scrollY')-before)<5
 page.evaluate('playerPaused=false')
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true',timeout=6000);visible_current()
 # A late poll taken before play must not overwrite a newer native event.
 page.evaluate('playerPaused=true;holdState=true')
 page.wait_for_function('typeof releaseState==="function"',timeout=6000)
 page.evaluate('playerPaused=false');tick(540,False,playbackEvent='play')
 page.mouse.wheel(0,-400);expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 page.wait_for_timeout(700);before=page.evaluate('scrollY')
 page.evaluate('holdState=false;releaseState();delete window.releaseState')
 expect(page.locator('#play-state')).to_have_text('正在播放')
 tick(543,False);page.wait_for_timeout(700)
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','false')
 assert abs(page.evaluate('scrollY')-before)<5
 assert not errors,errors;b.close()
print('Playback follow passed: initial position, replay across sentences and loop restart, settings scroll/close, missing broadcasts, distant seek, ads, manual reading, same-cue resume, native play events, distant-page resume, modal protection, polling resume, stale-poll rejection and wrong-tab isolation.')
