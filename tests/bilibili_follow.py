"""An already-playing Bilibili video resumes subtitle following on panel open."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server

with preview_server() as base, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, **chromium_options())
    page = browser.new_page(viewport={'width': 430, 'height': 700})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('''
      window.ticks=[];
      window.chrome={
        runtime:{id:'fixture',getURL:path=>path,onMessage:{addListener:fn=>ticks.push(fn)},sendMessage:async message=>{
          const ok=data=>({ok:true,data});
          if(message.type==='LOAD'){
            const {demoRecord}=await import('./demo.js');const record=demoRecord();
            record.id='bili-fixture';record.videoKey='bilibili:BVfixture:1';
            record.videoInfo={...record.videoInfo,platform:'bilibili',videoId:'BVfixture',page:1,duration:600};
            record.sentences=Array.from({length:200},(_,i)=>({id:'s'+i,start:i*3,end:i*3+3,rawText:'B站句子 '+i,sourceIds:[]}));
            return ok({record,tracks:[]});
          }
          if(message.type==='PLAYER_COMMAND'&&message.command.action==='state')return ok({videoKey:'bilibili:BVfixture:1',time:450,paused:false,rate:1});
          return ok(['NOTES','CHATS'].includes(message.type)?[]:{});
        }},
        tabs:{query:async()=>[{id:1,url:'https://www.bilibili.com/video/BVfixture/'}],onActivated:{addListener:()=>{}}},
        storage:{local:{get:async key=>({[key]:{'recordId':'bili-fixture','mode':'original','scrollY':180,'followPlayback':false}}),set:async()=>{}},onChanged:{addListener:()=>{}}}
      };
    ''')
    page.goto(base+'/extension/panel/index.html')
    expect(page.locator('#play-time')).to_have_text('07:30')
    expect(page.locator('#transcript')).to_have_attribute('data-follow-playback', 'true')
    expect(page.locator('.sentence.active .sentence-body')).to_have_text('B站句子 150')
    def visible(index):
        row = page.locator(f'.sentence[data-id="s{index}"]')
        return row.evaluate('''node=>{
          const box=node.getBoundingClientRect();
          return box.top>=document.querySelector('.tabs').getBoundingClientRect().bottom+4
            && box.bottom<=document.querySelector('footer').getBoundingClientRect().top-4;
        }''')
    assert visible(150)
    page.evaluate("ticks.forEach(fn=>fn({type:'EVENT',event:'PLAYER_TICK',tabId:1,videoKey:'bilibili:BVfixture:1',time:540,paused:false,rate:1}))")
    expect(page.locator('.sentence.active .sentence-body')).to_have_text('B站句子 180')
    assert visible(180)
    assert not errors, errors
    browser.close()
print('Bilibili following passed: opening mid-play restores follow and pages to the live sentence.')
