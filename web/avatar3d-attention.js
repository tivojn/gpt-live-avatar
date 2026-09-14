// Per-character attention, driven by elapsed time rather than frame count.
// Small binocular saccades preserve eye contact without moving the head.
export class NaturalAttention {
  constructor(random = Math.random) {
    this.random = random; this.nextBlink = 0; this.blinkAt = -Infinity;
    this.nextLook = 0; this.lookAt = 0; this.from = {x:0,y:0}; this.to = {x:0,y:0};
    this.offset = {x:0,y:0}; this.duration = 180; this.double = false;
  }
  sample(now, {reduce=false} = {}) {
    if (reduce) return {blink:{l:0,r:0},eyeOffset:{x:0,y:0}};
    const r = this.random;
    if (!this.nextBlink) this.nextBlink = now + 800 + r()*3000;
    if (now >= this.nextBlink) {
      this.blinkAt = now; this.duration = 130 + r()*120;
      const repeat = !this.double && r()<.13;
      this.nextBlink = now + (repeat ? this.duration + 85 + r()*150 : 1800 + r()*4400);
      this.double = repeat;
    }
    const phase = (now-this.blinkAt)/this.duration;
    // Fast closure, a brief closed interval, then a gentler reopening.
    let blink = 0;
    if (phase>=0 && phase<1) {
      const u = phase<.32 ? phase/.32 : phase<.43 ? 1 : (1-phase)/.57;
      blink = u*u*(3-2*u);
    }
    if (now >= this.nextLook) {
      this.from = {...this.offset}; this.lookAt=now;
      const angle=r()*Math.PI*2, amplitude=.003+r()*.009;
      this.to={x:Math.cos(angle)*amplitude,y:Math.sin(angle)*amplitude*.55};
      this.nextLook=now+400+r()*2300; this.lookDuration=45+r()*55;
    }
    const t=Math.min(1,Math.max(0,(now-this.lookAt)/this.lookDuration)),u=t*t*(3-2*t);
    this.offset={x:this.from.x+(this.to.x-this.from.x)*u,y:this.from.y+(this.to.y-this.from.y)*u};
    return {blink:{l:blink,r:blink},eyeOffset:{...this.offset}};
  }
}
