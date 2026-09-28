"""Real Chromium layout/input regression; platform messages are fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950}); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.requests=[];window.chrome={runtime:{id:'fixture',onMessage:{addListener:()=>{}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoInfo.platform='youtube';r.videoInfo.duration=3329;r.sentences=Array.from({length:1100},(_,i)=>({...r.sentences[0],id:'s'+i,start:i*3,end:i*3+3,translation:'中文译文 '+i,rawText:('Sentence '+i+' with enough words for a long continuous reading view.').repeat(i===1099?2:1)}));
        r.analysis.explanations=Array.from({length:30},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,title:'Explanation '+i,body:'Detail '+i}));r.analysis.quotes=Array.from({length:45},(_,i)=>({sentenceId:'s'+i,start:i*3,quote:'Quote '+i,reason:'Reason '+i}));r.studyMap=Array.from({length:1100},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,level:i%2?'normal':'repeat',reason:String(i)}));
        if(window.noMap){delete r.studyMap;delete r.analysis;}window.testRecord=r;return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='curateDetails'){requests.push(m);const analysis={...testRecord.analysis,explanations:testRecord.analysis.explanations.filter((x,i)=>[2,10,22].includes(i)),detailsSignature:'[4,fixture]'};return {ok:true,data:{analysis}};}
      if(m.type==='TASK'&&m.capability==='quoteTranslation'){requests.push(m);return {ok:true,data:{quotes:Array.from({length:45},(_,i)=>({sentenceId:'s'+i,quote:'Quote '+i,translationZh:'中文意思 '+i}))}};}
      if(m.type==='TASK'&&m.capability==='qa'){requests.push(m);return {ok:true,data:{headline:'一句话结论',answer:'学习回答：'+m.args.question,citations:[{sentenceId:'s0',quote:'Sentence 0',start:0}],verified:true}};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{pronunciation:'/ˈsentəns/',meaning:'句子',answer:'这是中文解释。',answerEn:'This is the English explanation.',citations:[]}};
      if(m.type==='PLAYER_COMMAND')commands.push(m.command);
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'FIXTURE'}:null};}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html')
    page.locator('.sentence').first.wait_for()
    page.locator('[data-tab=overview]').click()
    page.locator('.overview-extra').nth(1).locator('summary').first.click()
    expect(page.locator('.explanation-mark')).to_have_count(3)
    expect(page.locator('.explanation-card')).to_contain_text('Explanation 2')
    page.locator('.explanation-mark').last.hover()
    expect(page.locator('.explanation-card')).to_contain_text('Explanation 22')
    page.locator('.explanation-card').scroll_into_view_if_needed()
    page.screenshot(path='/tmp/cuemind-selected-details.png')
    assert page.evaluate('requests.filter(m=>m.capability==="curateDetails").length')==1
    assert not errors,errors
    browser.close()
print('Explanation curation UI passed: old overview migration, selected strip and correct content.')
