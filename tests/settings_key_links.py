"""Official onboarding links follow the selected service without sending credentials."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with preview_server() as base,sync_playwright() as p:
 browser=p.chromium.launch(headless=True,**chromium_options());ctx=browser.new_context(viewport={'width':900,'height':900})
 # Link clicks use empty intercepted pages, never a login or a personal account.
 ctx.route('https://**',lambda r:r.fulfill(body='<title>Official entry fixture</title>'))
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.calls=[];window.chrome={runtime:{id:'fixture',sendMessage:async m=>{calls.push(m);if(m.type==='GET_SETTINGS'){const {defaults}=await import('../services/ai-provider.js');return {ok:true,data:{...defaults,provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'kept-model',apiKey:'FIXTURE',asrUrl:'https://api.groq.com/openai/v1',asrModel:'whisper-large-v3-turbo',asrKey:'ASR-FIXTURE'}};}if(m.type==='DATA_STATS')return {ok:true,data:{videos:0,notes:0,chats:0}};return {ok:true};}},permissions:{request:async()=>true}};''')
 page.goto(base+'/extension/panel/settings.html');expect(page.locator('#model-key-help a')).to_have_attribute('href','https://platform.deepseek.com/api_keys')
 expect(page.locator('#model')).to_have_value('kept-model');expect(page.locator('#apiKey')).to_have_value('FIXTURE');expect(page.locator('#asrModel')).to_have_value('whisper-large-v3-turbo');expect(page.locator('#asrKey')).to_have_value('ASR-FIXTURE')
 def verify_link(link,url):
  expect(link).to_have_attribute('href',url);expect(link).to_have_attribute('target','_blank');assert 'noopener' in link.get_attribute('rel')
  assert link.evaluate('(a)=>getComputedStyle(a).textDecorationLine')=='underline'
  with page.expect_popup() as opened:link.click()
  popup=opened.value;popup.wait_for_load_state();assert popup.url==url;popup.close();assert 'FIXTURE' not in url
 verify_link(page.locator('#supadata-key-help a'),'https://dash.supadata.ai/auth/sign-up')
 verify_link(page.locator('#model-key-help a'),'https://platform.deepseek.com/api_keys')
 verify_link(page.locator('#asr-key-help a').filter(has_text='Groq'),'https://console.groq.com/keys')
 for provider,url in [('openai','https://platform.openai.com/api-keys'),('gemini','https://aistudio.google.com/apikey'),('deepseek','https://platform.deepseek.com/api_keys')]:
  page.locator('#provider').select_option(provider);expect(page.locator('#model-key-help a')).to_have_attribute('href',url)
 page.locator('#provider').select_option('compatible');expect(page.locator('#model-key-help')).to_contain_text('Ollama');assert page.locator('#model-key-help a').count()==0
 page.locator('#baseUrl').fill('https://api.groq.com/openai/v1');expect(page.locator('#model-key-help a')).to_have_attribute('href','https://console.groq.com/keys')
 page.locator('#baseUrl').fill('https://my-service.example/v1');assert page.locator('#model-key-help a').count()==0
 page.locator('#provider').select_option('deepseek')
 for width in [320,430,900]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 page.locator('#apiKey').scroll_into_view_if_needed();page.screenshot(path=str(ROOT/'docs/screenshots/settings-key-links-20260927.png'))
 assert page.evaluate('calls.every(m=>["GET_SETTINGS","DATA_STATS"].includes(m.type))');assert not errors,errors
 browser.close()
print('Settings key links passed: Supadata/DeepSeek/Groq new tabs, provider switching, custom/local fallback, preserved loaded settings, underline, three widths, no AI or credential transmission.')
