import assert from 'node:assert/strict';
import fs from 'node:fs';
import {musicCommand,MusicCommandRouter} from '../web/music-command.js';
const base=new URL('../web/',import.meta.url),canonical=base;
const dataImport=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
Object.assign(globalThis,await dataImport(fs.readFileSync(new URL('group-context.js',canonical),'utf8')));
Object.assign(globalThis,{musicCommand,commentaryChunks:t=>[t],silentSpeech:()=>({rms:0,relative:0})});
const {LiveGroup}=await dataImport(fs.readFileSync(new URL('group-live.js',base),'utf8').replace(/^import .*;$/gm,''));
const cast=[{slug:'sarah',name:'Sarah'},{slug:'tia',name:'Tia'}];
function setup(callback){
 const events=[],requests=[],room=new LiveGroup({cancel(){},reply:r=>{requests.push(r);return {ok:true,text:'Unexpected delegate'};}},{musicRequest:callback,text:v=>events.push(v)});
 Object.assign(room,{running:true,active:'sarah',human:{enabled:true,name:'You'},cast,gate:{sample:()=>null},userUntil:0});
 const peer={slug:'sarah',name:'Sarah',acceptUser:true,humanFinal:true,agentDue:1,lastHumanText:'Sarah, sing along',lastHumanId:'input-1',humanChangedAt:0,segments:new Map(),openAt:10,micGain:{gain:{value:0}},client:{reasoningMode:'delegate',stopSpeaking(){},appendInstructions(){},appendCommentary:t=>events.push({spoken:t}),send(){return true;}}};room.peers.set('sarah',peer);return {room,peer,events,requests};
}
let finish,calls=[];const {room,peer,events,requests}=setup((text,meta)=>{calls.push({text,meta});return new Promise(r=>finish=r);});
room.tick(100);assert.equal(calls.length,1);assert.equal(calls[0].meta.character,'sarah');assert.equal(peer.acceptUser,false);assert.equal(room.awaitingHuman,true);assert.equal(events.length,0,'No success before audio readiness');
await room.delegate(peer,'late-delegate');assert.equal(requests.length,0,'Late model delegation cannot repeat local control');
finish({handled:true,ok:true,text:'Lip-syncing and dancing along to Test song.'});await new Promise(r=>setTimeout(r,0));assert.equal(events.at(-1).spoken,'Lip-syncing and dancing along to Test song.');assert.equal(peer.delegating,false);assert.equal(room.awaitingHuman,false);
let finishBad;const bad=setup(()=>new Promise(r=>finishBad=r));bad.room.tick(100);finishBad({handled:true,ok:false,text:'Start music first.'});await new Promise(r=>setTimeout(r,0));assert.equal(bad.events.at(-1).spoken,'Start music first.');
const interrupted=setup((text,meta)=>{calls.push(meta);return new Promise(r=>finish=r);});interrupted.room.tick(100);interrupted.peer.lastHumanId='input-2';assert.equal(calls.at(-1).cancelled(),true);finish({ok:true,text:'Do not announce stale success'});await new Promise(r=>setTimeout(r,0));assert.equal(interrupted.events.length,0);
const provisional=setup(()=>{throw Error('Partial transcript must not execute');});provisional.peer.humanFinal=false;provisional.room.tick(100);assert.equal(provisional.peer.acceptUser,true);
const noBackend=setup(()=>({ok:true,text:'Dancing'}));noBackend.room.agentEnabled=false;noBackend.peer.lastHumanText='dance along';noBackend.room.tick(100);await new Promise(r=>setTimeout(r,0));assert.equal(noBackend.events.at(-1).spoken,'Dancing','Music does not require enabled external engine');
const typed=setup(()=>({ok:true,text:'Started'}));let opened;typed.room.open=(slug,first,input)=>{opened={slug,input};};typed.room.say('Tia, dance along');assert.equal(opened.slug,'tia');assert.equal(opened.input.text,'Tia, dance along');assert.match(opened.input.id,/^typed-/);
const {DelegateClient}=await dataImport(fs.readFileSync(new URL('delegate-client.js',base),'utf8'));
class Live extends EventTarget{constructor(){super();this.reasoningMode='delegate';this.generation=1;this.state='connected';this.sent=[];}conversation(){return [{role:'user',text:'sing along'}];}appendCommentary(content,id){this.sent.push({content,id});return true;}}
const live=new Live(),backend=[];const bridge=new DelegateClient(live,{answer:r=>backend.push(r),cancel(){}});let executions=0;
const router=new MusicCommandRouter({execute:async()=>{executions++;return {ok:true,source:'Spotify'};}});bridge.turn='voice-final-1';
await router.run('sing along',{id:bridge.turn});bridge.localRequest=req=>router.resultFor(req.turnId)||{handled:false};bridge.created('delegation-late');await new Promise(r=>setTimeout(r,410));assert.equal(backend.length,0);assert.equal(executions,1);assert.match(live.sent.at(-1).content,/Verified music-control result/);
console.log('Music integration: group confirmed speech and typed addressing, readiness gating, interruptions, external-agent independence, and late solo/group delegation dedupe passed.');
