"""First-use setup, playback states and continuous capture feedback in an isolated browser."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with preview_server() as base,sync_playwright() as p:
 b=p.chromium.launch(headless=True,**chromium_options());page=b.new_page(viewport={'width':430,'height':760});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.calls=[];window.listeners=[];window.opened=[];window.cfg={};window.fixture=null;window.chrome={runtime:{id:'fixture',getURL:p=>p,onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{calls.push(m);const ok=data=>({ok:true,data});if(m.type==='GET_SETTINGS')return ok(cfg);if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');fixture=demoRecord();fixture.id='fixture';fixture.videoKey='youtube:fixture:1';fixture.videoInfo.platform='youtube';fixture.sentences.forEach(s=>delete s.translation);return ok({record:fixture,tracks:[]});}if(m.type==='CAPTURE_STATUS')return ok(null);if(m.type==='NOTES'||m.type==='CHATS')return ok([]);if(m.type==='PLAYER_COMMAND'&&m.command.action==='state')return ok({time:10,paused:true,rate:1,videoKey:'youtube:fixture:1'});if(m.type==='CAPTURE_START'){fixture={...fixture,id:'capture',rawCaptions:[],sentences:[],paragraphs:[],transcriptMeta:{source:'whisper',asrSessionId:'session-1',asrSegments:[{id:'one',sessionId:'session-1',start:10,end:30,status:'pending'},{id:'two',sessionId:'session-1',start:30,end:90,status:'pending'},{id:'three',sessionId:'session-1',start:90,end:150,status:'pending'}]}};return ok(fixture);}if(m.type==='GET_RECORD')return ok(fixture);return ok({});}},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],create:m=>opened.push(m.url),onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:f=>window.settingsChanged=f}}};''')
 page.goto(base+'/extension/panel/index.html');expect(page.locator('.sentence')).not_to_have_count(0)
 expect(page.locator('#replay-range-hint')).to_contain_text('已暂停 · 空格播放')
 page.locator('#transcript-mode').select_option('bilingual');page.locator('#translate').click();expect(page.locator('#setup-needed')).to_be_visible();assert not page.evaluate('calls.some(m=>m.type==="TASK")')
 page.locator('#setup-needed-configure').click();assert page.evaluate('opened.at(-1)')=='panel/settings.html#text-service'
 page.locator('#next').click();expect(page.locator('#replay-range-hint')).to_contain_text('已选句');page.locator('#replay').click();page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:fixture:1',time:10,paused:false,session:true,rangeStart:7,rangeEnd:205,rate:1}))");expect(page.locator('#replay-range-hint')).to_contain_text('正在复听 · 00:07–03:25 · 空格退出复听');
 page.locator('.transcript-more>summary').click();page.locator('#open-import').click();page.locator('#show-asr').click();page.locator('#configure-asr').click();assert page.evaluate('opened.at(-1)')=='panel/settings.html#speech-service'
 page.locator('#record').click();expect(page.locator('#setup-needed')).to_be_visible();assert not page.evaluate('calls.some(m=>m.type==="CAPTURE_START")');page.locator('#setup-needed-close').click()
 page.evaluate("settingsChanged({settings:{newValue:{asrKey:'FIXTURE'}}},'local')")
 page.locator('#record').click();expect(page.locator('#capture-controls')).to_contain_text('正在采集播放音频并识别字幕')
 expect(page.locator('#asr-plan-summary')).to_contain_text('计划 3 段')
 expect(page.locator('#asr-current-segment')).to_contain_text('下一段 00:10–00:30')
 page.evaluate("fixture.transcriptMeta.asrSegments[0].status='recognizing';fixture.transcriptMeta.asrSegments[0].recognizingAt=Date.now()-5000;fixture.transcriptMeta.asrSegments[0].timeoutMs=45000;fixture.transcriptMeta.asrSegments[1].status='queued';fixture.transcriptMeta.asrSegments[1].queuedAt=Date.now()-2000;listeners.forEach(f=>f({type:'EVENT',event:'asr-progress',recordId:'capture',segments:fixture.transcriptMeta.asrSegments}))")
 expect(page.locator('#asr-segment-list')).to_contain_text('正在识别原文 · 已等待')
 expect(page.locator('#asr-segment-list')).to_contain_text('/45 秒')
 expect(page.locator('#asr-segment-list')).to_contain_text('音频已采集，等待语音服务 · 已等待')
 page.evaluate("fixture.rawCaptions=[{id:'r1',start:10,end:30,text:'Captured sentence.'}];fixture.sentences=[{id:'s1',start:10,end:30,rawText:'Captured sentence.',translation:'识别的句子。',sourceIds:['r1']}];fixture.transcriptMeta.asrSegments[0].status='done';fixture.transcriptMeta.asrSegments[1].status='failed';fixture.transcriptMeta.asrSegments[1].error='ASR unavailable';listeners.forEach(f=>f({type:'EVENT',event:'asr',recordId:'capture',record:fixture,completed:1}))")
 expect(page.locator('#asr-plan-summary')).to_contain_text('双语完成 1 · 失败 1')
 expect(page.locator('#asr-last-segment')).to_contain_text('识别失败 · ASR unavailable')
 expect(page.locator('#asr-segment-list')).to_be_visible()
 expect(page.locator('#asr-segment-list')).to_contain_text('00:30–01:30')
 expect(page.locator('#asr-segment-list')).to_contain_text('识别失败 · ASR unavailable')
 expect(page.locator('#capture-summary')).to_contain_text('00:10–00:30');expect(page.locator('#capture-controls')).to_contain_text('已完成 1 批');expect(page.locator('#asr-box')).to_be_visible();page.locator('#asr-box').scroll_into_view_if_needed();page.screenshot(path=str(ROOT/'docs/screenshots/first-use-capture-20260927.png'))
 page.locator('#record').click();expect(page.locator('#record')).to_be_disabled();expect(page.locator('#capture-controls')).to_contain_text('正在完成剩余识别')
 page.evaluate("listeners.forEach(f=>f({type:'EVENT',event:'asr-finished',recordId:'capture'}))")
 expect(page.locator('#record')).to_have_text('从当前进度继续识别');expect(page.locator('#record')).to_be_enabled();expect(page.locator('#capture-summary')).to_contain_text('00:10–00:30')
 assert not errors,errors
 settings=b.new_page();settings.goto(base+'/extension/panel/settings.html');expect(settings.locator('#asr-provider')).to_have_value('openai');settings.locator('#asrKey').fill('OLD-FIXTURE');settings.locator('#asr-provider').select_option('groq');expect(settings.locator('#asrUrl')).to_have_value('https://api.groq.com/openai/v1');expect(settings.locator('#asrModel')).to_have_value('whisper-large-v3-turbo');expect(settings.locator('#asrKey')).to_have_value('');settings.locator('#asrUrl').fill('https://custom.example/v1');expect(settings.locator('#asr-provider')).to_have_value('custom')
 for width in [320,430,900]:
  settings.set_viewport_size({'width':width,'height':760});assert settings.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 b.close()
print('Onboarding workflow passed: deferred setup without API calls, provider presets, credential isolation, capture batches/range/finish/continue, playback hint and narrow layouts.')
