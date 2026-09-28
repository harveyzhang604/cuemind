"""Quick-note card timing with mock runtime; no personal Chrome data or AI requests."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_options
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,**chromium_options());page=browser.new_page(viewport={'width':1000,'height':760})
 page.route('https://www.youtube.com/**',lambda r:r.fulfill(content_type='text/html',body='<div id="movie_player"><video></video></div>'))
 page.goto('https://www.youtube.com/watch?v=fixture7')
 page.evaluate('''()=>{window.messages=[];window.chrome={runtime:{id:'fixture',getManifest:()=>({}),onMessage:{addListener:()=>{},removeListener:()=>{}},sendMessage:async m=>{messages.push(m);return {ok:true,data:{warning:'',note:{timestamp:65.179,body:'Exact original sentence.',videoInfo:{title:'Test video',url:location.href}}}};}}};}''')
 # Test-only open shadow exposes the card without changing production encapsulation.
 page.add_script_tag(content=(ROOT/'extension/content/player.js').read_text().replace("attachShadow({ mode: 'closed' })","attachShadow({ mode: 'open' })"))
 note=page.locator('#cuemind-tools button').filter(has_text='Note');card=page.locator('#cuemind-tools .notice')
 note.click();page.mouse.move(0,0);expect(card).to_contain_text('1:05 · Test video');expect(card).to_contain_text('Exact original sentence.')
 page.wait_for_timeout(2400);expect(card).to_be_visible();page.wait_for_timeout(750);expect(card).to_be_hidden()
 note.click();card.hover();page.wait_for_timeout(3200);expect(card).to_be_visible();expect(card.get_by_role('button',name='复制时间链接')).to_be_visible()
 page.mouse.move(0,0);page.wait_for_timeout(1700);expect(card).to_be_hidden();assert len(page.evaluate('messages.filter(m=>m.type==="QUICK_NOTE")'))==2
 browser.close()
print('Quick note card passed: exact body/title/time, 3 second close, hover retention and 1.5 second close after leaving.')
