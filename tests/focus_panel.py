"""Goal emphasis and compact UX in Chromium; fixtures replace backend/provider only."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**chromium_options())
    page=browser.new_page(viewport={'width':420,'height':900});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.commands=[];window.requests=[];window.notes=[];window.chats=[];window.config=JSON.parse(sessionStorage.getItem('focus-fixture')||'null')||{goal:'off',baseSize:14,videoSize:28,overlay:false,overlayLanguage:'bilingual',glossary:[],mastered:[]};window.cache=null;window.cacheBook=JSON.parse(sessionStorage.getItem('focus-cache-fixture')||'null')||{};
    window.chrome={runtime:{id:'fixture',onMessage:{addListener:fn=>window.listener=fn},sendMessage:async m=>{
      const ok=data=>({ok:true,data});
      if(m.type==='GET_SETTINGS')return ok({apiKey:'FIXTURE'});
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.id='youtube:focus';r.videoInfo.platform='youtube';r.videoKey='youtube:focus:1';r.videoInfo.title='Financial reporting';r.videoInfo.duration=40;r.sentences=[{id:'s0',start:0,end:10,rawText:'Working capital improves cash flow and revenue.',translation:'营运资本改善现金流和收入。',sourceIds:['r0']},{id:'s1',start:10,end:20,rawText:'Capital can mean something different here.',translation:'资本在这里可能有所不同。',sourceIds:['r1']},{id:'s2',start:20,end:30,rawText:'Check the financial statement carefully.',translation:'仔细检查财务报表。',sourceIds:['r2']}];r.rawCaptions=r.sentences.map(s=>({...s,text:s.rawText}));r.paragraphs=[{id:'p0',sentenceIds:r.sentences.map(s=>s.id),start:0,end:30}];window.fixtureRecord=r;return ok({record:r,tracks:[]});}
      if(['GET_FOCUS','SAVE_FOCUS'].includes(m.type)){const {selectFocusConfig}=await import('../core/focus.js');Object.assign(fixtureRecord,{focusConfig:config,focusCache:cache,focusCaches:cacheBook});const result=selectFocusConfig(fixtureRecord,m.type==='SAVE_FOCUS'?m.config:config);config=result.config;cache=result.cache;cacheBook=fixtureRecord.focusCaches;sessionStorage.setItem('focus-fixture',JSON.stringify(config));sessionStorage.setItem('focus-cache-fixture',JSON.stringify(cacheBook));return ok(structuredClone(result));}
      if(m.type==='FOCUS_OVERRIDE'){config.mastered.push(m.term.toLowerCase());return ok({config,cache});}
      if(m.type==='TASK'&&m.capability==='focus'){requests.push(m);cache.status='running';return await new Promise(resolve=>window.finishFocus=()=>{Object.assign(cache,{marks:[{sentenceId:'s1',start:0,end:7,text:'Capital',level:3,source:'ai',reason:'Context dependent term'},{sentenceId:'s0',start:0,end:15,text:'Working capital',level:3},{sentenceId:'s0',start:25,end:34,text:'cash flow',level:2},{sentenceId:'s0',start:39,end:46,text:'revenue',level:1}],done:[0],failed:[],status:'complete'});sessionStorage.setItem('focus-cache-fixture',JSON.stringify(cacheBook));resolve(ok({config,cache}));});}
      if(m.type==='CANCEL'){requests.push(m);if(window.finishFocus)window.finishFocus();return ok(true);}
      if(m.type==='TASK'&&m.capability==='qa'){requests.push(m);const c={topicId:m.args.topicId,context:{scope:m.args.scope,selectedIds:m.args.selectedIds,currentTime:m.args.currentTime},answer:'Direct answer',citations:[{sentenceId:'s0',quote:'Working capital improves cash flow and revenue.',start:0},{sentenceId:'s1',quote:'Capital can mean something different here.',start:10}]};chats.push({question:m.args.question,...c});return ok(c);}
      if(m.type==='SAVE_NOTE'){const n={...m.note,id:m.note.id||'n'+(notes.length+1)};notes=notes.filter(x=>x.id!==n.id);notes.push(n);return ok(n);}
      if(m.type==='DELETE_NOTE'){notes=notes.filter(x=>x.id!==m.id);return ok(true);}
      if(m.type==='NOTES')return ok(structuredClone(notes));if(m.type==='CHATS')return ok(structuredClone(chats));
      if(m.type==='PLAYER_COMMAND'){commands.push(m.command);return ok(m.command.action==='state'?{videoKey:'youtube:focus:1',time:0,paused:true,rate:1}:true);}
      return ok(null);
    }},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=focus'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html');page.locator('.sentence').first.wait_for()
    # Reading is separate from player selection; actions consume space only after clicking the row control.
    first=page.locator('.sentence').first
    page.mouse.move(0,0);before=first.bounding_box()['height'];expect(first.locator('.sentence-actions')).to_be_hidden()
    first.hover();expect(first.locator('.sentence-actions')).to_be_hidden();assert abs(first.bounding_box()['height']-before)<1
    first.locator('.sentence-toggle').click();assert first.bounding_box()['height']>before;expect(first.locator('.sentence-actions')).to_be_visible()
    page.mouse.move(0,0);expect(first.locator('.sentence-actions')).to_be_visible()
    first.locator('.sentence-toggle').click();assert abs(first.bounding_box()['height']-before)<1
    page.evaluate('commands=[]');page.locator('.caption-original').nth(1).click()
    expect(page.locator('.sentence.reading')).to_have_attribute('data-id','s1')
    assert not page.evaluate("commands.some(c=>['seek','range','play'].includes(c.action))")
    page.locator('.sentence').nth(1).locator('.timestamp').click();page.wait_for_function("commands.some(c=>c.action==='seek'&&c.time===10)")
    # Goal settings are explicit and glossary works without a model request.
    page.locator('#focus-settings').click();expect(page.locator('.transcript-display-controls')).to_contain_text('重点：关闭');expect(page.locator('#focus-title')).to_have_text('字幕重点设置');expect(page.locator('#focus-description')).to_contain_text('控制字幕');expect(page.locator('#focus-video-size-value')).to_have_text('28 px');expect(page.locator('#focus-video-translation-size-value')).to_have_text('18 px');page.locator('#focus-goal').select_option('finance')
    page.locator('.focus-terms summary').click();page.locator('#focus-glossary').fill('Working capital: 3\ncash flow: 2\nrevenue: 1');page.locator('#focus-glossary').blur()
    page.locator('#focus-overlay').check();page.locator('#focus-overlay-language').select_option('translated')
    page.locator('#focus-save').click();page.wait_for_function("commands.some(c=>c.action==='focusCaptions'&&c.enabled&&c.language==='translated')")
    assert page.evaluate('requests.length')==0
    spans=page.locator('.sentence').first.locator('.focus-word');expect(spans).to_have_count(3)
    assert spans.all_text_contents()==['Working capital','cash flow','revenue']
    sizes=spans.evaluate_all('es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
    for actual,expected in zip(sizes,[19.6,17.5,15.4]):assert abs(actual-expected)<.05,(actual,expected)
    assert first.locator('.caption-original').inner_text()=='Working capital improves cash flow and revenue.'
    command=page.evaluate("commands.filter(c=>c.action==='focusCaptions'&&c.enabled).at(-1)")
    assert command['baseSize']==28 and command['translationSize']==18
    assert ''.join(x['text'] for x in command['sentences'][0]['parts'])==first.locator('.caption-original').inner_text()
    assert [x['level'] for x in command['sentences'][0]['parts'] if x['level']]==[3,2,1]
    page.locator('#focus-settings').click();page.locator('#focus-video-translation-size').fill('22')
    expect(page.locator('#focus-video-translation-size-value')).to_have_text('22 px')
    page.locator('#focus-save').click();page.wait_for_function("commands.filter(c=>c.action==='focusCaptions'&&c.enabled).at(-1)?.translationSize===22")
    command=page.evaluate("commands.filter(c=>c.action==='focusCaptions'&&c.enabled).at(-1)")
    assert command['baseSize']==28 and command['translationSize']==22
    # Base font reacts immediately; goal settings survive reload.
    page.locator('#focus-settings').click();page.locator('#focus-size').evaluate("e=>{e.value=20;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    expect(page.locator('#focus-size-value')).to_have_text('20 px');page.locator('#focus-save').click()
    assert abs(float(first.locator('.focus-word').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'))-28)<.05
    # Already-mastered removes a phrase, not the rest of the source sentence.
    page.locator('#focus-settings').click();page.locator('#focus-mastered').fill('Working capital');page.locator('#focus-mastered').blur();page.locator('#focus-save').click()
    expect(first.locator('.focus-word')).to_have_count(2)
    page.reload();page.locator('.sentence').first.wait_for();expect(page.locator('#focus-settings')).to_have_text('金融');expect(page.locator('.sentence').first.locator('.focus-word')).to_have_count(2)
    page.locator('#focus-settings').click();expect(page.locator('#focus-video-size-value')).to_have_text('28 px');expect(page.locator('#focus-video-translation-size-value')).to_have_text('22 px');page.locator('#focus-close').click()
    # Analysis does not block asking a question; whole-video shortcuts retain scope.
    page.locator('#focus-settings').click();page.locator('#focus-analyze').click();page.wait_for_function('!!window.finishFocus');expect(page.locator('#focus-size')).to_be_disabled();expect(page.locator('#focus-save')).to_be_disabled();page.locator('#focus-close').click()
    page.locator('[data-tab=study]').click();page.locator('#qa-scope').select_option('segment');page.get_by_role('button',name='梳理逻辑',exact=True).click();expect(page.locator('#qa-scope')).to_have_value('segment');page.locator('#qa-scope').select_option('video');page.get_by_role('button',name='核心观点',exact=True).click()
    expect(page.locator('#qa-scope')).to_have_value('video');page.locator('#chat-form button[type=submit]').click()
    expect(page.locator('.qa-answer-card')).to_have_count(1)
    assert page.evaluate("requests.find(r=>r.capability==='qa').args.scope")=='video'
    expect(page.locator('.qa-evidence>.qa-quote')).to_be_visible();expect(page.locator('.qa-more-evidence .qa-quote')).not_to_be_visible()
    # Answer saves immediately, repeats open editing and deletion can be undone.
    page.get_by_role('button',name='＋ 保存笔记',exact=True).click();expect(page.locator('#note-dialog')).not_to_be_visible();page.wait_for_function('notes.length===1')
    page.get_by_role('button',name='已保存 · 补充想法',exact=True).click();expect(page.locator('#note-dialog')).to_be_visible();page.locator('#close-note').click();assert page.evaluate('notes.length')==1
    page.locator('[data-tab=notes]').click();page.locator('#note-scope').select_option('all');expect(page.locator('.note-video-title')).to_have_text('Financial reporting')
    page.get_by_role('button',name='删除',exact=True).click();page.wait_for_function('notes.length===0');page.locator('#toast').get_by_role('button',name='撤销').click();page.wait_for_function('notes.length===1')
    # Finish incremental analysis; current playing sentence remains readable.
    page.evaluate('finishFocus()');page.wait_for_timeout(150);page.locator('[data-tab=transcript]').click();page.wait_for_timeout(200)
    page.evaluate("listener({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'youtube:focus:1',time:10,paused:false,rate:1})")
    expect(page.locator('.sentence').nth(1).locator('.focus-word')).to_have_text('Capital')
    # Goal results survive A -> unanalysed B -> A and reload in both renderers.
    page.locator('#focus-settings').click();page.locator('.focus-terms summary').click();page.locator('#focus-glossary').fill('');page.locator('#focus-glossary').blur();page.locator('#focus-mastered').fill('');page.locator('#focus-mastered').blur();page.locator('#focus-save').click()
    expect(first.locator('.focus-word')).to_have_count(3)
    model_calls=page.evaluate("requests.filter(r=>r.capability==='focus').length")
    for goal in ['custom','toefl','off']:
        page.locator('#focus-settings').click();page.locator('#focus-goal').select_option(goal);page.locator('#focus-save').click()
        expect(page.locator('.sentence .focus-word')).to_have_count(0)
        overlay=page.evaluate("commands.filter(c=>c.action==='focusCaptions'&&c.enabled).at(-1)")
        assert all(part['level']==0 for s in overlay['sentences'] for part in s['parts'])
        page.locator('#focus-settings').click();page.locator('#focus-goal').select_option('finance');page.locator('#focus-save').click()
        expect(first.locator('.focus-word')).to_have_count(3)
        sizes=first.locator('.focus-word').evaluate_all('es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize))')
        for actual,expected in zip(sizes,[28,25,22]):assert abs(actual-expected)<.05,(actual,expected)
        overlay=page.evaluate("commands.filter(c=>c.action==='focusCaptions'&&c.enabled).at(-1)")
        assert [part['level'] for part in overlay['sentences'][0]['parts'] if part['level']]==[3,2,1]
    assert page.evaluate("requests.filter(r=>r.capability==='focus').length")==model_calls
    page.reload();page.locator('.sentence').first.wait_for();expect(first.locator('.focus-word')).to_have_count(3)
    # During slow saves and rapid target changes no old goal marks are shown.
    page.evaluate("(()=>{window.savedSender=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async m=>{if(m.type==='SAVE_FOCUS')await new Promise(r=>setTimeout(r,250));return savedSender(m)}})()")
    page.locator('#focus-settings').click();page.locator('#focus-goal').select_option('toefl');expect(page.locator('.sentence .focus-word')).to_have_count(0)
    page.locator('#focus-goal').select_option('finance');page.locator('#focus-save').click();expect(first.locator('.focus-word')).to_have_count(3)
    assert page.evaluate("requests.filter(r=>r.capability==='focus').length")==0
    page.evaluate('void (chrome.runtime.sendMessage=savedSender)')
    page.screenshot(path='/tmp/cuemind-focus-panel.png')
    for width in [320,380,390,420,500,720]:
      page.set_viewport_size({'width':width,'height':900})
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
      spacing=page.evaluate('''()=>{const box=s=>document.querySelector(s).getBoundingClientRect();return {mode:box('.focus-entry-label').left-box('.segments').right,focus:box('#focus-settings').left-box('.focus-entry-label').right}}''')
      assert spacing['focus']<spacing['mode'],(width,spacing)
      for group in ['.transcript-display-controls','.transcript-utility-controls']:
        box=page.locator(group).bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1,(width,group,box)
      page.locator('#focus-settings').click()
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
      assert page.locator('#focus-dialog').bounding_box()['width']<=width
      if width==420:page.screenshot(path='/tmp/cuemind-focus-settings.png')
      page.locator('#focus-close').click()
    assert not errors,errors
    browser.close()
print('Focus panel passed: glossary 3 levels, font controls, source integrity, overlay parity, mastered, independent analysis/QA, scope shortcuts, one-click notes, undo, six widths.')
