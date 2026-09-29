from playwright.sync_api import sync_playwright
from pathlib import Path
import tempfile,json
from browser_support import chromium_options
ROOT=Path(__file__).resolve().parents[1]
CHROME=Path.home()/'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
with sync_playwright() as p:
    with tempfile.TemporaryDirectory(prefix='cuemind-chrome-') as profile:
        ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
        worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        extension_id=worker.url.split('/')[2]
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'chrome-extension://{extension_id}/panel/index.html');page.wait_for_load_state('networkidle')
        def rpc(kind,**data):
            return page.evaluate('(m)=>chrome.runtime.sendMessage(m)',{'type':kind,**data})
        settings=rpc('GET_SETTINGS');assert settings['ok'],settings
        data=rpc('IMPORT',info={'platform':'youtube','videoId':'test-video','page':1,'title':'Integration test','author':'Test','duration':10,'url':'https://www.youtube.com/watch?v=test-video'},raw=[{'start':0,'end':2,'text':'This is a test.'},{'start':3,'end':6,'text':'Learning should preserve evidence.'}])
        assert data['ok'],data
        record=data['data'];assert len(record['sentences'])==2
        note=rpc('SAVE_NOTE',note={'recordId':record['id'],'videoKey':record['videoKey'],'body':'Persistent test note','sourceText':'This is a test.','timestamp':0,'sentenceIds':[record['sentences'][0]['id']]})
        assert note['ok'],note
        page.reload();page.wait_for_load_state('networkidle')
        notes=rpc('NOTES',recordId=record['id']);assert len(notes['data'])==1,notes
        blocked=rpc('TASK',recordId=record['id'],capability='boundary');assert not blocked['ok'] and '笔记' in blocked['error'],blocked
        config=settings['data'];config['apiKey']='TEST-SECRET-NEVER-EXPORT';config['asrKey']='ASR-SECRET-NEVER-EXPORT';config['domesticAsrKey']='DOMESTIC-SECRET-NEVER-EXPORT';config['asrRouting']='platform'
        assert rpc('SAVE_SETTINGS',settings=config)['ok']
        backup=rpc('BACKUP');assert backup['ok'],backup
        assert 'TEST-SECRET' not in json.dumps(backup)
        assert 'ASR-SECRET' not in json.dumps(backup)
        assert 'DOMESTIC-SECRET' not in json.dumps(backup)
        restored=rpc('RESTORE',backup=backup['data']);assert restored['ok'],restored
        assert len(rpc('NOTES',recordId=record['id'])['data'])==1
        restored_settings=rpc('GET_SETTINGS');assert restored_settings['ok'];assert restored_settings['data']['apiKey']=='TEST-SECRET-NEVER-EXPORT';assert restored_settings['data']['asrKey']=='ASR-SECRET-NEVER-EXPORT'
        assert restored_settings['data']['domesticAsrKey']=='DOMESTIC-SECRET-NEVER-EXPORT'
        second=rpc('IMPORT',info=record['videoInfo'],raw=record['rawCaptions'])
        assert second['ok'] and second['data']['id']!=record['id'],second
        corrupt=json.loads(json.dumps(backup['data']))
        corrupt['notes'].append({'id':'invalid-late-record'})
        corrupt['videos'][0]['videoInfo']['title']='MUST NOT WRITE'
        assert not rpc('RESTORE',backup=corrupt)['ok']
        assert rpc('GET_RECORD',recordId=record['id'])['data']['videoInfo']['title']=='Integration test'
        changed=json.loads(json.dumps(backup['data']))
        changed['settings']['baseUrl']='https://different.invalid/v1'
        changed['settings']['asrUrl']='https://different.invalid/v1'
        changed['settings']['apiKey']='FORGED'
        changed['settings']['domesticAsrUrl']='https://different.invalid/v1'
        changed['settings']['domesticAsrKey']='FORGED'
        assert rpc('RESTORE',backup=changed)['ok']
        clean=rpc('GET_SETTINGS')['data'];assert clean['apiKey']=='' and clean['asrKey']=='' and clean['domesticAsrKey']==''
        # Locks are acquired before the first asynchronous database read.
        parallel=page.evaluate('async id=>Promise.all([1,2].map(()=>chrome.runtime.sendMessage({type:"TASK",recordId:id,capability:"translation"})))',second['data']['id'])
        assert sum(bool(x['ok']) for x in parallel)==1,parallel
        assert any('正在处理' in x.get('error','') for x in parallel),parallel
        recorder=ctx.new_page()
        recorder.add_init_script('''
          window.stoppedTracks=0;
          Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>({getTracks:()=>[{stop:()=>window.stoppedTracks++}]})});
          window.AudioContext=class{constructor(){throw new Error('TEST_AUDIO_FAILURE')}};
        ''')
        recorder.goto(f'chrome-extension://{extension_id}/offscreen/index.html')
        recorder.wait_for_load_state('networkidle')
        failed=worker.evaluate('()=>chrome.runtime.sendMessage({target:"offscreen",type:"START",recordId:"test",streamId:"test",settings:{}})')
        assert failed and not failed['ok'] and 'TEST_AUDIO_FAILURE' in failed['error'],failed
        assert recorder.evaluate('window.stoppedTracks')==1
        retried=worker.evaluate('()=>chrome.runtime.sendMessage({target:"offscreen",type:"START",recordId:"test",streamId:"test",settings:{}})')
        assert 'TEST_AUDIO_FAILURE' in retried['error'],retried
        recorder.close()
        assert not errors,errors
        print('Extension integration passed:',extension_id,'service worker, trusted messages, IndexedDB, restart-page persistence, reference lock, backup redaction, restore.')
        ctx.close()
