"""Actual MV3 + page MAIN-world + CDN cache chain, with deterministic Bili responses."""
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright
from browser_support import chromium_options
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
 ctx=p.chromium.launch_persistent_context(profile,headless=True,**chromium_options(),args=[f'--disable-extensions-except={ROOT}/extension',f'--load-extension={ROOT}/extension'])
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');eid=worker.url.split('/')[2]
 worker.evaluate('''()=>{const original=fetch;globalThis.cdnRequests=0;globalThis.fetch=async(url,options)=>{
   if(String(url).includes('/x/web-interface/nav'))return new Response(JSON.stringify({data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/'+ 'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/bfs/wbi/'+'b'.repeat(32)+'.png'}}}));
   if(String(url).includes('fixture.hdslb.com')){cdnRequests++;const part=String(url).includes('p2')?2:1;return new Response(JSON.stringify({body:[{from:1,to:4,content:'Part '+part+' first sentence.'},{from:5,to:8,content:'Part '+part+' second sentence.'}]}));}
   return original(url,options);
 };}''')
 seen=[]
 def api(route):
  from urllib.parse import urlparse,parse_qs
  url=route.request.url
  if '/view?' in url:route.fulfill(json={'code':0,'data':{'title':'Multi part','owner':{'name':'Fixture'},'pages':[{'cid':101,'part':'One','duration':10},{'cid':202,'part':'Two','duration':20}]}})
  else:
   q=parse_qs(urlparse(url).query);assert q['bvid']==['BVfixture'];assert len(q['w_rid'][0])==32 and q['wts'][0].isdigit();seen.append(q['cid'][0]);part=2 if q['cid']==['202'] else 1
   route.fulfill(json={'code':0,'data':{'subtitle':{'subtitles':[{'id':part,'lan':'en','lan_doc':'English','subtitle_url':f'https://fixture.hdslb.com/p{part}.json'}]}}})
 ctx.route('https://api.bilibili.com/**',api)
 ctx.route('https://www.bilibili.com/**',lambda r:r.fulfill(body='<html><body><video></video></body></html>',content_type='text/html'))
 video=ctx.new_page();video.goto('https://www.bilibili.com/video/BVfixture/?p=1')
 panel=ctx.new_page();panel.goto(f'chrome-extension://{eid}/panel/index.html');panel.wait_for_load_state('networkidle')
 tid=worker.evaluate('async()=> (await chrome.tabs.query({url:"https://www.bilibili.com/*"}))[0].id')
 def load():
  result=panel.evaluate('(tabId)=>chrome.runtime.sendMessage({type:"LOAD",tabId})',tid);assert result['ok'],result;return result['data']
 one=load();assert one['record']['sentences'][0]['rawText']=='Part 1 first sentence.'
 video.goto('https://www.bilibili.com/video/BVfixture/?p=2');two=load()
 assert two['record']['sentences'][0]['rawText']=='Part 2 first sentence.'
 assert one['record']['id']!=two['record']['id'] and two['record']['videoInfo']['duration']==20
 count=worker.evaluate('cdnRequests');video.goto('https://www.bilibili.com/video/BVfixture/?p=1');cached=load()
 assert cached['cached'] and cached['record']['id']==one['record']['id'] and worker.evaluate('cdnRequests')==count
 assert '101' in seen and '202' in seen
 wrong=panel.evaluate('(tabId)=>chrome.runtime.sendMessage({type:"LOAD",tabId,videoKey:"bilibili:BVfixture:2"})',tid)
 assert not wrong['ok']
 ctx.close()
print('Bilibili flow passed: MAIN-world view, WBI parameters, distinct P1/P2 CDN captions, independent cache and stale-part rejection.')
