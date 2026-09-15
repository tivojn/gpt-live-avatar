const {app,BrowserWindow}=require('electron'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web'),out=path.resolve(__dirname,'../build/qa-lip-sync');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{if(req.url==='/qa'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Audio QA</title>');return;}const file=path.resolve(root,'.'+req.url);if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',/\.(js|mjs)$/.test(file)?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
app.whenReady().then(async()=>{let w;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await w.loadURL('http://127.0.0.1:'+server.address().port+'/qa');
 const result=await w.webContents.executeJavaScript(`(async()=>{
  const {SpeechOutput}=await import('/lip-sync.js'),{synthConversationCue}=await import('/conversation-sounds.js');
  const context=new AudioContext(),output=new SpeechOutput(context,{monitor:false});await context.resume();const ready=await output.ready;
  const dest=context.createMediaStreamDestination(),source=context.createBufferSource(),buffer=context.createBuffer(1,48000,48000),data=buffer.getChannelData(0);
  for(let i=4800;i<24000;i++)data[i]=.15*Math.sin(2*Math.PI*220*i/48000);source.buffer=buffer;source.connect(dest);output.attach(dest.stream);source.start();
  const frames=[],start=performance.now();while(performance.now()-start<1300){frames.push({...output.sample(),ms:performance.now()-start});await new Promise(r=>setTimeout(r,10));}
  output.setActive(false);const interrupted=output.sample();output.setActive(true);const resumed=output.sample();output.close();await context.close();
  const cues=[];for(const kind of ['connecting','connected','ended']){const c=new OfflineAudioContext(1,48000,48000);synthConversationCue(c,kind);const b=await c.startRendering(),pcm=Array.from(b.getChannelData(0));cues.push({kind,pcm});}
  return {ready,frames,interrupted,resumed,cues};
 })()`,true);
 assert(result.ready);assert(result.frames.some(f=>f.rms>.08),'WebAudio stream playback reaches the analyser');assert(result.frames.some(f=>f.viseme!=='sil'),'AudioWorklet produces classifications');assert.equal(result.interrupted.viseme,'sil');assert.equal(result.resumed.viseme,'sil');assert.equal(result.frames.at(-1).viseme,'sil');
 for(const cue of result.cues){const pcm=new Float32Array(cue.pcm);fs.writeFileSync(out+'/'+cue.kind+'.f32',Buffer.from(pcm.buffer));cue.peak=Math.max(...cue.pcm.map(Math.abs));assert(cue.peak<.3&&cue.peak>.01);delete cue.pcm;}
 fs.writeFileSync(out+'/clock.json',JSON.stringify(result,null,2));console.log({passed:true,firstAudio:result.frames.find(f=>f.rms>.008)?.ms,firstViseme:result.frames.find(f=>f.viseme!=='sil')?.ms,cues:result.cues});
 }catch(e){console.error(e);process.exitCode=1;}finally{w?.destroy();server.close();app.exit(process.exitCode||0);}});
