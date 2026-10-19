"""Subtitle-language entry, all track choices, display separation and capture isolation."""
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options, preview_server
from pathlib import Path
import tempfile

with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**chromium_options())
    page=browser.new_page(viewport={'width':430,'height':850});errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script('''window.calls=[];window.listeners=[];window.chosen='en';window.noEnglish=false;window.otherCapture=false;
    window.languages=['en','ar','bn','nl','fr','de','he','hi','id','it','ja','ko','ml','pl','pt','pa','ru','es','ta','te','uk'];
    window.chrome={runtime:{id:'fixture',getURL:p=>p,onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{
      calls.push(m);let data=null;
      if(m.type==='LOAD'){
        const {demoRecord}=await import('./demo.js');const r=demoRecord();
        if(m.trackId&&m.trackId!=='auto')window.chosen=m.trackId;
        r.id='language-'+chosen;r.videoKey='youtube:language:1';r.videoInfo={...r.videoInfo,platform:'youtube',audioLanguage:'en-US',title:'Language fixture'};
        r.transcriptMeta={source:'youtube_native',language:chosen,trackId:chosen,isAi:true,selectedByUser:!!m.trackId&&m.trackId!=='auto'};
        r.sentences=[{id:'s0',start:0,end:10,rawText:chosen==='ar'?'نص عربي':'My thesis is that every company needs to learn.',sourceIds:[]}];r.paragraphs=[];
        data={record:r,tracks:languages.filter(lang=>!noEnglish||lang!=='en').map(lang=>({id:lang,language:lang,label:lang,isAi:true})),needsTrackSelection:noEnglish};
      }else if(m.type==='GET_SETTINGS')data={};
      else if(['NOTES','CHATS','TASK_STATUS'].includes(m.type))data=[];
      else if(m.type==='CAPTURE_STATUS')data=otherCapture?{tabId:99,recordId:'old-arabic-asr',completed:1}:null;
      else if(m.type==='GET_RECORD')throw new Error('An unrelated recording must not replace selected captions');
      else if(m.type==='PLAYER_COMMAND'&&m.command.action==='state')data={videoKey:'youtube:language:1',time:1,paused:true,rate:1};
      return {ok:true,data};
    }},tabs:{query:async()=>[{id:99,url:'https://www.youtube.com/watch?v=language'}],onActivated:{addListener:()=>{}}},storage:{onChanged:{addListener:()=>{}}}};''')
    page.goto(base+'/extension/panel/index.html')
    expect(page.locator('#subtitle-language')).to_have_text('字幕：英语')
    for width in [320,380,430,700]:
        page.set_viewport_size({'width':width,'height':850})
        expect(page.locator('#subtitle-language')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.locator('.transcript-toolbar').bounding_box()['height']<85
    page.set_viewport_size({'width':430,'height':850})
    page.locator('#subtitle-language').click()
    expect(page.locator('#subtitle-settings-dialog')).to_be_visible()
    expect(page.locator('#tracks option')).to_have_count(21)
    expect(page.locator('#tracks')).to_have_value('en')
    expect(page.locator('#subtitle-language-help')).to_contain_text('21 条')
    page.screenshot(path=str(Path(tempfile.gettempdir())/'cuemind-language-options.png'))
    page.locator('#tracks').select_option('ar')
    expect(page.locator('#subtitle-settings-dialog')).to_be_hidden()
    expect(page.locator('#subtitle-language')).to_have_text('字幕：阿拉伯语')
    expect(page.locator('.sentence-body').first).to_have_text('نص عربي')
    page.locator('#refresh').click()
    expect(page.locator('#subtitle-language')).to_have_text('字幕：阿拉伯语')
    page.evaluate('window.otherCapture=true')
    page.locator('#subtitle-language').click();page.locator('#tracks').select_option('en')
    expect(page.locator('#subtitle-language')).to_have_text('字幕：英语')
    expect(page.locator('.sentence-body').first).to_contain_text('My thesis')
    assert not page.evaluate("calls.some(m=>m.type==='GET_RECORD'&&m.recordId==='old-arabic-asr')")
    loads=page.evaluate("calls.filter(m=>m.type==='LOAD').length")
    page.locator('#transcript-mode').select_option('bilingual')
    expect(page.locator('#subtitle-language')).to_have_text('字幕：英语')
    assert page.evaluate("calls.filter(m=>m.type==='LOAD').length")==loads
    page.evaluate('window.noEnglish=true;window.otherCapture=false');page.locator('#refresh').click()
    expect(page.locator('#subtitle-settings-dialog')).to_be_visible()
    expect(page.locator('#tracks option:not([disabled])')).to_have_count(20)
    assert not errors,errors
    print('Subtitle language passed: 21 choices, remembered switch, display separation, English prompt, recording isolation and four widths.')
    browser.close()
