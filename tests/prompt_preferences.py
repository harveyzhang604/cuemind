"""Editable prompt examples preserve drafts, save only explicitly and never call AI."""
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options,preview_server
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with preview_server() as base,sync_playwright() as p:
 b=p.chromium.launch(headless=True,**chromium_options());page=b.new_page(viewport={'width':720,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.calls=[];window.chrome={runtime:{id:'fixture',sendMessage:async m=>{calls.push(m);if(m.type==='GET_SETTINGS'){const {defaults}=await import('../services/ai-provider.js');return {ok:true,data:{...defaults,...JSON.parse(sessionStorage.getItem('settings')||'{"prompts":{"qa":"保留我的偏好"}}')}};}if(m.type==='DATA_STATS')return {ok:true,data:{videos:0,notes:0,chats:0}};if(m.type==='SAVE_SETTINGS'){sessionStorage.setItem('settings',JSON.stringify(m.settings));return {ok:true};}return {ok:false};}},permissions:{request:async()=>true}};''')
 page.goto(base+'/extension/panel/settings.html')
 for key in ['boundary','translation','study','analysis','qa','explain','refine','focus']:
  area=page.locator('#prompt-'+key);area.locator('..').locator(':scope > summary').click();select=page.locator('#prompt-example-'+key)
  expect(select).to_have_value('custom' if key=='qa' else 'default')
  builtin=page.locator('#prompt-builtin-'+key);expect(builtin).not_to_be_visible();description=page.locator('#prompt-description-'+key);expect(description).to_be_visible();assert description.inner_text()==page.evaluate('async key=>(await import("./prompt-examples.js")).defaultDescriptions[key]',key);assert not any(x in description.inner_text() for x in ['JSON','sentenceId','{','}']);expect(page.locator('#prompt-help-'+key)).to_contain_text('无需填写变量');technical=builtin.locator('..');technical.locator(':scope > summary').click();expect(builtin).to_be_visible();assert builtin.inner_text()==page.evaluate('async key=>(await import("../services/prompts.js")).prompts[key]',key);assert not builtin.get_attribute('contenteditable');technical.locator(':scope > summary').click()
  if key=='boundary':
   description.scroll_into_view_if_needed();page.screenshot(path=str(ROOT/'docs/screenshots/prompt-default-friendly-20260927.png'))
  before=area.input_value();select.select_option('0');expect(area).to_have_value(before)
  preview=page.locator('#prompt-preview-'+key).inner_text();assert preview
  area.locator('..').get_by_role('button',name='替换为示例',exact=True).click();expect(area).to_have_value(preview)
  area.fill(preview+'\n我的补充。');expect(select).to_have_value('custom');select.select_option('1');extra=page.locator('#prompt-preview-'+key).inner_text()
  area.locator('..').get_by_role('button',name='追加示例',exact=True).click();expect(area).to_have_value(preview+'\n我的补充。\n'+extra)
  select.select_option('1');expect(area.locator('..').get_by_role('button',name='追加示例')).to_be_disabled()
  area.locator('..').locator(':scope > summary').click()
 assert not page.evaluate('calls.some(m=>m.type==="SAVE_SETTINGS")')
 page.get_by_role('button',name='保存设置',exact=True).click();expect(page.locator('#save-status')).to_contain_text('已保存');page.reload()
 assert '我的补充。' in page.locator('#prompt-qa').input_value()
 page.locator('#prompt-focus').locator('..').locator(':scope > summary').click();page.locator('#prompt-example-focus').select_option('default');page.locator('#prompt-focus').locator('..').get_by_role('button',name='使用内置默认').click();expect(page.locator('#prompt-focus')).to_have_value('');assert page.locator('#prompt-qa').input_value()
 page.locator('#prompt-example-focus').select_option('2');page.locator('#prompt-focus').locator('..').get_by_role('button',name='替换为示例').click();page.locator('#prompt-focus').fill('x'*6000);page.locator('#prompt-example-focus').select_option('0');expect(page.locator('#prompt-focus').locator('..').get_by_role('button',name='追加示例')).to_be_disabled()
 for width in [320,430,900]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 page.locator('#prompt-example-focus').select_option('0');page.locator('#prompt-focus').locator('..').get_by_role('button',name='替换为示例').click();page.locator('#prompt-focus').locator('..').scroll_into_view_if_needed();page.screenshot(path=str(ROOT/'docs/screenshots/prompt-preferences-20260927.png'))
 page.get_by_role('button',name='清空全部补充偏好').click();assert all(not page.locator('#prompt-'+k).input_value() for k in ['qa','focus','translation']);page.get_by_role('button',name='保存设置',exact=True).click();page.reload();expect(page.locator('#prompt-example-focus')).to_have_value('default');expect(page.locator('#prompt-qa')).to_have_value('')
 assert page.evaluate('calls.every(m=>["GET_SETTINGS","DATA_STATS","SAVE_SETTINGS"].includes(m.type))');assert not errors,errors;b.close()
print('Prompt examples passed: eight capabilities, preview without overwriting, replace/append/edit, duplicate and length guards, saved drafts, per-item default, reset, three widths, no AI calls.')
