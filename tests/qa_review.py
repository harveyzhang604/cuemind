"""Real Chromium layout/input regression; platform messages are fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950}); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.requests=[];window.chrome={runtime:{id:'fixture',onMessage:{addListener:fn=>{window.playerListener=fn;}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoInfo.platform='youtube';r.videoInfo.duration=3329;r.sentences=Array.from({length:1100},(_,i)=>({...r.sentences[0],id:'s'+i,start:i*3,end:i*3+3,translation:'中文译文 '+i,rawText:('Sentence '+i+' with enough words for a long continuous reading view.').repeat(i===1099?2:1)}));
        r.analysis.explanations=Array.from({length:30},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,title:'Explanation '+i,body:'Detail '+i}));r.analysis.quotes=Array.from({length:45},(_,i)=>({sentenceId:'s'+i,start:i*3,quote:'Quote '+i,reason:'Reason '+i}));r.studyMap=Array.from({length:1100},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,level:i%2?'normal':'repeat',reason:String(i)}));
        if(window.noMap){delete r.studyMap;delete r.analysis;}return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='qa'){requests.push(m);if(window.failQa)return {ok:false,error:'模拟网络故障'};return {ok:true,data:{headline:'一句话结论',answer:'学习回答：'+m.args.question,citations:[{sentenceId:'s0',quote:'Sentence 0',start:0}],verified:true}};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{pronunciation:'/ˈsentəns/',meaning:'句子',answer:'这是中文解释。',answerEn:'This is the English explanation.',citations:[]}};
      if(m.type==='PLAYER_COMMAND')commands.push(m.command);
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'fixture'}:null};}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html')
    page.locator('.sentence').first.wait_for()
    page.locator('[data-tab=study]').click()
    page.locator('#question').fill('解释第一句')
    page.evaluate("playerListener({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'demo:learning:1',time:60,paused:false,rate:1})")
    expect(page.locator('#play-time')).to_have_text('01:00')
    expect(page.locator('#qa-current blockquote')).to_contain_text('Sentence 0')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(1)
    assert page.evaluate('requests[0].args.selectedIds')==['s0']
    page.locator('#qa-scope').select_option('video')
    page.locator('#question').fill('整个视频呢')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(1)
    assert page.evaluate('requests[1].args.history.length')==0
    page.locator('#qa-topics summary').click()
    page.locator('.qa-topic').get_by_text('解释第一句',exact=True).click()
    page.locator('#question').fill('为什么')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(2)
    assert page.evaluate('requests[2].args.history.length')==1
    assert page.evaluate('requests[2].args.selectedIds')==['s0']
    page.locator('#qa-followup').click()
    expect(page.locator('#qa-current blockquote')).to_contain_text('Sentence 20')
    page.locator('[data-qa-shortcut]').first.click()
    assert page.locator('#question').input_value()=='这句话什么意思？'
    assert page.evaluate('requests.length')==3
    assert not errors,errors
    browser.close()
print('QA review passed: draft lock, playback follow, topic isolation, older-topic followup and shortcut preview.')
