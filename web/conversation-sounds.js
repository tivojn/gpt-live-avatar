// Original short synth cues. No samples, network requests or speech input.
export function synthConversationCue(context,kind,destination=context.destination,at=context.currentTime){
  const end=kind==='ended',ready=kind==='connected',duration=ready ? .22 : end ? .56 : .72;
  const bus=context.createGain();bus.gain.value=.6;bus.connect(destination);
  const notes=ready?[880,1320]:end?[990,660,440]:[440,660,990];
  for(let i=0;i<notes.length;i++){
    const start=at+i*(ready ? .055 : .105),length=ready ? .15 : .34;
    const osc=context.createOscillator(),gain=context.createGain();osc.type='sine';
    osc.frequency.setValueAtTime(notes[i]*(end?1.04:.92),start);osc.frequency.exponentialRampToValueAtTime(notes[i],start+.07);
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(ready ? .04 : .065,start+.014);gain.gain.exponentialRampToValueAtTime(.0001,start+length);gain.gain.setValueAtTime(0,start+length+.01);
    osc.connect(gain);gain.connect(bus);osc.start(start);osc.stop(start+length+.015);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  if(!ready){
    const length=.5,buffer=context.createBuffer(1,Math.ceil(context.sampleRate*length),context.sampleRate),data=buffer.getChannelData(0);let seed=137;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=(seed/2147483648-1);}
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;filter.type='bandpass';filter.Q.value=2;
    filter.frequency.setValueAtTime(end?2600:600,at);filter.frequency.exponentialRampToValueAtTime(end?500:3200,at+length);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.033,at+.14);gain.gain.linearRampToValueAtTime(0,at+length);
    source.connect(filter);filter.connect(gain);gain.connect(bus);source.start(at);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  // All nodes finish themselves, including in OfflineAudioContext verification.
  return {duration,bus};
}

export class ConversationSounds {
  constructor(enabled=()=>true){this.enabled=enabled;this.phase='idle';}
  transition(state,{resumed=false,reason=''}={}){
    if(reason==='voice_change'||resumed){this.phase=state;return;}
    if(state===this.phase)return;
    const previous=this.phase;this.phase=state;
    if(state==='connecting')this.play('connecting');
    else if(state==='connected'&&previous==='connecting')this.play('connected');
    else if(state==='idle'&&previous!=='idle')this.play('ended');
  }
  async play(kind){
    if(!this.enabled())return;
    const generation=this.generation=(this.generation||0)+1;
    try{
      this.context ||= new AudioContext();clearTimeout(this.timer);await this.context.resume();
      if(!this.enabled()||generation!==this.generation)return;
      // Stop an unfinished connecting sweep before the confirmation/end cue.
      const previous=this.bus;
      previous?.gain.cancelScheduledValues(this.context.currentTime);if(previous){previous.gain.setTargetAtTime(0,this.context.currentTime,.015);setTimeout(()=>previous.disconnect(),100);}
      const {duration,bus}=synthConversationCue(this.context,kind);this.bus=bus;
      this.timer=setTimeout(()=>{bus.disconnect();if(this.bus===bus)void this.context.suspend();},(duration+.15)*1000);
    }catch(error){console.warn('Conversation sound could not play:',error.message);}
  }
}
