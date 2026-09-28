"""A failed settings read must never allow a default form to erase saved keys."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
with preview_server() as base,sync_playwright() as p:
 b=p.chromium.launch(headless=True,**chromium_options())
 for failure in ['error','reject']:
  page=b.new_page()
  page.add_init_script('''window.calls=[];window.chrome={runtime:{id:'fixture',sendMessage:async m=>{calls.push(m);if(m.type==='GET_SETTINGS'){const {defaults}=await import('../services/ai-provider.js');if(!sessionStorage.getItem('stored'))sessionStorage.setItem('stored',JSON.stringify({...defaults,transcriptProvider:'fallback',supadataApiKey:'fixture-subtitle-key',apiKey:'fixture-text-key',asrKey:'fixture-speech-key'}));const failure=sessionStorage.getItem('failure');if(failure==='reject')throw new Error('background unavailable');if(failure==='error')return {ok:false,error:'read failed'};return {ok:true,data:JSON.parse(sessionStorage.getItem('stored'))};}if(m.type==='DATA_STATS')return {ok:true,data:{videos:0,notes:0,chats:0}};if(m.type==='SAVE_SETTINGS'){sessionStorage.setItem('stored',JSON.stringify(m.settings));return {ok:true};}return {ok:false};}},permissions:{request:async()=>true}};''')
  page.goto(base+'/extension/panel/settings.html');expect(page.locator('#supadataApiKey')).to_have_value('fixture-subtitle-key')
  page.evaluate('(value)=>sessionStorage.setItem("failure",value)',failure);page.reload()
  expect(page.locator('#save-status')).to_contain_text('读取本地设置失败');expect(page.get_by_role('button',name='保存设置',exact=True)).to_be_disabled()
  page.locator('#settings-form').evaluate('(form)=>form.dispatchEvent(new Event("submit",{cancelable:true}))')
  assert not page.evaluate('calls.some(m=>m.type==="SAVE_SETTINGS")')
  assert page.evaluate('JSON.parse(sessionStorage.getItem("stored")).supadataApiKey')=='fixture-subtitle-key'
  page.evaluate('sessionStorage.removeItem("failure")');page.get_by_role('button',name='重试读取设置').click()
  expect(page.locator('#transcriptProvider')).to_have_value('fallback');expect(page.locator('#supadataApiKey')).to_have_value('fixture-subtitle-key')
  page.locator('#model').fill('fixture-model');page.get_by_role('button',name='保存设置',exact=True).click();expect(page.locator('#save-status')).to_contain_text('已保存');page.reload()
  for key,value in [('transcriptProvider','fallback'),('supadataApiKey','fixture-subtitle-key'),('apiKey','fixture-text-key'),('asrKey','fixture-speech-key'),('model','fixture-model')]:expect(page.locator('#'+key)).to_have_value(value)
  for mode in ['denied','rejected','pending']:
   page.evaluate("mode=>{chrome.permissions.request=()=>mode==='pending'?new Promise(()=>{}):mode==='rejected'?Promise.reject(new Error('permission unavailable')):Promise.resolve(false)}",mode)
   page.locator('#supadataApiKey').fill('fixture-'+mode);page.get_by_role('button',name='保存设置',exact=True).click()
   expect(page.locator('#save-status')).to_contain_text('已保存到本地')
   page.reload();expect(page.locator('#supadataApiKey')).to_have_value('fixture-'+mode);expect(page.locator('#transcriptProvider')).to_have_value('fallback')
  page.close()
 b.close()
print('Settings persistence passed: error/rejection blocks save, existing keys untouched, retry loads configuration, unrelated edits and reload retain all three keys and subtitle provider.')
