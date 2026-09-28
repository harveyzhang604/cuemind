"""User flows for the simplified subtitle page, using platform/model fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
 browser=p.chromium.launch(headless=True,**chromium_options())
 page=browser.new_page(viewport={'width':430,'height':850});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.calls=[];window.listeners=[];window.clock=150;window.playerPaused=true;window.playerSession=false;window.chrome={runtime:{id:'fixture',getURL:p=>p,onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{
 calls.push(m);
 if(window.failAd&&m.type==='PLAYER_COMMAND'&&m.command.action==='pause')return {ok:false,error:'正在播放广告，请跳过或等广告结束后再操作。'};
 if(m.type==='LOAD'){
  const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoKey='youtube:fixture:1';r.videoInfo={...r.videoInfo,platform:'youtube',duration:840,audioLanguage:'en'};
  r.sentences=Array.from({length:280},(_,i)=>({id:'s'+i,start:i*3,end:i*3+3,rawText:'Sentence '+i+' about learning English.',sourceIds:['raw'+i]}));
  r.sentences[52].end=162; // Native caption overlaps the following cue starting at 159.
  r.paragraphs=Array.from({length:70},(_,i)=>({id:'p'+i,start:i*12,end:i*12+12,sentenceIds:Array.from({length:4},(_,j)=>'s'+(i*4+j))}));
  r.transcriptMeta={source:'youtube_native',language:'en',trackId:'0',isAi:false};window.fixtureRecord=r;
  return {ok:true,data:{record:r,tracks:[{id:'0',language:'en',label:'English',isAi:false},{id:'1',language:'fr',label:'French',isAi:false}]}};
 }
 if(m.type==='QUICK_NOTE')return {ok:true,data:{warning:'已记录当前句'}};
 if(m.type==='PLAYER_COMMAND'&&m.command.action==='state')return {ok:true,data:{videoKey:'youtube:fixture:1',time:clock,paused:playerPaused,isAd:!!window.failAd,rate:1,session:playerSession}};
 if(m.type==='PLAYER_COMMAND'){const a=m.command.action;if(a==='range'){playerSession=true;playerPaused=false;}if(a==='pause'||a==='stop'){playerSession=false;playerPaused=true;}if(a==='play'){playerSession=false;playerPaused=false;}if(a==='toggle'){playerSession=false;playerPaused=!playerPaused;}}
 if(m.type==='TASK'&&m.capability==='translation'){fixtureRecord.sentences.forEach((s,i)=>s.translation='中文 '+i);return {ok:true,data:{record:fixtureRecord}};}
 return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'FIXTURE'}:null};
 }},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
 page.goto(base+'/extension/panel/index.html');page.locator('.sentence.active').wait_for();page.wait_for_timeout(400)
 assert not page.locator('#source').is_visible()
 for action,label in [('copy-transcript','复制'),('export','导出'),('refresh','读取')]:
  expect(page.locator('#'+action)).to_be_visible();expect(page.locator('#'+action)).to_have_text(label)
 assert page.locator('.transcript-menu #export,.transcript-menu #refresh,.transcript-menu #copy-transcript').count()==0
 assert not page.locator('#open-replay').is_visible();
 page.locator('.transcript-more>summary').click()
 assert page.locator('#open-replay').evaluate('e=>getComputedStyle(e).fontSize')==page.locator('#subtitle-settings').evaluate('e=>getComputedStyle(e).fontSize')
 assert page.locator('#open-replay').evaluate('e=>getComputedStyle(e).borderLeftWidth')=='0px'
 page.locator('.transcript-more>summary').click();assert page.locator('#boundary').count()==0
 assert page.locator('#export-transcript').count()==0;assert not page.locator('#stop').is_visible()
 assert not page.locator('#translation-needed').is_visible()
 page.keyboard.press('n');page.wait_for_function("calls.some(m=>m.type==='QUICK_NOTE')")
 assert not page.evaluate("calls.some(m=>m.type==='TASK')")
 for width in [320,380,430,700]:
  page.set_viewport_size({'width':width,'height':850})
  assert page.locator('.transcript-toolbar').bounding_box()['height']<85
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  for action in ['copy-transcript','export','refresh']:
   box=page.locator('#'+action).bounding_box();assert box['x']>=0 and box['x']+box['width']<=width,(width,action,box)
 page.set_viewport_size({'width':430,'height':850})
 page.context.grant_permissions(['clipboard-read','clipboard-write'])
 page.locator('#copy-transcript').click()
 assert 'Sentence 0 about learning English.' in page.evaluate('navigator.clipboard.readText()')
 loads=page.evaluate("calls.filter(m=>m.type==='LOAD').length")
 page.locator('#refresh').click()
 page.wait_for_function("n=>calls.filter(m=>m.type==='LOAD').length>n",arg=loads)
 def tool(name):
  page.locator('.transcript-more>summary').click();page.locator(name).click()
 tool('#subtitle-settings');expect(page.locator('#subtitle-settings-dialog')).to_be_visible()
 expect(page.locator('#source')).to_contain_text('平台人工字幕 · en');expect(page.locator('#tracks')).to_have_value('0')
 page.evaluate('window.scrollTo(0,0)');page.locator('#subtitle-settings-dialog .close').click();page.wait_for_timeout(100)
 current_box=page.locator('.sentence.active').bounding_box();assert current_box['y']>0 and current_box['y']+current_box['height']<page.locator('footer').bounding_box()['y']
 tool('#subtitle-settings');page.locator('#open-focus-settings').click();expect(page.locator('#subtitle-settings-dialog')).to_be_hidden();expect(page.locator('#focus-dialog')).to_be_visible();page.locator('#focus-close').click()
 tool('#open-import');expect(page.locator('#import-dialog')).to_be_visible()
 assert page.locator('#import-dialog #restore').count()==1
 page.locator('#import-dialog .close').click()
 page.locator('#export').click();expect(page.locator('#export-dialog')).to_be_visible()
 assert page.locator('#export-dialog #restore,#export-dialog #show-asr,#export-dialog #import-existing').count()==0
 for kind in ['txt','srt','md']:
  with page.expect_download() as result:page.locator('[data-export='+kind+']').click()
  assert result.value.path()
 page.locator('#export-dialog .close').click()
 page.locator('#transcript-mode').select_option('bilingual')
 page.wait_for_function("calls.some(m=>m.type==='TASK'&&m.capability==='translation')")
 expect(page.locator('#translation-needed')).to_be_hidden()
 expect(page.locator('.translation').first).to_contain_text('中文')
 assert page.evaluate("calls.filter(m=>m.type==='TASK'&&m.capability==='translation').length")==1
 assert page.evaluate("calls.find(m=>m.type==='TASK'&&m.capability==='translation').args.selectedIds===undefined")
 page.locator('#loop').click();expect(page.locator('#loop')).to_have_text('听 3 次')
 page.locator('#loop').click();expect(page.locator('#loop')).to_have_text('循环')
 page.locator('#loop').click();expect(page.locator('#loop')).to_have_text('听 1 次')
 assert page.locator('#replay-scope').count()==0
 page.keyboard.press('ArrowLeft');page.wait_for_function("calls.some(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='seek'&&m.command.time===145)")
 expect(page.locator('#replay')).to_have_text('↺ 复听 1 句')
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_SHORTCUT',tabId:99,videoKey:'youtube:fixture:1',action:'expand',direction:-1}))")
 expect(page.locator('#replay')).to_have_text('↺ 复听 1 句')
 before=page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').length")
 page.locator('#previous').click();expect(page.locator('#replay')).to_have_text('↺ 复听 2 句')
 page.wait_for_timeout(100)
 anchor=page.locator('.sentence[data-id="s50"]')
 center=anchor.evaluate('(e)=>{const b=e.getBoundingClientRect(),t=document.querySelector(".tabs").getBoundingClientRect().bottom,f=document.querySelector("footer").getBoundingClientRect().top;return {actual:b.y+b.height/2,target:(t+f)/2};}')
 assert abs(center['actual']-center['target'])<2,center
 stable_scroll=page.evaluate('scrollY')
 page.keyboard.press('ArrowLeft');page.wait_for_timeout(300);page.keyboard.press('ArrowLeft');expect(page.locator('#replay')).to_have_text('↺ 复听 3 句')
 page.locator('#next').click();expect(page.locator('#replay')).to_have_text('↺ 复听 4 句')
 page.keyboard.press('ArrowRight');page.keyboard.press('ArrowRight')
 expect(page.locator('#replay')).to_have_text('↺ 复听 5 句');expect(page.locator('#replay')).to_have_text('↺ 复听 5 句')
 expect(page.locator('.sentence.replay-selected')).to_have_count(5)
 page.wait_for_timeout(100);assert abs(page.evaluate('scrollY')-stable_scroll)<2
 # Expanding past the rendered page must not replace the reading window or move it.
 for _ in range(20):page.locator('#next').click()
 expect(page.locator('#replay')).to_have_text('↺ 复听 25 句')
 assert abs(page.evaluate('scrollY')-stable_scroll)<2
 assert page.locator('.sentence[data-id="s50"]').count()==1
 page.locator('[data-id="s50"] .sentence-body').click()
 for id in ['previous','previous','next','next']:page.locator('#'+id).click()
 expect(page.locator('#replay')).to_have_text('↺ 复听 5 句')
 page.set_viewport_size({'width':320,'height':850});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.set_viewport_size({'width':430,'height':850})
 expect(page.locator('#replay-range-hint')).to_contain_text('02:24–02:39')
 assert page.locator('#replay').inner_text()=='↺ 复听 5 句'
 assert page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').length")==before
 assert page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='pause').length")>=4
 assert page.locator('.sentence.replay-selected').evaluate_all("rows=>rows.map(r=>r.dataset.id)")==['s48','s49','s50','s51','s52']
 page.keyboard.press('Space');expect(page.locator('#stop')).to_be_visible()
 command=page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').at(-1).command")
 assert (command['start'],command['end'],command['repeat'])==(144,159,1),command
 page.locator('#loop').click();page.locator('#replay').click()
 command=page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').at(-1).command")
 assert (command['start'],command['end'],command['repeat'])==(144,159,3),command
 assert command['strict'] and command['pre']==0 and command['post']==0,command
 # Live playback moves through the selected range without shifting its boundaries.
 range_scroll=page.evaluate('scrollY')
 page.evaluate("clock=156;listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:156,paused:false,rate:1,session:true,repeat:3}))")
 expect(page.locator('.sentence.active')).to_have_attribute('data-id','s52')
 expect(page.locator('#replay')).to_have_text('↺ 复听 5 句')
 page.wait_for_timeout(100);assert abs(page.evaluate('scrollY')-range_scroll)<2
 # A fully visible five-cue replay stays still even when looping to the first cue.
 for t in [144,147,150,153,156,144,156]:
  page.evaluate("t=>{clock=t;listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:t,paused:false,rate:1,session:true,repeat:3}));}",t)
  page.wait_for_timeout(60);assert abs(page.evaluate('scrollY')-range_scroll)<2,t
 replays=page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').length")
 page.keyboard.press('Space');expect(page.locator('#stop')).to_be_hidden()
 page.wait_for_function("calls.filter(m=>m.type==='PLAYER_COMMAND').at(-1).command.action==='play'")
 assert page.evaluate("clock===156&&!playerPaused&&!playerSession")
 page.keyboard.press('Space');page.wait_for_function("playerPaused")
 page.keyboard.press('Space');page.wait_for_function("!playerPaused")
 assert page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').length")==replays
 expect(page.locator('.sentence.replay-selected')).to_have_count(0)
 # Native normal playback discards the old range and follows its own current cue.
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:156,paused:false,rate:1,session:false,playbackEvent:'play'}))")
 expect(page.locator('#replay')).to_have_text('↺ 复听 1 句');expect(page.locator('.sentence.replay-selected')).to_have_count(0)
 page.locator('#previous').click();expect(page.locator('#replay')).to_have_text('↺ 复听 2 句')
 page.locator('#next').click();expect(page.locator('#replay')).to_have_text('↺ 复听 3 句')
 assert page.locator('.sentence.replay-selected').evaluate_all("rows=>rows.map(r=>r.dataset.id)")==['s51','s52','s53']
 page.locator('.sentence.active .sentence-body').click();expect(page.locator('#replay')).to_have_text('↺ 复听 1 句')
 page.locator('[data-id="s50"] .sentence-body').click();expect(page.locator('#replay')).to_have_text('↺ 复听 1 句')
 page.locator('#toggle-search').click();page.locator('#search').fill('Sentence')
 before=page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').length")
 page.locator('#search').press('Space');assert page.evaluate("calls.filter(m=>m.type==='PLAYER_COMMAND'&&m.command.action==='range').length")==before
 page.locator('#close-search').click()
 page.locator('.sentence').last.scroll_into_view_if_needed();page.mouse.wheel(0,80)
 expect(page.locator('#first-subtitle')).to_be_visible()
 page.wait_for_timeout(700)
 assert page.locator('.transcript-menu #first-subtitle').count()==0
 page.locator('#first-subtitle').click();expect(page.locator('.sentence').first).to_have_attribute('data-id','s0')
 page.wait_for_timeout(300)
 page.wait_for_function('scrollY===0')
 assert page.locator('.video-head').bounding_box()['y']>=0,page.evaluate('({scrollY,head:document.querySelector(".video-head").getBoundingClientRect().y,follow:document.querySelector("#transcript").dataset.followPlayback})')
 assert page.locator('.transcript-toolbar').bounding_box()['y']>0
 assert page.evaluate('clock')==156
 page.locator('[data-id="s0"] .sentence-body').click();expect(page.locator('#previous')).to_be_disabled()
 page.keyboard.press('ArrowLeft');page.keyboard.press('ArrowLeft');expect(page.locator('#replay')).to_have_text('↺ 复听 1 句')
 page.locator('.sentence.active .sentence-body').click()
 assert page.locator('.transcript-page-nav').count()==0;expect(page.locator('#more')).to_be_hidden()
 for expected in [140,210]:
  page.locator('.sentence').last.scroll_into_view_if_needed();page.mouse.wheel(0,800)
  expect(page.locator('.sentence')).to_have_count(expected)
 page.locator('.sentence').last.scroll_into_view_if_needed();page.mouse.wheel(0,800)
 expect(page.locator('.sentence').first).to_have_attribute('data-id','s70');expect(page.locator('.sentence')).to_have_count(210)
 page.locator('.sentence').first.scroll_into_view_if_needed();page.mouse.wheel(0,-800)
 expect(page.locator('.sentence').first).to_have_attribute('data-id','s0');expect(page.locator('.sentence')).to_have_count(210)
 # The contextual locate button restores following even from the same paused sentence.
 page.locator('.sentence').last.scroll_into_view_if_needed();page.mouse.wheel(0,80)
 expect(page.locator('#locate')).to_be_visible();page.locator('#locate').click()
 expect(page.locator('#transcript')).to_have_attribute('data-follow-playback','true');expect(page.locator('#locate')).to_be_hidden()
 expect(page.locator('.sentence.active')).to_have_attribute('data-id','s52')
 assert not errors,errors
 page.wait_for_timeout(700)
 box=page.locator('.sentence.active').bounding_box();assert box['y']>=0 and box['y']+box['height']<page.locator('footer').bounding_box()['y'],(box,page.locator('footer').bounding_box(),page.evaluate('({scrollY,follow:document.querySelector("#transcript").dataset.followPlayback,active:document.querySelector(".sentence.active").dataset.id})'))
 page.screenshot(path='/tmp/cuemind-compact-v2.png')
 page.evaluate("window.failAd=true")
 page.locator('#next').click();expect(page.locator('#status')).to_be_visible()
 expect(page.locator('#status')).to_be_hidden(timeout=4000)
 page.locator('#next').click();expect(page.locator('#status')).to_be_visible()
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:156,paused:true,isAd:false,rate:1,session:false}))")
 expect(page.locator('#status')).to_be_hidden()
 browser.close()
print('Compact workflow passed: tools, source, import/export separation, explicit translation, replay controls, bounded bidirectional loading, locate and four widths.')
