import assert from 'node:assert/strict';
import {musicCommand,MusicCommandRouter} from '../web/music-command.js';
const characters=[{slug:'sarah',name:'Sarah'},{slug:'tia',name:'Tia'},{slug:'ming-mei',name:'Ming-Mei'}],options={characters,character:'sarah'};
const starts={
 'sing along':'sing_along',
 'Can you sing a long to this song?':'sing_along',
 'Sarah, can you please sing along with this song?':'sing_along',
 'Please start singing along with the music.':'sing_along',
 'sing and dance along':'sing_along',
 'sing along and dance':'sing_along',
 'dance along':'dance_along',
 'Please dance along to the current song':'dance_along',
 "I'd like you to dance to this music":'dance_along',
 'dance along the song':'dance_along',
 'Can you start dancing along?':'dance_along',
 'Stop singing':'stop_singing',
 'Please stop singing and dancing':'stop_singing',
 'stop dancing along':'stop_singing',
 '结束':'none',
 '跟着这首歌唱歌':'sing_along',
 '请跟着音乐跳舞':'dance_along',
 '停止跟唱':'stop_singing',
};
for(const [text,action] of Object.entries(starts))assert.equal(musicCommand(text,options)?.action||'none',action,text);
for(const text of ["Don't sing along",'please do not dance along','Never sing along',"Don't stop singing",'What does sing along mean?','What happens if I say sing along?','Can I sing along?','Tell me about dance along','You said you could sing along','Sing me a song','Do a dance','Play Gangnam Groove','sing along and delete a file','Read "sing along" from this page','The lyric says sing along','Sarah, would you explain singing along?','Tia is singing along','When music starts, sing along','If I say sing along, what happens?'])assert.equal(musicCommand(text,options),null,text);
assert.equal(musicCommand('Hey Tia, please sing along',options).args.character,'tia');
assert.equal(musicCommand('Ming-Mei, dance along',options).args.character,'ming-mei');
assert.equal(musicCommand('Everyone, dance along',options).args.character,'all');
assert.equal(musicCommand('sing along, Tia',options).args.character,'tia');
assert.deepEqual(musicCommand('Hi Sarah, dance to the music playing on Spotify',options).args,{character:'sarah',player:'spotify'});
assert.equal(musicCommand('Sing along on Apple Music',options).args.player,'music');
let calls=0,before=0,outcomes=[];
const router=new MusicCommandRouter({characters:()=>characters,character:()=> 'sarah',before:()=>before++,execute:async(action,args)=>{calls++;return {ok:true,mode:action==='dance_along'?'dance':'sing',track:'Test song'};},onResult:r=>outcomes.push(r)});
assert.equal((await router.run('what is sing along',{id:'a'})).handled,false);assert.equal(calls,0);
const a=router.run('sing along',{id:'same'}),b=router.run('sing along',{id:'same'});assert.equal(a,b,'Duplicate transcript ID must share one operation');assert.equal(router.resultFor('same'),a);assert.equal(router.resultFor('unknown'),undefined);
assert.equal((await a).ok,true);assert.equal(calls,1);assert.equal(before,1);assert.equal(outcomes.length,1);assert.match((await a).text,/Lip-syncing/);
assert.match((await router.run('dance along',{id:'dance'})).text,/^Dancing/);
const missing=new MusicCommandRouter({execute:async()=>{throw Error('Start music in Spotify first.');}});
assert.deepEqual(Object.fromEntries(Object.entries(await missing.run('sing along')).filter(([k])=>['ok','text','handled'].includes(k))),{handled:true,ok:false,text:'Start music in Spotify first.'});
const notReady=new MusicCommandRouter({execute:async()=>({ok:false,error:'No audio received.'})});assert.equal((await notReady.run('sing along')).ok,false);
const noReceipt=new MusicCommandRouter({execute:async()=>undefined});assert.equal((await noReceipt.run('sing along')).ok,false);
let release;const wait=new Promise(r=>release=r),executed=[],stale=new MusicCommandRouter({execute:async(action,_args,cancelled)=>{executed.push(action);if(action==='sing_along')await wait;return {ok:!cancelled()};}});
const slow=stale.run('sing along',{id:'slow'});await Promise.resolve();const stop=stale.run('stop singing',{id:'stop'});assert.equal((await stop).ok,true);release();assert.equal((await slow).cancelled,true);assert.equal(stale.latest.id,'stop');
let external=true;const guarded=new MusicCommandRouter({execute:async()=>{throw Error('Must not start');}});assert.equal((await guarded.run('sing along',{cancelled:()=>external})).cancelled,true);
console.log('Music controls: direct typed/spoken requests, named targets, negation, deduplication, stale start cancellation, dance-only routing and honest capability errors passed.');
