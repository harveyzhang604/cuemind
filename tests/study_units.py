"""Real Chromium layout/input regression; platform messages are fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950}); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.chrome={runtime:{id:'fixture',onMessage:{addListener:()=>{}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoInfo.platform='youtube';r.videoInfo.duration=3329;r.sentences=Array.from({length:1100},(_,i)=>({...r.sentences[0],id:'s'+i,start:i*3,end:i*3+3,translation:'中文译文 '+i,rawText:('Sentence '+i+' with enough words for a long continuous reading view.').repeat(i===1099?2:1)}));
        r.analysis.explanations=Array.from({length:30},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,title:'Explanation '+i,body:'Detail '+i}));r.analysis.quotes=Array.from({length:45},(_,i)=>({sentenceId:'s'+i,start:i*3,quote:'Quote '+i,reason:'Reason '+i}));r.studyMap=Array.from({length:1100},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,level:'repeat',reason:'Learning unit '+Math.floor(i/3)}));
        return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{answer:'这是中文解释。',answerEn:'This is the English explanation.',citations:[]}};
      if(m.type==='PLAYER_COMMAND')commands.push(m.command);
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'fixture'}:null};}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html');page.locator('.sentence').first.wait_for()
    page.locator('.transcript-more>summary').click();page.locator('#open-replay').click()
    first=page.locator('.study-sentence').first
    expect(first).to_contain_text('Sentence 0')
    expect(page.locator('#study-list')).to_contain_text('00:00–00:03')
    page.evaluate('commands=[]')
    page.get_by_role('button',name='↺ 复听所选片段',exact=True).click()
    page.wait_for_function('commands.some(c=>c.action==="range")')
    command=page.evaluate('commands.find(c=>c.action==="range")')
    assert command['start']==0 and command['end']==3
    page.get_by_role('button',name='返回整章',exact=True).click()
    expect(page.locator('#study-list')).to_contain_text('Sentence 2')
    page.screenshot(path='/tmp/cuemind-related-unit.png')
    page.get_by_role('button',name='↺ 复听本章',exact=True).click()
    page.wait_for_function('commands.filter(c=>c.action==="range").length===2')
    command=page.evaluate('commands.filter(c=>c.action==="range")[1]')
    assert command['start']==0 and command['end']==50
    assert not errors,errors
    browser.close()
print('Replay map passed: sentence and chapter replay bounds, complete chapter reading.')
