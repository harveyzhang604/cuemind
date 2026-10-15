import test from 'node:test';
import assert from 'node:assert/strict';
import {videoCandidates, materialsMediaRule, inspectVideoSource} from '../extension/services/materials-source.js';
import vm from 'node:vm';

test('video candidates are restricted to platform CDNs and prefer legible bounded resolution',()=>{
 const stream=(url,height)=>({url,height,mimeType:'video/mp4',codecs:'avc1'});
 const rows=videoCandidates('bilibili',[
  stream('https://cdn.bilivideo.com/720',720),stream('https://cdn.bilivideo.com/4k',2160),stream('https://cdn.bilivideo.com/1080',1080),
  stream('https://evil.test/a',1080),stream('https://bilivideo.com.evil.test/a',1080),stream('http://cdn.bilivideo.com/a',1080),stream('https://user:password@cdn.bilivideo.com/a',1080),
 ]);
 assert.equal(rows.length,3);assert.equal(rows[0].height,1080);assert.equal(rows[1].height,720);
 assert.deepEqual(videoCandidates('migu',rows),[]);assert.deepEqual(videoCandidates('youtube',rows),[]);
 const rule=materialsMediaRule('extension-id','bilibili');
 assert.deepEqual(rule.condition.initiatorDomains,['extension-id']);
 assert.equal(rule.action.requestHeaders[0].header,'Referer');assert.equal(materialsMediaRule('id','youtube'),null);
});

test('Bilibili source discovery reads the correct part and rejects navigation during lookup',async()=>{
 const context={URL,AbortSignal,location:{href:'https://www.bilibili.com/video/BVfixture/?p=2'},calls:[]};
 context.fetch=async url=>{context.calls.push(url);return Response.json(url.includes('/view?')?{data:{pages:[{cid:11},{cid:22}]}}:{code:0,data:{dash:{video:[{baseUrl:'https://cdn.bilivideo.com/video',height:1080,codecs:'avc1'}]}}});};
 vm.createContext(context);const inspect=vm.runInContext('('+inspectVideoSource.toString()+')',context);
 assert.equal((await inspect('bilibili:BVfixture:2'))[0].height,1080);assert.match(context.calls[1],/cid=22/);
 context.fetch=async()=>{context.location.href='https://www.bilibili.com/video/BVfixture/?p=3';return Response.json({data:{pages:[{cid:11},{cid:22}]}});};
 await assert.rejects(inspect('bilibili:BVfixture:2'),/切换|后台视频/);
});

test('YouTube returns only direct URLs; signature cipher is not fabricated',async()=>{
 const context={URL,location:{href:'https://www.youtube.com/watch?v=fixture'},document:{getElementById:()=>null},window:{ytInitialPlayerResponse:{videoDetails:{videoId:'fixture'},streamingData:{adaptiveFormats:[{url:'https://rr.googlevideo.com/video',mimeType:'video/mp4',height:1080},{signatureCipher:'encrypted',mimeType:'video/mp4'}]}}}};
 vm.createContext(context);const inspect=vm.runInContext('('+inspectVideoSource.toString()+')',context);
 assert.equal((await inspect('youtube:fixture:1')).length,1);
 context.window.ytInitialPlayerResponse.videoDetails.videoId='other';
 assert.equal((await inspect('youtube:fixture:1')).length,0);
});
