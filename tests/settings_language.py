"""Language selection persists; legacy languages survive unrelated settings saves."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
with preview_server() as base,sync_playwright() as p:
 b=p.chromium.launch(headless=True,**chromium_options());page=b.new_page(viewport={'width':720,'height':900});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.modelCalls=0;window.chrome={runtime:{id:'fixture',sendMessage:async m=>{if(m.type==='GET_SETTINGS'){const {defaults}=await import('../services/ai-provider.js');return {ok:true,data:{...defaults,...JSON.parse(sessionStorage.getItem('settings')||'{}')}};}if(m.type==='DATA_STATS')return {ok:true,data:{videos:0,notes:0,chats:0}};if(m.type==='SAVE_SETTINGS'){sessionStorage.setItem('settings',JSON.stringify(m.settings));return {ok:true};}modelCalls++;return {ok:false};}},permissions:{request:async()=>true}};''')
 url=base+'/extension/panel/settings.html';page.goto(url)
 language=page.get_by_role('combobox',name='目标语言',exact=True)
 expect(language).to_have_value('简体中文');assert page.locator('input#targetLanguage').count()==0
 for value in ['English','繁体中文','日本語','简体中文']:
  language.select_option(value);page.get_by_role('button',name='保存设置',exact=True).click()
  expect(page.locator('#save-status')).to_contain_text('已保存')
  page.reload();expect(language).to_have_value(value)
 # A language entered in an old version must not become blank or be overwritten.
 page.evaluate("sessionStorage.setItem('settings',JSON.stringify({targetLanguage:'French',model:'my-existing-model'}))")
 page.reload();expect(language).to_have_value('French');expect(language).to_contain_text('已保存：French')
 page.get_by_role('button',name='保存设置',exact=True).click();expect(page.locator('#save-status')).to_contain_text('已保存')
 assert page.evaluate("JSON.parse(sessionStorage.getItem('settings')).model")=='my-existing-model'
 page.reload();expect(language).to_have_value('French')
 language.select_option('简体中文');page.get_by_role('button',name='保存设置',exact=True).click();expect(page.locator('#save-status')).to_contain_text('已保存')
 page.reload();expect(language).to_have_value('简体中文')
 assert page.evaluate('modelCalls')==0
 assert not errors,errors;b.close()
print('Settings language passed: presets, save/reload, legacy language preservation, model preservation and no AI calls.')
