"""Real Chromium layout/input regression; platform messages are fixtures."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950}); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.requests=[];window.chrome={runtime:{id:'fixture',onMessage:{addListener:()=>{}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.videoInfo.platform='youtube';r.videoInfo.duration=3329;r.sentences=Array.from({length:1100},(_,i)=>({...r.sentences[0],id:'s'+i,start:i*3,end:i*3+3,translation:'中文译文 '+i,rawText:('Sentence '+i+' with enough words for a long continuous reading view.').repeat(i===1099?2:1)}));
        r.analysis.explanations=Array.from({length:30},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,title:'Explanation '+i,body:'Detail '+i}));r.analysis.quotes=Array.from({length:45},(_,i)=>({sentenceId:'s'+i,start:i*3,quote:'Quote '+i,translationZh:'金句译文 '+i,reason:'Reason '+i}));r.studyMap=Array.from({length:1100},(_,i)=>({fromSentenceId:'s'+i,toSentenceId:'s'+i,start:i*3,end:i*3+3,level:i===2?'skim':i%2?'normal':'repeat',reason:String(i)}));
        if(window.noMap){delete r.studyMap;delete r.analysis;}return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='qa'){requests.push(m);return {ok:true,data:{headline:'一句话结论',answer:'学习回答：'+m.args.question,citations:[{sentenceId:'s0',quote:'Sentence 0',start:0}],verified:true}};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{pronunciation:'/ˈsentəns/',meaning:'句子',answer:'这是中文解释。',answerEn:'This is the English explanation.',citations:[]}};
      if(m.type==='PLAYER_COMMAND')commands.push(m.command);
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'FIXTURE'}:null};}},
      tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html'); page.locator('.sentence').first.wait_for()
    for mode in ['original','bilingual','translated']:
        page.locator('#transcript-mode').select_option(mode);page.mouse.move(0,0)
        row=page.locator('.sentence').first
        actions=row.locator('.sentence-actions');toggle=row.locator('.sentence-toggle')
        expect(toggle).to_have_attribute('aria-expanded','false')
        assert actions.evaluate('(e)=>getComputedStyle(e).display')=='none'
        assert actions.evaluate('(e)=>e.getBoundingClientRect().height')==0
        before=row.bounding_box()['height'];row.hover()
        expect(actions).to_be_hidden();assert row.bounding_box()['height']==before
        page.evaluate('commands=[]');toggle.click()
        expect(toggle).to_have_attribute('aria-expanded','true')
        assert row.locator('.sentence-actions button:visible').count()==3
        expanded=row.bounding_box()['height']
        action_space=actions.evaluate('(e)=>e.getBoundingClientRect().height+parseFloat(getComputedStyle(e).marginTop)')
        assert abs(expanded-before-action_space)<1,(before,expanded,action_space)
        page.mouse.move(0,0);expect(actions).to_be_visible()
        assert not page.evaluate("commands.some(c=>['seek','range','play'].includes(c.action))")
        if mode=='original':
            row.get_by_role('button',name='↺ 复听',exact=True).click()
            page.wait_for_function("commands.some(c=>c.action==='range'&&c.start===0&&c.end===3)")
        # Opening another sentence closes the previous actions without playback.
        other=page.locator('.sentence').nth(1)
        other.locator('.sentence-toggle').click();expect(actions).to_be_hidden()
        assert abs(row.bounding_box()['height']-before)<1
        expect(other.locator('.sentence-actions')).to_be_visible()
        other.locator('.sentence-toggle').click();expect(other.locator('.sentence-actions')).to_be_hidden()
        expect(other.locator('.sentence-toggle')).to_have_attribute('aria-expanded','false')
    # Playing/reading selection and keyboard focus alone do not reveal actions.
    row.locator('.sentence-body').click();page.mouse.move(0,0)
    expect(row).to_have_class(__import__('re').compile('reading'))
    expect(row.locator('.sentence-actions')).to_be_hidden()
    row.focus();page.keyboard.press('Tab');expect(row.locator('.timestamp')).to_be_focused()
    page.keyboard.press('Tab');expect(row.locator('.sentence-toggle')).to_be_focused()
    expect(row.locator('.sentence-actions')).to_be_hidden()
    page.keyboard.press('Enter');expect(row.locator('.sentence-actions')).to_be_visible()
    page.keyboard.press('Tab');expect(row.get_by_role('button',name='↺ 复听',exact=True)).to_be_focused()
    page.keyboard.press('Tab');expect(row.get_by_role('button',name='提问',exact=True)).to_be_focused()
    page.keyboard.press('Tab');expect(row.get_by_role('button',name='＋ 笔记',exact=True)).to_be_focused()
    page.keyboard.press('Escape');expect(row.locator('.sentence-actions')).to_be_hidden()
    expect(row.locator('.sentence-toggle')).to_be_focused()
    page.keyboard.press('Space');expect(row.locator('.sentence-actions')).to_be_visible()
    row.locator('.sentence-toggle').click()
    assert page.locator('.sentence').nth(1).locator('.sentence-actions').evaluate('(e)=>getComputedStyle(e).display')=='none'
    colors=page.locator('.sentence-toggle').evaluate_all('(nodes)=>Object.fromEntries(nodes.map(n=>[n.dataset.level,getComputedStyle(n).color]))')
    assert len(set(colors.values()))==3,colors
    assert page.locator('.priority-dot').count()==0
    assert page.locator('.sentence-toggle').count()==page.locator('.sentence').count()
    # Controls expanded just above the fixed player remain fully visible.
    edge=page.locator('.sentence').nth(5)
    edge.evaluate('(e)=>{const footer=document.querySelector("footer").getBoundingClientRect().top;window.scrollBy({top:e.getBoundingClientRect().bottom-footer+2,behavior:"instant"});}')
    edge.locator('.sentence-toggle').click()
    box=edge.locator('.sentence-actions').bounding_box()
    assert box['y']+box['height']<page.locator('footer').bounding_box()['y']
    edge.locator('.sentence-toggle').click()
    assert page.locator('.sentence .badge').count()==0
    page.locator('#transcript-mode').select_option('original')
    page.locator('.sentence-body').first.evaluate('''e=>{const range=document.createRange();range.selectNodeContents(e.firstChild);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}''')
    popup=page.locator('.selection-explain');popup.hover()
    page.wait_for_timeout(200)
    assert popup.evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(34, 68, 50)'
    assert popup.evaluate('(e)=>getComputedStyle(e).color')=='rgb(255, 255, 255)'
    popup.click()
    expect(page.locator('#explain-answer')).to_have_text('这是中文解释。')
    expect(page.locator('#explain-pronunciation')).to_contain_text('/ˈsentəns/')
    expect(page.locator('#explain-meaning')).to_contain_text('句子')
    expect(page.locator('#explain-answer-en')).to_have_text('This is the English explanation.')
    page.screenshot(path='/tmp/cuemind-explanation-tested.png')
    page.locator('#close-explain').click()
    page.evaluate('getSelection().removeAllRanges()')
    page.locator('[data-tab=study]').click()
    page.evaluate('window.scrollTo(0,0)')
    expect(page.locator('#qa-current')).to_be_visible()
    assert page.locator('#video-title').evaluate('(e)=>getComputedStyle(e).whiteSpace')=='nowrap'
    assert page.locator('[data-tab=chat]').count()==0
    assert page.locator('.study-insights').count()==0
    page.locator('#question').fill('这个视频讲什么？')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('#chat-history')).to_contain_text('学习回答：这个视频讲什么？')
    expect(page.locator('.qa-headline').first).to_have_text('一句话结论')
    expect(page.locator('.qa-quote blockquote').first).to_have_text('Sentence 0')
    page.locator('.qa-quote button').first.click()
    assert page.evaluate('commands.some(c=>c.action==="range")')
    page.locator('#question').fill('举一个例子')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('#chat-history')).to_contain_text('学习回答：举一个例子')
    assert page.evaluate('requests[1].args.history[0].question')=='这个视频讲什么？'
    assert page.evaluate('requests[0].args.selectedIds')==['s0']
    assert page.evaluate('requests[0].args.scope')=='sentence'
    page.locator('#qa-scope').select_option('video')
    page.locator('#question').fill('全视频问题')
    page.locator('#chat-form button[type=submit]').click()
    assert page.evaluate('requests[2].args.scope')=='video'
    assert page.evaluate('requests[2].args.selectedIds')==[]
    page.locator('#question').fill('尚未发送的问题')
    page.locator('[data-tab=transcript]').click()
    page.locator('.transcript-more>summary').click();page.locator('#open-replay').click()
    page.locator('.chapter-overview').nth(1).click()
    expect(page.locator('#question')).to_have_value('尚未发送的问题')

    for width,height in [(340,950),(430,950),(820,950),(430,700)]:
        page.set_viewport_size({'width':width,'height':height})
        assert page.locator('.chapter-block').count()==2
        page.locator('#study-timeline').evaluate('(e)=>e.scrollIntoView({block:"center",behavior:"instant"})')
        page.locator('.chapter-overview').nth(1).hover()
        expect(page.locator('.chapter-block').nth(1).locator('.chapter-parts')).to_be_visible()
        page.locator('.chapter-overview').nth(1).click()
        assert page.locator('.study-source').count()==1083
        assert page.locator('#chat-form').count()==1
        page.locator('#study-timeline').evaluate('(e)=>e.scrollIntoView({block:"center",behavior:"instant"})')
        page.locator('.chapter-overview').nth(1).hover()
        part=page.locator('.chapter-block').nth(1).locator('.chapter-part').first
        assert page.locator('.chapter-overview').first.bounding_box()['height']==3
        part.focus()
        assert page.locator('.study-sentence.selected').get_attribute('data-id')=='s17'
        page.keyboard.press('End')
        expect(page.locator('.study-sentence.selected')).to_have_attribute('data-id','s1099')
        assert page.locator('.chapter-part[tabindex="0"]').count()==1
        page.keyboard.press('Home')
        expect(page.locator('.study-sentence.selected')).to_have_attribute('data-id','s17')
        assert page.locator('.study-source').count()==1
        assert page.locator('#chat-form').count()==1
        assert page.locator('.study-sentence.selected').get_attribute('data-id')=='s17'
        page.evaluate('commands=[]')
        page.get_by_role('button',name='↺ 复听所选片段',exact=True).click()
        page.wait_for_function('commands.some(c=>c.action==="range")')
        command=page.evaluate('commands.find(c=>c.action==="range")')
        assert command['start']==51 and command['end']==54
        page.get_by_role('button',name='返回整章',exact=True).click()
        assert page.locator('.study-source').count()==1083
        assert page.locator('#chat-form').count()==1
        # Physical pointer at the visible right edge must reach the actual last sentence.
        page.locator('.chapter-overview').nth(1).hover()
        page.wait_for_timeout(220)
        strip=page.locator('.chapter-block').nth(1).locator('.chapter-parts')
        assert strip.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
        box=strip.bounding_box()
        page.mouse.move(box['x']+box['width']-.1,box['y']+8)
        expect(page.locator('.study-sentence.selected')).to_have_attribute('data-id','s1099')
        assert page.locator('.study-translation').count()==1
        assert page.locator('.study-sentence').first.evaluate('(e)=>e.firstElementChild.className')=='study-source'
        page.locator('#study-mode').select_option('original')
        assert page.locator('.study-translation').count()==0
        page.locator('#study-mode').select_option('translated')
        expect(page.locator('.study-source').first).to_have_text('中文译文 1099')
        page.locator('#study-mode').select_option('bilingual')
        page.evaluate('commands=[]')
        page.get_by_role('button',name='↺ 本章重点',exact=True).click()
        page.wait_for_function('commands.some(c=>c.ranges)')
        ranges=page.evaluate('commands.find(c=>c.ranges).ranges')
        assert ranges[0]['start']==54 and ranges[-1]['end']==3297
        assert all(r['start']%6==0 for r in ranges)
        # Last sentences must remain reachable above the fixed playback footer.
        for index in [540,1080,1081,1082]:
            page.locator('.chapter-overview').nth(1).hover()
            tail=page.locator('.chapter-block').nth(1).locator('.chapter-part').nth(index)
            tail.focus()
            selected=page.locator('.study-sentence.selected')
            assert selected.get_attribute('data-id')=='s'+str(17+index)
            box=selected.bounding_box(); pane=page.locator('#study-list').bounding_box()
            footer=page.locator('#replay-dialog').bounding_box()
            footer['y']+=footer['height']
            assert box['y']>=pane['y']-1,(index,box,pane)
            assert box['y']+box['height']<=min(pane['y']+pane['height'],footer['y'])+1,(index,box,pane,footer)
        page.locator('.chapter-overview').first.click()
        assert page.locator('.study-source').count()==17
    # A clicked chapter retains DOM focus, but must collapse when another is hovered.
    page.locator('#study-timeline').evaluate('(e)=>e.scrollIntoView({block:"center",behavior:"instant"})')
    page.locator('.chapter-overview').first.click()
    assert page.locator('.chapter-overview').first.evaluate('(e)=>e===document.activeElement')
    for index in [1,0,1,0]:
        page.locator('.chapter-overview').nth(index).hover()
        expect(page.locator('.chapter-parts:visible')).to_have_count(1)
        expect(page.locator('.chapter-block').nth(index).locator('.chapter-parts')).to_be_visible()
    page.mouse.move(0,0)
    expect(page.locator('.chapter-parts:visible')).to_have_count(0)
    page.keyboard.press('Tab')
    expect(page.locator('.chapter-parts:visible')).to_have_count(1)
    expect(page.locator('.chapter-block').nth(1).locator('.chapter-parts')).to_be_visible()
    page.screenshot(path='/tmp/cuemind-study-tested.png')
    page.locator('#close-replay').click()
    page.locator('[data-tab=overview]').click()
    page.locator('.overview-extra').first.locator('summary').first.click()
    page.locator('.quote-browser').scroll_into_view_if_needed()
    assert page.locator('.quote-mark').count()==45
    assert page.locator('.quote-card').count()==1
    page.locator('.quote-mark').last.hover()
    assert page.locator('.quote-nav,.quote-count').count()==0
    expect(page.locator('.quote-card blockquote')).to_have_text('Quote 44')
    page.locator('.quote-mark').first.hover()
    expect(page.locator('.quote-card blockquote')).to_have_text('Quote 0')
    assert page.locator('.quote-mark').first.evaluate('(e)=>getComputedStyle(e,"::before").height')=='3px'
    assert page.locator('.quote-reason').evaluate('(e)=>e.open')
    assert page.locator('.detail-current').count()==0
    expect(page.locator('.quote-translation')).to_have_text('金句译文 0')
    expect(page.locator('.quote-reason p')).to_be_visible()
    # The detail strip is exercised by the browser fixture; its cards are intentionally single-card.
    page.evaluate('window.noMap=true')
    page.locator('[data-tab=transcript]').click();page.locator('.transcript-more>summary').click();page.locator('#refresh').click()
    page.locator('[data-tab=study]').click()
    expect(page.locator('#qa-current')).to_be_visible()
    page.locator('#question').fill('没有地图也能提问')
    page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('#chat-history')).to_contain_text('学习回答：没有地图也能提问')
    page.locator('#chat-form').scroll_into_view_if_needed()
    page.screenshot(path='/tmp/cuemind-merged-learning.png')
    page.locator('[data-tab=transcript]').click()
    page.locator('.transcript-more>summary').click();page.locator('#open-replay').click()
    expect(page.get_by_role('button',name='生成章节概览',exact=True)).to_be_visible()
    assert page.locator('.study-source').count()==0
    expect(page.locator('#highlights')).to_be_disabled()
    page.locator('#close-replay').click()
    page.locator('.sentence').nth(20).evaluate('(e)=>e.scrollIntoView({block:"center",behavior:"instant"})')
    page.locator('.sentence').nth(20).locator('.sentence-toggle').click()
    page.locator('.sentence').nth(20).get_by_role('button',name='提问').dispatch_event('click')
    expect(page.locator('#qa-current blockquote')).to_contain_text('Sentence 20')
    assert page.locator('#qa-scope').input_value()=='sentence'
    page.locator('#qa-scope').select_option('segment')
    page.locator('#question').fill('前后文是什么？')
    page.locator('#chat-form button[type=submit]').click()
    assert page.evaluate('requests.at(-1).args.scope')=='segment'
    assert page.evaluate('requests.at(-1).args.selectedIds')==['s20']
    assert not errors,errors
    browser.close()
print('UI regression passed: subtitle click-to-expand actions, non-expanding hover, colors, keyboard and chapter count, hover expansion, chapter/sentence filtering and scoped replay; middle/last sentences fully visible at three widths and two heights.')
