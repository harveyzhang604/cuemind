"""Real Chrome decode/change detection/storage/export; model responses are fixtures."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_options
import base64, tempfile, time, re, zipfile, json

def json_time(call): return json.loads(call["messages"][1]["content"][0]["text"])["timestamp"]

ROOT = Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix='cuemind-materials-') as temporary:
    folder = Path(temporary)
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(str(folder / 'profile'), headless=True, **chromium_options(), args=[f'--disable-extensions-except={ROOT}/extension', f'--load-extension={ROOT}/extension', '--autoplay-policy=no-user-gesture-required'])
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        extension_id = worker.url.split('/')[2]
        encoder = context.new_page()
        video = encoder.evaluate(r"""async()=>{
          const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
          const drawing=canvas.getContext('2d'),stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
          const chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
          const texts=['class Model:\n    value = 1\n    def forward(self, x):\n        return x + self.value','class Model:\n    value = 2\n    def forward(self, x):\n        return x + self.value','Course summary\nTransformer attention\nSave your original source files'];
          recorder.ondataavailable=e=>chunks.push(e.data);
          const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();const began=performance.now();
          const draw=()=>{drawing.fillStyle='#fafafa';drawing.fillRect(0,0,1280,720);drawing.fillStyle='#183b2b';drawing.font='30px monospace';texts[(performance.now()-began)<9000?0:(performance.now()-began)<12000?1:2].split('\n').forEach((line,i)=>drawing.fillText(line,70,100+i*60));const t=(performance.now()-began)/1000;
          // Pointer motion and long stationary pauses on one unchanged page.
          const step=Math.floor(t*2),px=150+(Math.floor(step/3)%6)*110,py=240+(Math.floor(step/7)%2)*90;
          drawing.fillStyle='#111';drawing.beginPath();drawing.moveTo(px,py);drawing.lineTo(px,py+30);drawing.lineTo(px+7,py+23);drawing.lineTo(px+13,py+35);drawing.lineTo(px+18,py+32);drawing.lineTo(px+12,py+21);drawing.lineTo(px+24,py+21);drawing.closePath();drawing.fill();
          const lx=280+(step%5)*125,ly=380;
          const glow=drawing.createRadialGradient(lx,ly,0,lx,ly,15);glow.addColorStop(0,'rgba(255,0,0,1)');glow.addColorStop(.25,'rgba(255,0,0,.9)');glow.addColorStop(1,'rgba(255,0,0,0)');drawing.fillStyle=glow;drawing.fillRect(lx-15,ly-15,30,30);
          if(step%2){drawing.fillStyle='#111';drawing.fillRect(960,150,2,26);}track.requestFrame();};
          draw();const timer=setInterval(draw,100);await new Promise(r=>setTimeout(r,15200));clearInterval(timer);recorder.stop();await done;track.stop();
          const reader=new FileReader();const result=new Promise(resolve=>reader.onload=()=>resolve(reader.result));reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));return result;
        }""")
        (Path(tempfile.gettempdir())/'cuemind-pointer-fixture.webm').write_bytes(base64.b64decode(video.split(',',1)[1]))
        encoder.close()
        page = context.new_page()
        media_url='https://rr1---fixture.googlevideo.com/videoplayback?id=materials-fixture'
        media_bytes=base64.b64decode(video.split(',',1)[1])
        context.route('https://rr1---fixture.googlevideo.com/**', lambda route: route.fulfill(body=media_bytes,headers={'Content-Type':'video/webm','Access-Control-Allow-Origin':'*'}))
        html = f'<html><body style="margin:0"><div id="movie_player"><video onloadedmetadata="if(!Number.isFinite(this.duration))this.currentTime=1e6" style="width:960px;height:540px" controls muted src="{video}"></video></div><script>window.ytInitialPlayerResponse={{videoDetails:{{videoId:"materialsfixture"}},streamingData:{{adaptiveFormats:[{{url:"{media_url}",mimeType:"video/webm",codecs:"vp8",height:720}}]}}}};</script></body></html>'
        context.route('https://www.youtube.com/**', lambda route: route.fulfill(body=html, content_type='text/html'))
        page.goto('https://www.youtube.com/watch?v=materialsfixture')
        page.wait_for_function('document.querySelector("video").readyState>=2')
        page.evaluate('document.querySelector("video").currentTime=1e6')
        page.wait_for_function('Number.isFinite(document.querySelector("video").duration)')
        tid = worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.youtube.com/watch?v=materialsfixture"}))[0].id')
        record = {'id': 'materials-fixture-record', 'videoKey': 'youtube:materialsfixture:1', 'videoInfo': {'platform': 'youtube', 'videoId': 'materialsfixture', 'page': 1, 'duration': 15, 'title': 'Video code fixture', 'url': 'https://www.youtube.com/watch?v=materialsfixture'}, 'transcriptMeta': {'source': 'import'}, 'rawCaptions': [], 'sentences': [], 'paragraphs': [], 'updatedAt': 1}
        rpc_page = context.new_page()
        rpc_page.goto(f'chrome-extension://{extension_id}/panel/settings.html')
        record['videoMaterials']={'version':1,'model':'deepseek-flash','frames':[],'run':{'scope':'all','status':'canceled','completedThrough':6}}
        rpc_page.evaluate("""async r=>{const db=await import('../storage/db.js');await db.put('videos',r);await chrome.storage.local.set({['watch:'+r.videoKey]:{time:1,updatedAt:1},settings:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-pro',apiKey:'fixture-test-key'}});}""",record)
        worker.evaluate('''async()=>{self.modelCalls=[];self.nativeFetch=self.fetch;self.fetch=async(url,options)=>{if(String(url).startsWith('https://api.deepseek.com/')){const body=JSON.parse(options.body);if(self.failMaterials)return Response.json({error:{message:'fixture'}},{status:400});self.modelCalls.push(body);const time=JSON.parse(body.messages[1].content[0].text).timestamp;if(self.delayMaterials)await new Promise(r=>setTimeout(r,2000));const content=time<9?'class Model:\\n    value = 1':time<12?'class Model:\\n    value = 2':'Course summary\\nTransformer attention';if(self.modelCalls.length===1)await new Promise(r=>setTimeout(r,4200));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{kind:time<12?'code':'slide',title:time<12?'Model':'Summary',language:time<12?'python':'',content,partial:false,uncertainties:[]}]})}}]});}return self.nativeFetch(url,options);};}''')
        def rpc(kind, **values):
            reply = rpc_page.evaluate('async m=>await chrome.runtime.sendMessage(m)', {'type': kind, **values})
            assert reply['ok'], reply
            return reply['data']
        # Offscreen targets are intentionally absent from Playwright's page
        # routing. Stub only their remote fixture download via a CDP session;
        # actual Blob decoding, seeking, signatures, storage and export stay real.
        worker.evaluate("""async()=>{if(!(await chrome.offscreen.hasDocument()))await chrome.offscreen.createDocument({url:'offscreen/index.html',reasons:['BLOBS'],justification:'Browser fixture for independent video decoding'});} """)
        browser_cdp=context.browser.new_browser_cdp_session()
        target=next(t for t in browser_cdp.send('Target.getTargets')['targetInfos'] if t['url']==f'chrome-extension://{extension_id}/offscreen/index.html')
        attached=browser_cdp.send('Target.attachToTarget',{'targetId':target['targetId']})['sessionId']
        injection="self.mediaNativeFetch=self.fetch;self.fetch=(url,options)=>(String(url).includes('googlevideo.com')||String(url).includes('bilivideo.com'))?(self.failDownload?Promise.resolve(new Response('fixture',{status:403})):self.mediaNativeFetch("+json.dumps(video)+",options)):self.mediaNativeFetch(url,options);"
        cdp_results=[]
        browser_cdp.on('Target.receivedMessageFromTarget',lambda message:cdp_results.append(json.loads(message['message'])))
        browser_cdp.send('Target.sendMessageToTarget',{'sessionId':attached,'message':json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':injection}})})
        rpc_page.wait_for_timeout(100)
        assert any(message.get('id')==1 and 'error' not in message for message in cdp_results),cdp_results
        page.evaluate('''async()=>{const v=document.querySelector('video');v.currentTime=1;v.playbackRate=1.25;v.pause();}''')
        page.wait_for_function('!document.querySelector("video").seeking')
        page.evaluate('''()=>{window.playerChanges=[];for(const event of ['play','seeking','ratechange'])document.querySelector('video').addEventListener(event,()=>playerChanges.push(event));}''')
        started=time.monotonic()
        rpc_page.evaluate('m=>{window.scanDone=false;chrome.runtime.sendMessage(m).then(r=>{window.scanReply=r;window.scanDone=true;});}', {'type':'MATERIALS_EXTRACT','recordId':record['id'],'tabId':tid,'options':{'mode':'beginning'}})
        rpc_page.wait_for_function('()=>window.scanDone', timeout=40000)
        elapsed=time.monotonic()-started
        print('Background scan wall time:',round(elapsed,2),'seconds for',15,'seconds of video',flush=True)
        assert elapsed<13,elapsed
        assert page.evaluate('window.playerChanges')==[],page.evaluate('window.playerChanges')
        reply = rpc_page.evaluate('window.scanReply'); assert reply['ok'], reply
        materials = rpc('MATERIALS_GET', recordId=record['id'])
        assert materials['data']['run']['status']=='done', materials
        assert materials['data']['run']['scope']=='beginning' and materials['data']['frames'][0]['time']<0.8,materials
        values = [i['content'] for f in materials['data']['frames'] for i in f['items']]
        print('Content changes detected at:',[round(f['time'],2) for f in materials['data']['frames']],flush=True)
        assert any('value = 1' in value for value in values), values
        assert any('value = 2' in value for value in values), values
        assert any('Course summary' in value for value in values), values
        calls = worker.evaluate('self.modelCalls')
        assert 3<=len(calls)<=5, len(calls)
        early=[call for call in calls if json_time(call)<9]
        assert len(early)==1,[json_time(call) for call in calls]
        assert all(call['model']=='deepseek-flash' and call['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,') for call in calls)
        assert all(len(call['messages'][1]['content'][1]['image_url']['url'])>1000 for call in calls)
        page.wait_for_function('!document.querySelector("video").seeking')
        state = page.evaluate('''()=>{const v=document.querySelector('video');return {time:v.currentTime,rate:v.playbackRate,paused:v.paused};}''')
        assert abs(state['time']-1)<0.1 and state['rate']==1.25 and state['paused'], state
        watch=rpc_page.evaluate("async key=>(await chrome.storage.local.get(key))[key]",'watch:'+record['videoKey'])
        assert abs(watch['time']-1)<0.1,watch
        after = rpc('GET_RECORD', recordId=record['id'])
        assert after['rawCaptions']==[] and after['sentences']==[]

        # Use the production dialog/module, real saved data and actual downloads.
        document = (ROOT/'extension/panel/index.html').read_text()
        dialog = re.search(r'<dialog id="materials-dialog".*?</dialog>', document, re.S).group()
        rpc_page.set_viewport_size({'width':430,'height':760})
        rpc_page.evaluate('html=>{document.body.innerHTML=html;}', dialog)
        rpc_page.evaluate('''async ({record,tid})=>{const {createMaterialsUI}=await import('./materials-ui.js');window.ui=createMaterialsUI({getContext:()=>({record,tabId:tid,localAudioMode:false}),rpc:async(type,data)=>{const r=await chrome.runtime.sendMessage({type,...data});if(!r.ok)throw new Error(r.error);return r.data;},error:e=>{window.uiError=e.message;},ext:true});await window.ui.open();}''', {'record':record,'tid':tid})
        expect(rpc_page.locator('#materials-results details')).to_have_count(3)
        assert rpc_page.locator('#materials-dialog').evaluate('(d)=>d.scrollWidth<=d.clientWidth+1')
        rpc_page.screenshot(path=str(Path(tempfile.gettempdir())/'cuemind-materials-dialog.png'))
        assert rpc_page.locator('#materials-dialog input[type=number]').count()==0
        expect(rpc_page.locator('#materials-mode option[value=beginning]')).to_have_text('从开头到结尾')
        assert rpc_page.locator('#materials-mode').input_value()=='beginning'
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-code')
        exported = Path(download.value.path()).read_text()
        assert 'value = 1' in exported and 'value = 2' in exported and 'Course summary' not in exported
        assert '```python' in exported and re.search(r't=\d+', exported)
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-save')
        assert 'Course summary' in Path(download.value.path()).read_text()

        # Resume a beginning-to-end scan that was interrupted at six seconds.
        rpc_page.evaluate("""async id=>{const db=await import('../storage/db.js');const r=await db.get('videos',id);r.videoMaterials.run.status='canceled';r.videoMaterials.run.completedThrough=6;await db.put('videos',r);}""",record['id'])
        images=materials['images']
        assert len(images)>=3 and len(images)<=5,images
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-zip')
        with zipfile.ZipFile(download.value.path()) as package:
            assert package.testzip() is None
            pictures=[name for name in package.namelist() if name.startswith('screenshots/')]
            assert len(pictures)==len(images),package.namelist()
            assert all(package.read(name).startswith(b'\xff\xd8') for name in pictures)
            course=package.read('materials.md').decode()
            assert all(name in course for name in pictures)
            assert 'code.md' in package.namelist()
        with rpc_page.expect_download() as download:
            rpc_page.locator('#materials-images > summary').click()
            rpc_page.locator('#materials-image-list details').first.locator('summary').click()
            rpc_page.locator('#materials-image-list details').first.get_by_role('button',name='保存截图',exact=True).click()
        assert Path(download.value.path()).read_bytes().startswith(b'\xff\xd8')
        rpc_page.locator('#materials-image-list details').first.get_by_role('button',name='查看截图',exact=True).click()
        rpc_page.wait_for_function('document.querySelector(".materials-photo")?.naturalWidth>0')
        rpc_page.screenshot(path=str(Path(tempfile.gettempdir())/'cuemind-materials-screenshots.png'))
        # Same code with different OCR spacing must share a screenshot in both
        # the production gallery and ZIP; all originals remain downloadable.
        rpc_page.evaluate("""async snapshot=>{document.querySelector('#materials-dialog').close();
          const first=snapshot.data.frames[0];snapshot.data.frames[1].items=structuredClone(first.items);
          snapshot.data.frames[1].items[0].content=first.items[0].content.replace(' = ', '=');
          const {createMaterialsUI}=await import('./materials-ui.js');
          window.ui=createMaterialsUI({getContext:()=>({record:window.galleryRecord}),rpc:async(type,args)=>type==='MATERIALS_GET'?snapshot:(await chrome.runtime.sendMessage({type,...args})).data,error:e=>window.uiError=e.message,ext:true});
          await window.ui.open();} """, rpc_page.evaluate("""async id=>{window.galleryRecord=(await chrome.runtime.sendMessage({type:'GET_RECORD',recordId:id})).data;return (await chrome.runtime.sendMessage({type:'MATERIALS_GET',recordId:id})).data;}""",record['id']))
        expect(rpc_page.locator('#materials-image-list > details')).to_have_count(2)
        expect(rpc_page.locator('#materials-frame-stats')).to_contain_text('去重后 2 张截图')
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-zip')
        with zipfile.ZipFile(download.value.path()) as package:
            assert package.testzip() is None and len([n for n in package.namelist() if n.endswith('.jpg')])==2
        rpc_page.check('#materials-all-images')
        expect(rpc_page.locator('#materials-image-list > details')).to_have_count(3)
        summaries=rpc_page.locator('#materials-image-list > details > summary').all_text_contents()
        assert summaries==sorted(summaries),summaries
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-zip')
        with zipfile.ZipFile(download.value.path()) as package:
            assert package.testzip() is None and len([n for n in package.namelist() if n.endswith('.jpg')])==3
            assert json.loads(package.read('materials.json'))['allImages'] is True
        rpc_page.uncheck('#materials-all-images')
        expect(rpc_page.locator('#materials-image-list > details')).to_have_count(2)
        rpc_page.evaluate("""async ({record,tid})=>{document.querySelector('#materials-dialog').close();const {createMaterialsUI}=await import('./materials-ui.js');window.ui=createMaterialsUI({getContext:()=>({record,tabId:tid,localAudioMode:false}),rpc:async(type,args)=>{const r=await chrome.runtime.sendMessage({type,...args});if(!r.ok)throw new Error(r.error);return r.data;},error:e=>window.uiError=e.message,ext:true});await window.ui.open();}""",{'record':record,'tid':tid})
        # Cancellation keeps prior results and still releases/restores the player.
        worker.evaluate('self.delayMaterials=true')
        rpc_page.evaluate('m=>{window.scanDone=false;chrome.runtime.sendMessage(m).then(r=>{window.scanReply=r;window.scanDone=true;});}', {'type':'MATERIALS_EXTRACT','recordId':record['id'],'tabId':tid,'options':{'mode':'all'}})
        rpc_page.wait_for_function('''async id=>{const r=await chrome.runtime.sendMessage({type:'MATERIALS_GET',recordId:id});return r.data?.running && r.data?.data?.run?.phase==='analyzing';}''',arg=record['id'],timeout=10000)
        rpc('CANCEL',recordId=record['id'],capability='materials')
        rpc_page.wait_for_function('()=>window.scanDone',timeout=10000)
        worker.evaluate('self.delayMaterials=false')
        canceled = rpc('MATERIALS_GET',recordId=record['id'])
        assert canceled['data']['run']['status']=='canceled' and len(canceled['data']['frames'])>=3
        state = rpc('PLAYER_COMMAND', tabId=tid,command={'action':'state','videoKey':record['videoKey']})
        assert not state['captureLocked'] and state['paused'] and abs(state['time']-1)<0.1, state

        # Existing results remain exportable after the source video is closed.
        page.close()
        rpc_page.evaluate('document.querySelector("#materials-dialog").close()')
        rpc_page.evaluate('async()=>await window.ui.open()')
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-save')
        assert 'value = 2' in Path(download.value.path()).read_text()
        with rpc_page.expect_download() as download:
            rpc_page.click('#materials-zip')
        with zipfile.ZipFile(download.value.path()) as package:
            assert len([name for name in package.namelist() if name.startswith('screenshots/')])>=3
        assert not rpc_page.evaluate('window.uiError || ""')

        # Bilibili page/player identity and current-frame-only mode.
        context.route('https://www.bilibili.com/**', lambda route: route.fulfill(body=html, content_type='text/html'))
        bili = context.new_page()
        bili.goto('https://www.bilibili.com/video/BVmaterialsfixture/?p=2')
        bili.wait_for_function('document.querySelector("video").readyState>=2')
        bid = worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.bilibili.com/video/BVmaterialsfixture/*"}))[0].id')
        bili_record = {**record, 'id':'bilibili-materials-record', 'videoKey':'bilibili:BVmaterialsfixture:2', 'videoInfo':{**record['videoInfo'], 'platform':'bilibili', 'videoId':'BVmaterialsfixture', 'page':2, 'url':'https://www.bilibili.com/video/BVmaterialsfixture/?p=2'}}
        rpc_page.evaluate("async r=>{const db=await import('../storage/db.js');await db.put('videos',r);}",bili_record)
        before_calls = worker.evaluate('self.modelCalls.length')
        result = rpc('MATERIALS_EXTRACT',recordId=bili_record['id'],tabId=bid,options={'mode':'current'})
        assert result['run']['status']=='done' and result['run']['scope']=='current'
        assert worker.evaluate('self.modelCalls.length')==before_calls+1
        state = rpc('PLAYER_COMMAND',tabId=bid,command={'action':'state','videoKey':bili_record['videoKey']})
        assert state['paused'] and not state['captureLocked']

        # Bilibili uses per-part sources and an independent decoder; a real UI
        # click must automatically download the complete picture/text ZIP.
        context.route('https://api.bilibili.com/**',lambda route:route.fulfill(json=({'data':{'pages':[{'cid':111},{'cid':222}]}} if '/view?' in route.request.url else {'code':0,'data':{'dash':{'video':[{'baseUrl':'https://fixture.bilivideo.com/video','mimeType':'video/webm','codecs':'vp8','height':720}]}}}),headers={'Access-Control-Allow-Origin':'https://www.bilibili.com','Access-Control-Allow-Credentials':'true'}))
        bili.evaluate("()=>{window.playerChanges=[];for(const event of ['play','seeking','ratechange'])document.querySelector('video').addEventListener(event,()=>playerChanges.push(event));}")
        rpc_page.evaluate('''async ({record,tid})=>{document.querySelector('#materials-dialog').close();const {createMaterialsUI}=await import('./materials-ui.js');window.ui=createMaterialsUI({getContext:()=>({record,tabId:tid,localAudioMode:false}),rpc:async(type,data)=>{const r=await chrome.runtime.sendMessage({type,...data});if(!r.ok)throw new Error(r.error);return r.data;},error:e=>{window.uiError=e.message;},ext:true});await window.ui.open();}''',{'record':bili_record,'tid':bid})
        with rpc_page.expect_download(timeout=20000) as download:
            rpc_page.click('#materials-start')
        with zipfile.ZipFile(download.value.path()) as package:
            assert package.testzip() is None and len([n for n in package.namelist() if n.endswith('.jpg')])>=3
        assert bili.evaluate('window.playerChanges')==[]
        assert not worker.evaluate('chrome.declarativeNetRequest.getSessionRules()')
        before_calls=worker.evaluate('self.modelCalls.length')-1
        # A CDN 403 falls back to an owned inactive, muted page. The original
        # player remains untouched and the helper is removed when finished.
        browser_cdp.send('Target.sendMessageToTarget',{'sessionId':attached,'message':json.dumps({'id':2,'method':'Runtime.evaluate','params':{'expression':'self.failDownload=true'}})})
        rpc_page.wait_for_timeout(50)
        failed_download=rpc_page.evaluate('async m=>await chrome.runtime.sendMessage(m)',{'type':'MATERIALS_EXTRACT','recordId':bili_record['id'],'tabId':bid,'options':{'mode':'beginning'}})
        assert failed_download['ok'],failed_download
        assert len(rpc('MATERIALS_GET',recordId=bili_record['id'])['data']['frames'])>=3
        assert bili.evaluate('window.playerChanges')==[]
        assert not worker.evaluate('chrome.declarativeNetRequest.getSessionRules()')
        assert len(worker.evaluate('chrome.tabs.query({url:"https://www.bilibili.com/video/BVmaterialsfixture/*"})'))==1
        before_calls=worker.evaluate('self.modelCalls.length')-1
        browser_cdp.send('Target.sendMessageToTarget',{'sessionId':attached,'message':json.dumps({'id':3,'method':'Runtime.evaluate','params':{'expression':'self.failDownload=false'}})})

        # A different Bilibili part must not be captured under this record.
        bili.goto('https://www.bilibili.com/video/BVmaterialsfixture/?p=3')
        wrong = rpc_page.evaluate('async m=>await chrome.runtime.sendMessage(m)',{'type':'MATERIALS_EXTRACT','recordId':bili_record['id'],'tabId':bid,'options':{'mode':'current'}})
        assert not wrong['ok'] and '对应' in wrong['error'],wrong
        assert worker.evaluate('self.modelCalls.length')==before_calls+1

        # Exercise the CORS fallback with a real browser screenshot. Stub only
        # the privileged capture API; decoding and cropping run in the worker.
        bili.goto('https://www.bilibili.com/video/BVmaterialsfixture/?p=2')
        bili.wait_for_function('document.querySelector("video").readyState>=2')
        bili.bring_to_front()
        screenshot='data:image/png;base64,'+base64.b64encode(bili.screenshot()).decode()
        rpc_page.evaluate("""async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{globalThis.materialsOriginalToDataURL=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=()=>{throw new DOMException('tainted','SecurityError');};}})""",bid)
        worker.evaluate("""image=>{self.captureOriginal=chrome.tabs.captureVisibleTab;self.captureCount=0;chrome.tabs.captureVisibleTab=async()=>{self.captureCount++;return image;};}""",screenshot)
        result=rpc('MATERIALS_EXTRACT',recordId=bili_record['id'],tabId=bid,options={'mode':'current'})
        assert result['run']['status']=='done' and worker.evaluate('self.captureCount')==1
        captured=worker.evaluate('self.modelCalls.at(-1).messages[1].content[1].image_url.url')
        dimensions=rpc_page.evaluate("""image=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve([img.width,img.height]);img.onerror=reject;img.src=image;})""",captured)
        assert dimensions==[960,540],dimensions

        # Switching tabs during capture discards the screenshot before upload.
        calls_before=worker.evaluate('self.modelCalls.length')
        worker.evaluate("""()=>{chrome.tabs.captureVisibleTab=async()=>{const other=await chrome.tabs.create({url:'about:blank',active:true});return 'data:image/png;base64,AAAA';};}""")
        race=rpc_page.evaluate('async m=>await chrome.runtime.sendMessage(m)',{'type':'MATERIALS_EXTRACT','recordId':bili_record['id'],'tabId':bid,'options':{'mode':'current'}})
        assert not race['ok'] and '标签页已切换' in race['error'],race
        assert worker.evaluate('self.modelCalls.length')==calls_before
        worker.evaluate('()=>{chrome.tabs.captureVisibleTab=self.captureOriginal;}')
        rpc_page.evaluate("""async id=>await chrome.scripting.executeScript({target:{tabId:id},func:()=>{HTMLCanvasElement.prototype.toDataURL=globalThis.materialsOriginalToDataURL;}})""",bid)
        worker.evaluate('()=>{self.failMaterials=true;}')
        failed_record={**bili_record,'id':'failed-ocr-materials-record'}
        rpc_page.evaluate("async r=>{const db=await import('../storage/db.js');await db.put('videos',r);}",failed_record)
        failed=rpc_page.evaluate('async m=>await chrome.runtime.sendMessage(m)',{'type':'MATERIALS_EXTRACT','recordId':failed_record['id'],'tabId':bid,'options':{'mode':'current'}})
        assert not failed['ok'],failed
        retained=rpc('MATERIALS_GET',recordId=failed_record['id'])
        assert retained['data']['run']['status']=='failed' and len(retained['images'])==1,retained
        jpeg=rpc('MATERIALS_IMAGE',recordId=failed_record['id'],imageId=retained['images'][0]['id'])
        assert base64.b64decode(jpeg['dataUrl'].split(',')[1]).startswith(b'\xff\xd8')
        foreign=rpc_page.evaluate('async m=>await chrome.runtime.sendMessage(m)',{'type':'MATERIALS_IMAGE','recordId':record['id'],'imageId':retained['images'][0]['id']})
        assert not foreign['ok'],foreign
        rpc('MANAGE_DATA',action='delete-notes',confirmed=True)
        assert len(rpc('MATERIALS_GET',recordId=failed_record['id'])['images'])==1
        rpc('DELETE_VIDEO_HISTORY',videoKey=bili_record['videoKey'])
        removed=rpc_page.evaluate("async id=>{const db=await import('../storage/db.js');return await db.get('frames',id);}",retained['images'][0]['id'])
        assert removed is None
        assert len(rpc('MATERIALS_GET',recordId=record['id'])['images'])>=3
        rpc('MANAGE_DATA',action='clear-cache',confirmed=True)
        assert rpc('MATERIALS_GET',recordId=record['id'])['images']==[]
        assert rpc('STORAGE_USAGE')['stores']['frames']['count']==0
        context.close()
        print('PASS: stationary page ignores mouse/laser/caret; code edit and slide change detected; screenshots persist before OCR, ZIP/JPEG export, offline export, ownership, cleanup, CORS crop and player restoration')
