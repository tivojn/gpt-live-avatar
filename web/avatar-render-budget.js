// Shared desktop budget: spend pixels on visible characters, not empty desktop.
// Lighting/material choices remain independent of surface allocation and pacing.
export function renderPixelBudget(quality='balanced',characters=1,memoryGB=16){
 const constrained=memoryGB<=16, total=quality==='friendly'?(constrained?700000:1000000):quality==='best'?(constrained?1800000:3000000):(constrained?1200000:1800000);
 return Math.floor(total/Math.max(1,characters));
}
export function surfaceSize(width,height,cap,previous,now=performance.now()){
 const scale=Math.min(1,Math.sqrt(cap/Math.max(1,width*height)));
 let w=Math.max(32,Math.ceil(width*scale/64)*64),h=Math.max(32,Math.ceil(height*scale/64)*64);
 // Keep one buffer through small pose changes. A sustained smaller size frees
 // it again; growth stays immediate so props are never cropped.
 if(previous&&(now-previous.changed<1200||(w>previous.w*.75&&h>previous.h*.75))){
  const growW=Math.max(w,previous.w),growH=Math.max(h,previous.h);
  if(growW*growH<=cap*1.35){w=growW;h=growH;}
 }
 if(previous&&w===previous.w&&h===previous.h)return previous;
 return {w,h,changed:now};
}
export function frameDue(now,last,fps){
 const interval=1000/fps,elapsed=now-last;
 return elapsed<interval-.5?null:now-((elapsed+.5)%interval)+.5;
}
export function textureBudget(characters=1,memoryGB=16){
 return memoryGB<=16?(characters>2?1024:2048):characters>2?2048:4096;
}
