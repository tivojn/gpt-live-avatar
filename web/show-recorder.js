// Records an Avatar Show to a video file inside the app: the characters are
// composited from their WebGL canvases onto a stage backdrop each frame, the
// voices are mixed from the live audio streams, and Chromium's MediaRecorder
// writes MP4 (H.264 + AAC) directly, with WebM as the fallback. Nothing
// leaves the Mac and no external tool is needed.
import {LIP_SYNC_DELAY} from '/lip-sync.js';
const MIME_TYPES=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
export function recordingType(){
 if(typeof MediaRecorder==='undefined')return null;
 const mimeType=MIME_TYPES.find(t=>MediaRecorder.isTypeSupported(t));
 return mimeType?{mimeType,ext:mimeType.startsWith('video/mp4')?'mp4':'webm'}:null;
}
export class ShowRecorder {
 constructor({width=1280,height=720,fps=30}={}){
  this.width=width;this.height=height;this.fps=fps;this.chunks=[];this.sources=[];this.delays=[];this.recorder=null;this.started=0;this.held=0;this.heldAt=0;this.cache=new Map();
 }
 get active(){return Boolean(this.recorder&&this.recorder.state!=='inactive');}
 get paused(){return this.recorder?.state==='paused';}
 start(){
  const type=recordingType();if(!type)throw Error('Video recording is not available in this build.');
  this.type=type;this.canvas=document.createElement('canvas');this.canvas.width=this.width;this.canvas.height=this.height;this.ctx=this.canvas.getContext('2d');
  this.context=new AudioContext();this.destination=this.context.createMediaStreamDestination();
  const stream=new MediaStream([...this.canvas.captureStream(this.fps).getVideoTracks(),...this.destination.stream.getAudioTracks()]);
  this.recorder=new MediaRecorder(stream,{mimeType:type.mimeType,videoBitsPerSecond:6_000_000,audioBitsPerSecond:128_000});
  this.recorder.ondataavailable=e=>{if(e.data?.size)this.chunks.push(e.data);};
  this.recorder.start(1000);this.started=performance.now();this.paint();
 }
 // Every voice stream (each line, the Director) is mixed into the file. The
 // mouth on screen follows what the speaker emits, which trails the raw
 // stream by the lip-sync delay line plus the device's output latency; the
 // recorded copy is held back by the same amount so audio and mouth agree.
 addAudio(stream,output=null){
  if(!this.context||!stream?.getAudioTracks?.().length)return;
  try{const source=this.context.createMediaStreamSource(stream),delay=this.context.createDelay(1);delay.delayTime.value=this.lagFor(output);source.connect(delay);delay.connect(this.destination);this.sources.push(source,delay);this.delays.push({delay,output});}catch{}
 }
 lagFor(output){const lag=output?.playbackLag?.();return Math.min(1,Math.max(0,Number.isFinite(lag)?lag:LIP_SYNC_DELAY));}
 // Output latency settles after the context starts (and changes when the
 // output device does); follow it, but only on real changes so the delay
 // line never wobbles the audio.
 syncDelays(){for(const t of this.delays){const lag=this.lagFor(t.output);if(Math.abs(lag-t.delay.delayTime.value)>.005)t.delay.delayTime.value=lag;}}
 hold(){if(this.recorder?.state==='recording'){this.recorder.pause();this.heldAt=performance.now();}}
 resume(){if(this.recorder?.state==='paused'){this.recorder.resume();this.held+=performance.now()-this.heldAt;}}
 // Called from the stage's own frame loop, right after the characters render,
 // while their drawing buffers are still readable.
 frame(actors,{speaker='',caption=null,viewport}={}){
  if(!this.active||this.paused)return;
  this.syncDelays();
  this.paint(actors,speaker,caption,viewport);
 }
 paint(actors=new Map(),speaker='',caption=null,viewport={w:1,h:1}){
  const {ctx,width:W,height:H}=this;if(!ctx)return;
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#232637');g.addColorStop(1,'#12131c');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  const spot=ctx.createRadialGradient(W/2,H*.35,H*.1,W/2,H*.35,H*.9);spot.addColorStop(0,'rgba(255,244,214,.14)');spot.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=spot;ctx.fillRect(0,0,W,H);
  const order=[...actors.values()].filter(a=>a.avatar?.canvas&&!a.avatar.disposed).sort((a,b)=>(a.slug===speaker)-(b.slug===speaker)||a.y-b.y);
  // Frame the cast, not the whole window: the camera eases towards the box
  // around everyone on stage, in the frame's aspect ratio, never past the window.
  const box=order.length?order.reduce((b,a)=>({x0:Math.min(b.x0,a.x),y0:Math.min(b.y0,a.y),x1:Math.max(b.x1,a.x+a.w),y1:Math.max(b.y1,a.y+a.h)}),{x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity}):{x0:0,y0:0,x1:viewport.w,y1:viewport.h};
  let bw=(box.x1-box.x0)*1.18,bh=(box.y1-box.y0)*1.12;if(bw/bh<W/H)bw=bh*W/H;else bh=bw*H/W;
  bw=Math.min(bw,viewport.w);bh=Math.min(bh,viewport.h);if(bw/bh<W/H)bh=bw*H/W;else bw=bh*W/H;
  const cx=Math.max(bw/2,Math.min(viewport.w-bw/2,(box.x0+box.x1)/2)),cy=Math.max(bh/2,Math.min(viewport.h-bh/2,(box.y0+box.y1)/2));
  const want={x:cx-bw/2,y:cy-bh/2,w:bw,h:bh};this.view=this.view?{x:this.view.x+(want.x-this.view.x)*.08,y:this.view.y+(want.y-this.view.y)*.08,w:this.view.w+(want.w-this.view.w)*.08,h:this.view.h+(want.h-this.view.h)*.08}:want;
  const scale=W/this.view.w,ox=-this.view.x*scale,oy=-this.view.y*scale;
  for(const actor of order){const image=this.latest(actor);if(image)ctx.drawImage(image,ox+actor.x*scale,oy+actor.y*scale,actor.w*scale,actor.h*scale);}
  if(caption?.text){
   ctx.font=`${Math.round(H*.034)}px -apple-system, BlinkMacSystemFont, sans-serif`;ctx.textBaseline='alphabetic';
   const lines=wrap(ctx,caption.text,W*.82),lineH=Math.round(H*.046),who=caption.who?caption.who+': ':'';
   const boxH=lineH*(lines.length+(who?1:0))+Math.round(H*.04),y0=H-boxH-Math.round(H*.05);
   ctx.fillStyle='rgba(0,0,0,.55)';roundRect(ctx,W*.06,y0,W*.88,boxH,14);ctx.fill();
   let y=y0+lineH+Math.round(H*.004);
   if(who){ctx.fillStyle='#ffe8a3';ctx.font=`600 ${Math.round(H*.03)}px -apple-system, BlinkMacSystemFont, sans-serif`;ctx.fillText(who,W*.09,y);y+=lineH;ctx.font=`${Math.round(H*.034)}px -apple-system, BlinkMacSystemFont, sans-serif`;}
   ctx.fillStyle='#fff';for(const line of lines){ctx.fillText(line,W*.09,y);y+=lineH;}
  }
 }
 // A WebGL canvas reads back blank on any frame it did not redraw (a texture
 // tier update, a skipped frame), which made everyone but the speaker flicker.
 // Keep each character's last good frame and replace it only with a real one.
 latest(actor){
  const source=actor.avatar.canvas;if(!source.width||!source.height)return this.cache.get(actor.slug)?.canvas||null;
  let entry=this.cache.get(actor.slug);
  if(!entry){entry={canvas:document.createElement('canvas'),probe:document.createElement('canvas'),ctx:null,pctx:null};entry.probe.width=24;entry.probe.height=30;entry.pctx=entry.probe.getContext('2d',{willReadFrequently:true});entry.ctx=entry.canvas.getContext('2d');this.cache.set(actor.slug,entry);}
  try{
   entry.pctx.clearRect(0,0,24,30);entry.pctx.drawImage(source,0,0,24,30);const px=entry.pctx.getImageData(0,0,24,30).data;let drawn=false;for(let i=3;i<px.length;i+=4)if(px[i]>0){drawn=true;break;}
   if(!drawn)return entry.filled?entry.canvas:null;
   if(entry.canvas.width!==source.width||entry.canvas.height!==source.height){entry.canvas.width=source.width;entry.canvas.height=source.height;}
   entry.ctx.clearRect(0,0,entry.canvas.width,entry.canvas.height);entry.ctx.drawImage(source,0,0);entry.filled=true;return entry.canvas;
  }catch{return entry.filled?entry.canvas:null;}
 }
 async stop(){
  const recorder=this.recorder;if(!recorder)return null;
  if(recorder.state==='paused')this.resume();
  const done=new Promise(resolve=>{recorder.onstop=()=>resolve();});
  if(recorder.state!=='inactive')recorder.stop();await done;
  for(const s of this.sources){try{s.disconnect();}catch{}}this.sources=[];this.delays=[];void this.context?.close().catch(()=>{});this.context=null;
  const blob=new Blob(this.chunks,{type:this.type.mimeType});this.chunks=[];this.recorder=null;
  return {blob,ext:this.type.ext,mimeType:this.type.mimeType,seconds:Math.round((performance.now()-this.started-this.held)/1000)};
 }
}
function wrap(ctx,text,maxWidth){
 const words=String(text).split(/\s+/),lines=[];let line='';
 for(const word of words){const trial=line?line+' '+word:word;if(ctx.measureText(trial).width>maxWidth&&line){lines.push(line);line=word;}else line=trial;}
 if(line)lines.push(line);
 // Chinese has no spaces: break long runs by character.
 return lines.flatMap(l=>{if(ctx.measureText(l).width<=maxWidth)return [l];const out=[];let cur='';for(const ch of l){if(ctx.measureText(cur+ch).width>maxWidth&&cur){out.push(cur);cur=ch;}else cur+=ch;}if(cur)out.push(cur);return out;}).slice(0,4);
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
