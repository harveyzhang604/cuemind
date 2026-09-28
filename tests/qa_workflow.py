"""Real Chromium layout/input regression; platform messages are fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950}); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.requests=[];window.savedChats=[];window.savedNotes=[];window.chrome={runtime:{id:'fixture',onMessage:{addListener:fn=>{window.playerListener=fn;}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.id='youtube:fixture';r.videoInfo.platform='youtube';r.paragraphs=[{id:'p1',sentenceIds:['s0','s1','s2'],start:0,end:9}];r.videoInfo.duration=3329;r.sentences=Array.from({length:1100},(_,i)=>({...r.sentences[0],id:'s'+i,start:i*3,end:i*3+3,translation:'中文译文 '+i,rawText:('Sentence '+i+' with enough words for a long continuous reading view.').repeat(i===1099?2:1)}));
        r.analysis.explanations=Array.from({length:30},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,title:'Explanation '+i,body:'Detail '+i}));r.analysis.quotes=Array.from({length:45},(_,i)=>({sentenceId:'s'+i,start:i*3,quote:'Quote '+i,reason:'Reason '+i}));r.studyMap=Array.from({length:1100},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,level:i%2?'normal':'repeat',reason:String(i)}));
        if(window.noMap){delete r.studyMap;delete r.analysis;}return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='qa'){requests.push(m);if(window.slowQa)return await new Promise(resolve=>window.resolveQa=resolve);if(window.failQa)return {ok:false,error:'模拟网络故障'};const data={headline:'一句话结论',answer:'回答：'+m.args.question,supplement:'补充例句',topicId:m.args.topicId,history:m.args.history,context:{scope:m.args.scope,selectedIds:m.args.selectedIds,selectedText:m.args.selectedText,answerLanguage:m.args.answerLanguage},citations:[{sentenceId:'s0',quote:'Sentence 0',start:0},{sentenceId:'s20',quote:'Sentence 20',start:60}],verified:true};savedChats.push({question:m.args.question,...data});return {ok:true,data};}
      if(m.type==='CHATS')return {ok:true,data:structuredClone(savedChats)};
      if(m.type==='NOTES')return {ok:true,data:structuredClone(savedNotes)};
      if(m.type==='SAVE_NOTE'){savedNotes.push({...m.note,id:'note1'});return {ok:true,data:structuredClone(savedNotes).at(-1)};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{pronunciation:'/ˈsentəns/',meaning:'句子',answer:'这是中文解释。',answerEn:'This is the English explanation.',citations:[]}};
      if(m.type==='PLAYER_COMMAND')commands.push(m.command);
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'FIXTURE'}:null};}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html')
    page.locator('.sentence').first.wait_for()
    page.locator('[data-tab=study]').click()
    assert page.locator('#study .qa-replay-tools').count()==0
    page.locator('#question').fill('解释第一句')
    page.evaluate("playerListener({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'demo:learning:1',time:60,paused:false,rate:1})")
    expect(page.locator('#qa-current blockquote')).to_contain_text('Sentence 0')
    page.locator('#qa-language').select_option('bilingual')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(1)
    assert page.evaluate('requests[0].args.answerLanguage')=='bilingual'
    expect(page.locator('#qa-shortcuts')).to_be_hidden()
    page.locator('#question').fill('为什么？')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(2)
    expect(page.locator('.qa-answer-card .question').first).to_have_text('解释第一句')
    assert page.evaluate('requests[1].args.topicId===requests[0].args.topicId')
    assert '补充例句' in page.evaluate('requests[1].args.history[0].answer')
    page.locator('#qa-new').click()
    expect(page.locator('.qa-answer-card')).to_have_count(0)
    expect(page.locator('#qa-current blockquote')).to_contain_text('Sentence 20')
    page.locator('#question').fill('另一个问题')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(1)
    assert page.evaluate('requests[2].args.history.length')==0
    assert page.evaluate('requests[2].args.topicId!==requests[0].args.topicId')
    page.locator('#qa-topics summary').click()
    page.locator('.qa-topic').get_by_text('解释第一句',exact=True).click()
    expect(page.locator('.qa-answer-card')).to_have_count(2)
    page.locator('#question').fill('再解释一下')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(3)
    assert page.evaluate('requests[3].args.history.length')==2
    assert page.evaluate('requests[3].args.history.every(x=>x.question!=="另一个问题")')
    # Multiple evidence sources persist and replay independently.
    page.locator('.qa-answer-card').last.get_by_role('button',name='＋ 保存笔记').click()
    expect(page.locator('#note-dialog')).not_to_be_visible()
    page.wait_for_function('savedNotes.length===1')
    assert '再解释一下' in page.evaluate('savedNotes[0].body')
    page.locator('[data-tab=notes]').click()
    expect(page.locator('.note-sources')).to_have_count(1)
    page.locator('.note-sources summary').click()
    page.evaluate('commands=[]')
    page.locator('.note-sources button').nth(2).click()
    page.wait_for_function('commands.some(c=>c.action==="range")')
    command=page.evaluate('commands.find(c=>c.action==="range")')
    assert command['start']==60 and command['end']==63
    assert page.evaluate('savedNotes[0].sentenceIds')==['s0','s20']
    # Evidence navigation preserves question and does not seek the player.
    page.locator('[data-tab=study]').click()
    page.locator('#question').fill('暂存追问')
    page.evaluate('commands=[]')
    page.locator('.qa-answer-card').last.locator('.qa-more-evidence summary').click()
    page.locator('.qa-answer-card').last.locator('.qa-quote').last.get_by_role('button',name='查看字幕').click()
    expect(page.locator('.source-target')).to_have_attribute('data-id','s20')
    assert not page.evaluate('commands.some(c=>c.action==="seek"||c.action==="range")')
    before=page.evaluate('scrollY')
    page.locator('[data-tab=study]').click()
    expect(page.locator('#question')).to_have_value('暂存追问')
    page.locator('[data-tab=transcript]').click()
    assert abs(page.evaluate('scrollY')-before)<3
    # Selection popup hands the selected word and its sentence into a fresh topic.
    page.locator('.source-target .sentence-body').scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    page.locator('.source-target .sentence-body').evaluate("""e=>{const range=document.createRange();const text=document.createTreeWalker(e,NodeFilter.SHOW_TEXT).nextNode();range.setStart(text,0);range.setEnd(text,8);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}""")
    page.locator('.selection-explain').click()
    expect(page.locator('#explain-answer')).to_have_text('这是中文解释。')
    page.locator('#explain-ask').click()
    expect(page.locator('#qa-current')).to_contain_text('选中内容：Sentence')
    page.locator('#question').fill('这里是什么意思？')
    page.locator('#chat-form button[type=submit]').click()
    assert page.evaluate('requests.at(-1).args.selectedText')=='Sentence'
    assert page.evaluate('requests.at(-1).args.selectedIds')==['s20']
    # Failure retains the draft and can retry.
    page.evaluate('window.failQa=true')
    page.locator('#question').fill('请保留这个问题')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('#qa-request-state')).to_contain_text('模拟网络故障')
    expect(page.locator('#question')).to_have_value('请保留这个问题')
    expect(page.locator('#chat-form button[type=submit]')).to_be_enabled()
    page.evaluate('window.failQa=false')
    page.locator('#dismiss-status').click()
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('#qa-request-state')).to_be_hidden()
    # Loading saved chats restores topics without starting a model request.
    count=page.evaluate('requests.length')
    page.locator('[data-tab=transcript]').click();page.locator('.transcript-more>summary').click();page.locator('#refresh').click();page.locator('.sentence').first.wait_for();page.locator('[data-tab=study]').click()
    expect(page.locator('#qa-topics')).to_be_visible()
    page.locator('#qa-topics summary').click()
    page.locator('.qa-topic').first.click()
    expect(page.locator('.qa-answer-card')).to_have_count(2)
    assert page.evaluate('requests.length')==count
    if page.locator('#status').is_visible():page.locator('#dismiss-status').click()
    page.wait_for_function('document.querySelector("#toast").hidden')
    for width in [340,430,820]:
        page.set_viewport_size({'width':width,'height':850})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('#chat-form').evaluate('(e)=>e.scrollIntoView({block:"center",behavior:"instant"})')
        page.screenshot(path=f'/tmp/cuemind-workflow-{width}.png')
    page.evaluate('window.slowQa=true')
    page.locator('#question').fill('等待中的旧问题')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('#qa-scope')).to_be_disabled()
    page.locator('[data-tab=transcript]').click();page.locator('.transcript-more>summary').click();page.locator('#refresh').click();page.locator('.sentence').first.wait_for();page.locator('[data-tab=study]').click()
    expect(page.locator('#question')).to_have_value('')
    page.evaluate('resolveQa({ok:true,data:{answer:"过期答案",citations:[]}})')
    expect(page.locator('#chat-history')).not_to_contain_text('过期答案')
    expect(page.locator('#chat-form button[type=submit]')).to_be_enabled()
    assert not errors,errors
    browser.close()
print('Workflow passed: topics, isolated history, language, selection handoff, source navigation, scroll preservation, multi-source notes, retry, persisted topics, three widths.')
