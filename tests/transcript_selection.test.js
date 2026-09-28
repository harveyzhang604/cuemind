import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPage,canReuseTranscript} from '../extension/services/platform.js';

async function inspect({audio='en',playingAudio,tracks,selected=null,resources=[],requests=[]}){
 const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location,performance:globalThis.performance,fetch:globalThis.fetch};
 const response={videoDetails:{videoId:'fixture',title:'Fixture',lengthSeconds:'30'},microformat:{playerMicroformatRenderer:{defaultAudioLanguage:audio}},captions:{playerCaptionsTracklistRenderer:{captionTracks:tracks}}};
 globalThis.performance={getEntriesByType:()=>resources.map(name=>({name}))};
 globalThis.fetch=async url=>{requests.push(String(url));return {ok:true,text:async()=>JSON.stringify({events:[{tStartMs:0,segs:[{utf8:'Fixture'}]}]})};};
 globalThis.location={hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=fixture'};
 globalThis.window={ytInitialPlayerResponse:response};
 globalThis.document={querySelector:()=>null,getElementById:()=>({getPlayerResponse:()=>response,getAudioTrack:()=>playingAudio?{languageCode:playingAudio}:null})};
 try{return await inspectPage(selected,'youtube:fixture:1');}
 finally{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
}
const track=(languageCode,auto=false)=>({languageCode,kind:auto?'asr':undefined,name:{simpleText:languageCode},baseUrl:'https://www.youtube.com/api/timedtext?v=fixture'});
test('Original audio language outranks manual captions in a different language',async()=>{
 const result=await inspect({tracks:[track('fr'),track('en',true)]});
 assert.equal(result.tracks[0].language,'en');assert.equal(result.tracks[0].id,'1');assert.equal(result.tracks[0].isAi,true);
});
test('Manual captions win within the same audio language; regional languages match',async()=>{
 const result=await inspect({audio:'en-US',tracks:[track('en',true),track('fr'),track('en-GB')]});
 assert.equal(result.tracks[0].id,'2');assert.equal(result.tracks[1].id,'0');
});
test('Current dubbed audio takes precedence over default audio metadata',async()=>{
 const result=await inspect({playingAudio:'ja',tracks:[track('en'),track('ja',true)]});
 assert.equal(result.info.audioLanguage,'ja');assert.equal(result.tracks[0].language,'ja');
});
test('Unknown audio language does not invent English as the source',async()=>{
 const result=await inspect({audio:'',tracks:[track('ja',true),track('fr')]});
 assert.equal(result.info.audioLanguage,'');assert.equal(result.tracks[0].language,'fr');
});
test('Default cache reuse respects corrected track ranking and deliberate user sources',()=>{
 const record={rawCaptions:[{}],transcriptMeta:{source:'youtube_native',trackId:'fr'}};
 const tracks=[{id:'en'},{id:'fr'}];
 assert.equal(canReuseTranscript(record,tracks),false);
 assert.equal(canReuseTranscript({...record,transcriptMeta:{...record.transcriptMeta,trackId:'en'}},tracks),true);
 for(const source of ['import','whisper'])assert.equal(canReuseTranscript({...record,transcriptMeta:{source}},tracks),true);
 assert.equal(canReuseTranscript({...record,transcriptMeta:{...record.transcriptMeta,selectedByUser:true}},tracks),true);
 assert.equal(canReuseTranscript({...record,rawCaptions:[]},tracks),false);
});

test('Live caption requests cannot substitute auto captions or translated captions for manual originals',async()=>{
 const requests=[];
 await inspect({tracks:[track('en'),track('en',true)],selected:'0',requests,resources:[
 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&marker=manual',
 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&kind=asr&marker=auto',
 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&tlang=zh&marker=translated'
 ]});
 assert.equal(new URL(requests[0]).searchParams.get('marker'),'manual');
});


test('Migu reads the actual programme, rejects stale programme IDs and makes no platform API requests', async () => {
 const previous = {document:globalThis.document,location:globalThis.location,fetch:globalThis.fetch};
 let programme = '967772705', requests = 0;
 globalThis.location = {hostname:'miguvideo.com',href:'https://miguvideo.com/p/live/120000587094'};
 globalThis.fetch = async () => {requests++; throw new Error('Unexpected platform request');};
 globalThis.document = {
  title:'Fixture-咪咕视频',
  querySelector: selector => selector === 'video' ? {duration:11808} : selector === '[current-content-id]' ? {getAttribute:()=>programme} : {textContent:'【主赛】（英文原声）'},
 };
 try {
  const data = await inspectPage(null,'migu:120000587094:1');
  assert.equal(data.info.page,967772705);
  assert.equal(data.info.audioLanguage,'en');
  assert.equal(data.source,'migu_audio');
  assert.equal(data.raw.length,0);
  programme = '967768269';
  await assert.rejects(inspectPage(null,'migu:120000587094:967772705'),/视频已切换/);
  programme = '';
  await assert.rejects(inspectPage(null,'migu:120000587094:1'),/正在加载/);
  assert.equal(requests,0);
 } finally {
  for (const [key,value] of Object.entries(previous)) {if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
 }
});
