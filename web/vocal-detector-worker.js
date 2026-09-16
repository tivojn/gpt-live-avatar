/* YAMNet, Google/Apache-2.0. Fixed local assets; no audio or network services. */
importScripts('./vendor/tfjs/tf.min.js','./vendor/tfjs/tf-backend-wasm.min.js');
const WINDOW=15600,VOICE=[0,1,2,3,6,7,8,9,10,11,12,24,25,26,27,28,29,30,31,32];
const raw=new Float32Array(WINDOW),enhanced=new Float32Array(WINDOW);
let model=null,busy=false,queued=null,allowed=false,failed=false,filled=0;
function append(target,chunk){if(chunk.length>=WINDOW)target.set(chunk.subarray(chunk.length-WINDOW));else{target.copyWithin(0,chunk.length);target.set(chunk,WINDOW-chunk.length);}}
async function classify(view){
 const input=tf.tensor1d(view);let outputs;
 try{outputs=await model.executeAsync(input);const scores=await outputs[0].data();let score=0;for(const i of VOICE)score=Math.max(score,scores[i]||0);return score;}
 finally{input.dispose();if(outputs)tf.dispose(outputs);}
}
async function run(){
 if(busy||!queued||!model||failed)return;busy=true;
 const packet=queued;queued=null;
 try{
  const started=performance.now();const full=raw.slice(),clean=enhanced.slice();
  const score=(await classify(full)+await classify(clean))*.5;
  // Scores are class evidence, not calibrated probabilities. Hysteresis was
  // evaluated against vocal mixtures AND exact instrumental stems; a mono
  // centre-panned instrument can no longer open the gate by position alone.
  let power=0;for(const v of packet.raw)power+=v*v;const rms=Math.sqrt(power/packet.raw.length);
  allowed=filled>=8000&&rms>.0015&&score>=(allowed?.004:.008);
  postMessage({type:'voice',score,allowed,rms,time:packet.time,latencyMs:performance.now()-started});
 }catch(error){failed=true;allowed=false;postMessage({type:'error',message:error.message});}
 finally{busy=false;if(queued&&!failed)void run();}
}
onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   tf.wasm.setWasmPaths(new URL('./vendor/tfjs/',location.href).href);
   // One SIMD worker avoids shared-memory/COOP requirements and does not
   // compete with the avatar's WebGL rendering context.
   tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT',false);
   await tf.setBackend('wasm');await tf.ready();model=await tf.loadGraphModel(new URL('./vendor/yamnet/model.json',location.href).href);
   await classify(new Float32Array(WINDOW));postMessage({type:'ready'});
  }catch(error){failed=true;postMessage({type:'error',message:error.message});}
 }else if(data.type==='audio'&&!failed){
  filled=Math.min(WINDOW,filled+data.raw.length);append(raw,data.raw);append(enhanced,data.enhanced);queued=data;void run();
 }
};
