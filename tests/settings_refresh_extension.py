"""Save via the real settings UI and refresh/restart an isolated unpacked extension."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options
from pathlib import Path
import tempfile
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p,tempfile.TemporaryDirectory(prefix='cuemind-refresh-') as profile:
 args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension']
 def launch():
  ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=args)
  worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
  page=ctx.new_page();page.goto('chrome-extension://'+worker.url.split('/')[2]+'/panel/settings.html');page.wait_for_load_state('networkidle')
  return ctx,page
 ctx,page=launch()
 cfg=page.evaluate('async()=> (await chrome.runtime.sendMessage({type:"GET_SETTINGS"})).data')
 cfg.update(provider='deepseek',baseUrl='https://api.deepseek.com',model='deepseek-flash',apiKey='fixture-text-key',asrUrl='https://api.groq.com/openai/v1',asrModel='whisper-large-v3-turbo',asrKey='fixture-speech-key')
 assert page.evaluate('(settings)=>chrome.runtime.sendMessage({type:"SAVE_SETTINGS",settings})',cfg)['ok']
 page.reload();page.wait_for_load_state('networkidle')
 page.locator('#transcriptProvider').select_option('fallback');page.locator('#supadataApiKey').fill('fixture-subtitle-key')
 page.get_by_role('button',name='保存设置',exact=True).click()
 try:expect(page.locator('#save-status')).to_contain_text('已保存',timeout=5000)
 except Exception:
  print('Invalid form fields:',page.locator('#settings-form :invalid').evaluate_all('(els)=>els.map(e=>({id:e.id,message:e.validationMessage}))'))
  print('Status:',page.locator('#save-status').inner_text());raise
 for i in range(10):
  page.reload();page.wait_for_load_state('networkidle')
  for key,value in [('transcriptProvider','fallback'),('supadataApiKey','fixture-subtitle-key'),('apiKey','fixture-text-key'),('asrKey','fixture-speech-key')]:expect(page.locator('#'+key)).to_have_value(value)
 ctx.close()
 ctx,page=launch()
 for key,value in [('transcriptProvider','fallback'),('supadataApiKey','fixture-subtitle-key'),('apiKey','fixture-text-key'),('asrKey','fixture-speech-key')]:expect(page.locator('#'+key)).to_have_value(value)
 page.locator('#storage-usage').click()
 expect(page.locator('#storage-usage-result')).to_contain_text('模型响应缓存 0 条')
 usage=page.evaluate('async()=>await chrome.runtime.sendMessage({type:"STORAGE_USAGE"})')
 assert usage['ok'] and usage['data']['localBytes']>0
 assert 'fixture-subtitle-key' not in str(usage) and 'apiKey' not in str(usage)
 expect(page.locator('#supadataApiKey')).to_have_value('fixture-subtitle-key')
 ctx.close()
print('Real extension settings passed: UI save, ten refreshes, full browser restart; subtitle provider and all three keys retained. Isolated fixture only; no provider requests.')
