"""Real wheel isolation and persisted explanation reuse in an isolated extension."""
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='cuemind-explain-') as profile:
    context=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    page=context.new_page();page.goto(f'chrome-extension://{worker.url.split("/")[2]}/panel/settings.html');page.wait_for_load_state('networkidle')
    def rpc(kind,**data):return page.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':kind,**data})
    cfg=rpc('GET_SETTINGS')['data'];cfg['apiKey']='FIXTURE';assert rpc('SAVE_SETTINGS',settings=cfg)['ok']
    record=rpc('IMPORT',info={'platform':'youtube','videoId':'explainFixture','title':'Shadowing','url':'https://www.youtube.com/watch?v=explainFixture'},raw=[{'start':0,'end':3,'text':'That is shadowing.'}])['data']
    worker.evaluate('''()=>{globalThis.explanationRequests=0;globalThis.fetch=async()=>{explanationRequests++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({pronunciation:'/test/',meaning:'影子跟读',answer:'这是影子跟读法。',answerEn:'This is shadowing practice.',citations:[]})}}]}),{status:200});};}''')
    args={'selectedText':'shadowing','selectedIds':[record['sentences'][0]['id']],'currentTime':1}
    assert rpc('TASK',recordId=record['id'],capability='explain',args=args)['data']['cached']==False
    page.reload();page.wait_for_load_state('networkidle')
    args['currentTime']=2
    assert rpc('TASK',recordId=record['id'],capability='explain',args=args)['data']['cached']==True
    assert worker.evaluate('explanationRequests')==1
    assert len(rpc('CHATS',recordId=record['id'])['data'])==1
    context.close()
with preview_server() as base,sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**chromium_options());page=browser.new_page(viewport={'width':430,'height':750});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''window.chrome={runtime:{id:'fixture',onMessage:{addListener:()=>{}},sendMessage:async m=>{
      if(m.type==='LOAD'){const {demoRecord}=await import('./demo.js');const r=demoRecord();r.sentences=Array.from({length:70},(_,i)=>({id:'s'+i,start:i*3,end:i*3+3,rawText:'Learning sentence '+i+'.'}));return {ok:true,data:{record:r,tracks:[]}};}
      if(m.type==='TASK'&&m.capability==='explain')return {ok:true,data:{answer:'中文解释。'.repeat(200),answerEn:'An English explanation. '.repeat(100),cached:true,citations:[]}};
      return {ok:true,data:['NOTES','CHATS'].includes(m.type)?[]:m.type==='GET_SETTINGS'?{apiKey:'FIXTURE'}:null};}},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v=fixture'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html');page.wait_for_load_state('networkidle');page.locator('.sentence').first.wait_for()
    page.evaluate('scrollTo(0,350)');page.wait_for_timeout(200)
    page.locator('.caption-original').nth(4).evaluate('''el=>{const range=document.createRange();range.setStart(el.firstChild,0);range.setEnd(el.firstChild,8);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));}''')
    note=page.locator('.selection-note');note.hover();page.wait_for_timeout(200)
    assert note.evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(34, 68, 50)'
    assert note.evaluate('(el)=>getComputedStyle(el).color')=='rgb(255, 255, 255)'
    page.screenshot(path=str(ROOT/'docs/screenshots/selection-note-hover-1.0.27.png'))
    page.locator('.selection-explain').click();expect(page.locator('#explain-source')).to_contain_text('未调用模型')
    modal=page.locator('#explain-dialog');top=page.evaluate('scrollY');box=modal.bounding_box()
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.wheel(0,500);page.wait_for_timeout(250)
    assert modal.evaluate('(el)=>el.scrollTop')>0;assert page.evaluate('scrollY')==top
    page.mouse.wheel(0,20000);page.wait_for_timeout(250);assert page.evaluate('scrollY')==top
    page.mouse.move(3,400);page.mouse.wheel(0,500);page.wait_for_timeout(250);assert page.evaluate('scrollY')==top
    modal.evaluate('(el)=>el.scrollTop=0');page.locator('#close-explain').click();assert page.evaluate('scrollY')==top
    page.evaluate('getSelection().removeAllRanges()');page.mouse.move(200,450);page.mouse.wheel(0,350);page.wait_for_timeout(250);assert page.evaluate('scrollY')>top
    assert not errors,errors;browser.close()
print('Explanation checks passed: real wheel containment, scroll restore, visible note hover, persistent cache after reload, one model request and no duplicate history.')
