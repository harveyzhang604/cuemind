from playwright.sync_api import sync_playwright
from pathlib import Path
import json, tempfile
from browser_support import chromium_options, preview_server
ROOT=Path(__file__).resolve().parents[1]
CHROME=Path.home()/'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
with preview_server() as base, sync_playwright() as p:
    browser=p.chromium.launch(headless=True, **chromium_options())
    page=browser.new_page(viewport={'width':430,'height':950},device_scale_factor=2)
    errors=[]
    page.on('pageerror', lambda e:errors.append(str(e)))
    page.goto(base+'/extension/panel/index.html')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='先体验示例').click()
    page.locator('.sentence').first.wait_for()
    assert page.locator('.sentence').count()==10, page.locator('.sentence').count()
    assert page.locator('.translation').count()==10
    page.screenshot(path=str(ROOT/'docs/preview-transcript.png'),full_page=True)
    assert not page.locator('#transcript-search').is_visible()
    assert not page.locator('#sentence-count').is_visible()
    assert not page.locator('#tracks').is_visible()
    assert not page.locator('#translate').is_visible()
    assert page.locator('#export-transcript').count()==0
    for action,label in [('copy-transcript','复制'),('export','导出'),('refresh','读取')]:
        assert page.locator('#'+action).is_visible()
        assert page.locator('#'+action).inner_text()==label
    assert page.locator('#boundary').count()==0
    assert not page.locator('#stop').is_visible()
    assert page.locator('.transcript-toolbar').bounding_box()['height']<85
    assert page.locator('#transcript-mode').input_value()=='bilingual'
    for selector in ['#transcript-mode','#focus-settings','#copy-transcript','#export','#refresh']:
        assert page.locator(selector).evaluate('(e)=>getComputedStyle(e).borderTopWidth')=='0px'
        assert page.locator(selector).evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
    page.locator('#transcript-mode').select_option('original')
    assert page.locator('#transcript-mode').input_value()=='original'
    page.locator('#transcript-mode').select_option('bilingual')
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))")
    if page.locator('#status').is_visible():page.locator('#dismiss-status').click()
    assert not page.locator('#status').is_visible()
    page.screenshot(path='/tmp/cuemind-compact-transcript.png')
    page.locator('#toggle-search').click()
    page.locator('#search').fill('retrieval')
    assert page.locator('.sentence').count()==1
    page.locator('#search').fill('')
    page.locator('.sentence').first.locator('.sentence-toggle').click()
    page.locator('.sentence').first.get_by_role('button',name='＋ 笔记').click()
    page.locator('#note-body').fill('测试：主动回想，让理解留下来。')
    page.get_by_role('button',name='保存笔记',exact=True).click()
    assert not page.locator('#note-dialog').is_visible()
    page.get_by_role('button',name='笔记 1',exact=True).click()
    assert '主动回想' in page.locator('#notes-list').inner_text()
    page.reload();page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='先体验示例').click()
    page.locator('[data-tab="notes"]').click()
    assert '主动回想' in page.locator('#notes-list').inner_text()
    page.locator('[data-tab="study"]').click()
    assert page.locator('[data-tab=chat]').count()==0
    assert page.locator('#qa-current').is_visible()
    assert page.locator('#qa-scope').input_value()=='sentence'
    assert page.locator('#chat-form').count()==1
    assert not page.locator('#replay-dialog').evaluate('(e)=>e.open')
    page.wait_for_timeout(300)
    page.screenshot(path=str(ROOT/'docs/preview-study.png'),full_page=True)
    page.locator('[data-tab="overview"]').click()
    assert '解释，是理解的试金石' in page.locator('#overview-content').inner_text()
    page.locator('[data-tab=transcript]').click()
    page.locator('#export').click()
    assert page.locator('footer .footer-line').count()==0
    assert page.locator('footer').bounding_box()['height']<85
    with page.expect_download() as download:
        page.locator('[data-export="md"]').click()
    file=download.value.path()
    assert '主动回想' in Path(file).read_text()
    for kind in ['mindmap','outline','srt','txt']:
        with page.expect_download() as item:
            page.locator('[data-export="'+kind+'"]').click()
        content=Path(item.value.path()).read_text()
        assert len(content)>30,kind
        if kind=='srt': assert '-->' in content
        if kind=='mindmap': assert 'mindmap' in content
        if kind=='json':
            data=json.loads(content)
            assert 'apiKey' not in content and 'asrKey' not in content
    page.locator('[data-export="json"]').click()
    assert '请在 Chrome 中加载' in page.locator('#status').inner_text()
    page.locator('#export-dialog .close').click()
    page.locator('[data-tab="study"]').click()
    page.locator('#question').fill('核心观点是什么？')
    page.get_by_role('button',name='提问 ↗').click()
    assert '示例仅用于' in page.locator('#status').inner_text()
    assert page.url.endswith('index.html')
    assert not errors, errors
    page.goto(base+'/extension/panel/settings.html')
    page.select_option('#provider','gemini')
    assert 'generativelanguage' in page.locator('#baseUrl').input_value()
    page.get_by_role('button',name='保存设置',exact=True).click()
    assert '预览不保存密钥' in page.locator('#save-status').inner_text()
    browser.close()
print('Browser UI smoke passed: reading, bilingual search, notes persistence, study, overview, export, guarded AI, settings.')
