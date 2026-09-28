"""Real Chromium layout/input regression; platform messages are fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950}); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.chrome={runtime:{id:'fixture',onMessage:{addListener:()=>{}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoInfo.platform='youtube';r.videoInfo.duration=3329;r.sentences=Array.from({length:1100},(_,i)=>({...r.sentences[0],id:'s'+i,start:i*3,end:i*3+3,translation:'中文译文 '+i,rawText:('Sentence '+i+' with enough words for a long continuous reading view.').repeat(i===1099?2:1)}));
        r.analysis.explanations=Array.from({length:30},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,title:'Explanation '+i,body:'Detail '+i}));r.analysis.quotes=Array.from({length:45},(_,i)=>({sentenceId:'s'+i,start:i*3,quote:'Quote '+i,reason:'Reason '+i}));r.studyMap=Array.from({length:1100},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,level:i%2?'normal':'repeat',reason:String(i)}));
        return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{answer:'这是中文解释。',answerEn:'This is the English explanation.',citations:[]}};
      if(m.type==='PLAYER_COMMAND')commands.push(m.command);
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{}:null};}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html');page.locator('.sentence').first.wait_for()
    expect(page.locator('.sentence').first).to_have_attribute('data-id','s0')
    assert page.get_by_role('button',name='回到字幕开头',exact=True).count()==0
    if page.locator('#status').is_visible():page.locator('#dismiss-status').click()
    # Loading is automatic at page boundaries; the hidden retry button is not navigation.
    for count in [140,210]:
        page.locator('.sentence').last.scroll_into_view_if_needed();page.mouse.wheel(0,800)
        expect(page.locator('.sentence')).to_have_count(count)
    page.locator('.sentence').last.scroll_into_view_if_needed();page.mouse.wheel(0,800)
    expect(page.locator('.sentence').first).to_have_attribute('data-id','s70')
    expect(page.locator('#first-subtitle')).to_be_visible()
    page.locator('#first-subtitle').click()
    expect(page.locator('.sentence').first).to_have_attribute('data-id','s0')
    page.wait_for_function('scrollY<2')
    expect(page.locator('#transcript-mode')).to_be_visible()
    expect(page.locator('#video-title')).to_be_visible()
    assert not page.evaluate('commands.some(c=>["seek","play","range"].includes(c.action))')
    assert not errors,errors
    browser.close()
print('Subtitle navigation passed: automatic page loading, floating return to full page start and toolbar visibility, no video seek.')
