// Local singing/speech activity detection. YAMNet classifies two views of the
// mix; this is not a claim that stereo centre extraction isolates a singer.
// Keep classification out of both the rendering and real-time audio threads.
export async function createVocalDetector(context,source,{enhancedSource=source,onState,signal}={}){
  const abortError=()=>new DOMException('Singing detection was cancelled.','AbortError');
  if(signal?.aborted)throw abortError();
  const worker=new Worker(new URL('./vocal-detector-worker.js',import.meta.url));
  const state={ready:false,allowed:false,score:0,time:-Infinity,model:'yamnet',latencyMs:0};
  let closed=false,node,sink,rawFilter,enhancedFilter,rejectInit=null;
  const notify=()=>{try{onState?.({...state});}catch{}};
  const close=()=>{
    if(closed)return;closed=true;signal?.removeEventListener('abort',onAbort);state.allowed=false;state.ready=false;worker.terminate();
    if(node)node.port.onmessage=null;
    for(const [a,b] of [[source,rawFilter],[enhancedSource,enhancedFilter]])if(b)try{a.disconnect(b);}catch{}
    for(const n of [rawFilter,enhancedFilter,node,sink])try{n?.disconnect();}catch{}
  };
  const onAbort=()=>{const reject=rejectInit;close();reject?.(abortError());};
  signal?.addEventListener('abort',onAbort,{once:true});
  try{
    await new Promise((resolve,reject)=>{
      let timer;rejectInit=error=>{clearTimeout(timer);rejectInit=null;reject(error);};
      timer=setTimeout(()=>rejectInit?.(Error('The singing detector did not load.')),20000);
      worker.onerror=event=>{rejectInit?.(Error(event.message||'Singing detector failed.'));};
      worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timer);rejectInit=null;resolve();}else if(data.type==='error'){rejectInit?.(Error(data.message));}};
      worker.postMessage({type:'init'});
    });
    if(closed||signal?.aborted)throw abortError();
    state.ready=true;
    worker.onerror=()=>{state.ready=false;state.allowed=false;notify();};
    worker.onmessage=({data})=>{
      if(closed)return;
      if(data.type==='voice'){Object.assign(state,data,{ready:true,model:'yamnet'});notify();}
      else if(data.type==='error'){state.ready=false;state.allowed=false;state.error=data.message;notify();}
    };
    await context.audioWorklet.addModule(new URL('./vocal-detector-worklet.js',import.meta.url));
    if(closed||signal?.aborted)throw abortError();
    node=new AudioWorkletNode(context,'vocal-detector-capture',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:'explicit'});
    node.port.onmessage=({data})=>{if(!closed)worker.postMessage(data,[data.raw.buffer,data.enhanced.buffer]);};
    // Downsampling follows lowpass filtering so high cymbals do not alias into
    // the model's voice range. Classification includes off-centre singers.
    rawFilter=context.createBiquadFilter();rawFilter.type='lowpass';rawFilter.frequency.value=7500;rawFilter.Q.value=.707;
    enhancedFilter=context.createBiquadFilter();enhancedFilter.type='lowpass';enhancedFilter.frequency.value=7500;enhancedFilter.Q.value=.707;
    source.connect(rawFilter);rawFilter.connect(node,0,0);enhancedSource.connect(enhancedFilter);enhancedFilter.connect(node,0,1);
    sink=context.createGain();sink.gain.value=0;node.connect(sink);sink.connect(context.destination);
    return {state,allowed:()=>!closed&&state.ready&&state.allowed&&context.currentTime-state.time<.5,close};
  }catch(error){close();throw error;}
}
