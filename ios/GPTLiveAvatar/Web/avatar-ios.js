import '/avatar3d.js';
import {Avatar3DMotion} from '/avatar3d-motion.js';
import {CompanionController, AvatarStudioStage, isSpatialAction, avatarIntent, motionIntent} from '/avatar3d-companion.js';
let avatar, latest, loading, reported = false, failed = false;
let companion, lastConversation = '', actionGeneration = 0, lastMotion = '';
let travelOffset={x:0,y:0}, travelClip=false, approachWalking=false, approachNativeCrop, lastNativeLayout='';
let displayedViewport, stagePreparing=false, stageTurning=false, previousSurface;
// A lunge or kick wider than the phone used to be clamped at the edge every
// frame, which read as bumping. Instead zoom out just enough for the animated
// joints to fit, and ease every viewport change so nothing jumps.
let motionSmooth=null, motionFitAt=0;
function motionFit(base,surface){
  let fit=base;
  const b=avatar.jointBounds?.();
  if(b&&!avatar.motion?.active?.gesture&&b.width>0&&b.height>0){
    const pad=Math.max(8,surface.width*.04);
    const needed=Math.min((surface.width-2*pad)/b.width,(surface.height-2*pad)/b.height);
    if(needed<base.scale){
      const s=Math.max(base.scale*.5,needed);
      const cx=base.x+(b.x+b.width/2)*base.scale, cy=base.y+(b.y+b.height)*base.scale;
      fit={scale:s,x:cx-(b.x+b.width/2)*s,y:cy-(b.y+b.height)*s};
    }
  }
  return avatar.keepMotionInViewport(fit,surface)||fit;
}
let animationFrame = 0, disposed = false;
const originalError = console.error;
const generation = Number(new URLSearchParams(location.search).get('generation'));
const report = body => window.webkit.messageHandlers.avatarStatus.postMessage({...body,generation});
console.error = (...items) => { originalError(...items); report({error:items.map(String).join(' ')}); };
window.showAvatarError = message => {
  failed = true;
  let status = document.querySelector('#status');
  if (!status) { status = document.createElement('div'); status.id = 'status'; document.body.append(status); }
  status.textContent = message;
};
const fail = error => {
  const message = String(error?.message || error);
  window.showAvatarError(message);
  report({error:message});
};
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
// The overhead bubble covers the top of the screen; walks and corner
// destinations stay in the part of the surface she can actually be seen in.
function stageSafeArea(surface){
  const top=Math.min(surface.height*.6,Math.max(0,Number(latest?.inset?.top)||0));
  const bottom=Math.min(surface.height*.3,Math.max(0,Number(latest?.inset?.bottom)||0));
  return {x:surface.x,y:surface.y+top,width:surface.width,height:surface.height-top-bottom};
}
window.updateAvatar = frame => {
  latest = frame;
  if (!loading && !failed) loading = load(frame).catch(fail);
};
async function load(frame) {
  avatar = window.OpenClamAvatar3D.create(frame.frame);
  avatar.canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    window.showAvatarError('Restarting 3D avatar…');
    report({event:'renderer-lost'});
  });
  await avatar.load('/model.gltf');
  if (failed) return;
  const releasedImages = await uploadAvatarTextures(avatar, () => failed);
  report({event:'textures-uploaded', releasedImages});
  if (failed) return;
  if (avatar.options) {
    const motion = await new Avatar3DMotion(avatar.options, {cacheLimit:2}).load('/motions/library.json');
    if (motion.clips.size) {
      avatar.motion = motion;
      companion = new CompanionController();
    }
  }
  // Walking styles depend on installed clips, so publish after motion loading.
  const catalogue = avatar.options?.catalogue() || {poses:[],outfits:[],props:[]};
  catalogue.motions = [...(avatar.motion?.clips.values() || [])].map(({id,label,category}) => ({id,label,category}));
  report({event:'catalogue', catalogue});
  document.body.append(avatar.canvas);
  animationFrame = requestAnimationFrame(draw);
}
window.disposeAvatar = () => {
  disposed = true;
  cancelAnimationFrame(animationFrame);
  avatar?.dispose();
};
// Upload every wardrobe texture before the first frame allocates morph buffers.
// ImageBitmaps otherwise retain a second decoded copy of all 51 Tia images.
// Include hidden outfits and all textures sharing a bitmap before closing it.
// A lost WebGL context reloads the page/model instead of reusing closed bitmaps.
export async function uploadAvatarTextures(avatar, stopped = () => false) {
  const images = new Map();
  avatar.model.traverse(node => {
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const texture of Object.values(material || {})) {
        if (!texture?.isTexture || typeof texture.image?.close !== 'function') continue;
        if (!images.has(texture.image)) images.set(texture.image, new Set());
        images.get(texture.image).add(texture);
      }
    }
  });
  for (const [image, textures] of images) {
    if (stopped()) return;
    for (const texture of textures) avatar.renderer.initTexture(texture);
    image.close();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return images.size;
}
let previous = 0;
const motionStatus = text => report({event:'motion-status', text});
const preference = (key,value) => {
  latest.options = {...latest.options, [key]:String(value)};
  report({event:'preference',key,value});
};
window.avatarCommand = async (value, isText = false) => {
  if (!companion || !reported || failed) return null;
  const action = isText ? avatarIntent(value) || motionIntent(value,avatar.motion.clips) : value;
  if (!action) return null;
  ++actionGeneration;stagePreparing=false;
  if(action==='reset-view'){
    companion.command('pose');avatar.motion.stop();avatar.resetCameraApproach();avatar.studioStage=null;avatar.studioDistance=null;avatar.frame();
    travelOffset={x:0,y:0};travelClip=false;approachWalking=false;approachNativeCrop=null;return '';
  }
  if (action === 'reactions-on' || action === 'reactions-off') {
    companion.reactions = action === 'reactions-on'; companion.pendingReaction = null;
    preference('dynamicMotions',companion.reactions);
    return companion.reactions ? 'Dynamic motions are on.' : 'Dynamic motions are off.';
  }
  companion.command(action); avatar.motion.stop();
  travelClip=false;approachWalking=false;
  if(action!=='stay'&&isSpatialAction(action)){
    if(latest.state.reduce)return 'Turn off Reduce Motion to walk across the stage.';
    const generation=actionGeneration;stagePreparing=true;
    try {
      await avatar.motion.prepare(action==='run-around'?'hello-run':avatar.options.walkingClip());
      if(generation!==actionGeneration)return null;
      const box=avatar.canvas.getBoundingClientRect(),surface=stageSafeArea({x:0,y:0,width:box.width,height:box.height});
      const crop=displayedViewport||latest.crop,scale=box.width/crop.w;
      if(!avatar.studioStage){
        avatar.studioStage=new AvatarStudioStage({scale,x:-crop.x*scale,y:-crop.y*scale},avatar.layout(),surface);
        avatar.lockStudioLens();travelOffset={x:0,y:0};
        avatar.studioStage.calibrate(avatar);
      }
      companion.yaw=avatar.orbit.yaw;
      avatar.studioStage.facingYaw=avatar.orbit.yaw;
      const destination=avatar.studioStage.destination(action,surface);
      if(destination)companion.destination=destination;
      preference('followCursor',true);
      return 'Moving across the stage.';
    } finally {if(generation===actionGeneration)stagePreparing=false;}
  }
  avatar.stopCameraApproach(performance.now());
  if (action === 'stay') {
    preference('dynamicMotions',false); preference('playTransitions',false);
    motionStatus('Stopped'); return 'I’ll stay here.';
  }
  if (latest.state.reduce) return 'Turn off Reduce Motion in Accessibility to play body motions.';
  const pose = {heart:'Ps001.heart',sit:'Ps004.sit',stand:''}[action];
  if (pose !== undefined) {
    report({event:'motion-framing'});
    preference('playTransitions',false);
    report({event:'pose',id:pose});
    motionStatus(action === 'heart' ? 'Heart pose' : action === 'sit' ? 'Seated' : 'Standing');
    return action === 'heart' ? 'A heart for you. ♥' : action === 'sit' ? 'Taking a seat.' : 'Standing up.';
  }
  let id = action.startsWith('clip:') ? action.slice(5) : action === 'dance' ? 'joyful-sway' : action;
  if (action === 'random-dance' || action === 'random-motion') {
    const choices = [...avatar.motion.clips.values()].filter(c =>
      (action !== 'random-dance' || c.category === 'Dances') && !(latest.options.prop && c.requiresFreeHands));
    const fresh = choices.filter(c => c.id !== lastMotion), pool = fresh.length ? fresh : choices;
    id = pool[Math.floor(Math.random()*pool.length)]?.id;
  }
  if (!avatar.motion.clips.has(id)) return null;
  if (!avatar.motion.isPortraitGesture(id)) report({event:'motion-framing'});
  const generation = actionGeneration;
  motionStatus('Loading motion…');
  try {
    const played = await avatar.motion.play(id,{loop:false});
    if (generation !== actionGeneration || !played) return 'Motion cancelled.';
    lastMotion = id;
    motionStatus('Playing: ' + avatar.motion.clips.get(id).label);
    return 'Here’s ' + avatar.motion.clips.get(id).label + '.';
  } catch (_) { motionStatus('Could not load motion. Try again.'); return 'I couldn’t load that motion. Please try again.'; }
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ++actionGeneration; avatar?.motion?.stop();avatar?.stopCameraApproach(performance.now());if(companion)companion.pause(performance.now()); }
});
// The camera crop and displayed CSS canvas must have the same aspect ratio.
// Read the actual surface, including keyboard/safe-area layout changes, and
// expand the crop uniformly if native layout and WebKit update out of step.
export function fitAvatarViewport(crop, width, height, density = 1) {
  const scale = Math.min(width / crop.w, height / crop.h);
  const w = width / scale, h = height / scale;
  return {x:crop.x + (crop.w-w)/2, y:crop.y + (crop.h-h)/2, w, h,
    pixelWidth:Math.max(8,Math.round(width*density)),
    pixelHeight:Math.max(8,Math.round(height*density))};
}
export function mobileAvatarBudget(width, height, dpr, {lowPower=false, thermal=0} = {}) {
  const constrained = lowPower || thermal >= 2;
  const edge = constrained ? 1152 : 1536, pixels = constrained ? 650000 : 1200000;
  return {interval: 1000 / (thermal >= 3 ? 15 : constrained ? 24 : 30),
    density: Math.min(dpr || 1, edge / Math.max(width,height,1),
      Math.sqrt(pixels / Math.max(width*height,1)))};
}
function draw(now) {
  if (failed || disposed) return;
  animationFrame = requestAnimationFrame(draw);
  if (!latest || document.hidden || latest.performance?.active === false) return;
  const surface = avatar.canvas.getBoundingClientRect();
  if (!(surface.width > 0 && surface.height > 0)) return;
  const budget = mobileAvatarBudget(surface.width, surface.height, window.devicePixelRatio, latest.performance);
  const state = latest.state, interval = state.reduce ? 250 : budget.interval;
  if (now - previous + .5 < interval) return;
  previous = now;
  avatar.options?.select(latest.options || {}, now);
  // The first frame establishes readiness. Do not consume a decision before
  // avatarCommand can accept it, including replies delivered during loading.
  if (companion && reported) {
    companion.reactions = latest.options?.dynamicMotions !== 'false';
    const turn = latest.conversation;
    if (turn?.id && turn.id !== lastConversation) {
      lastConversation = turn.id;
      if (Date.now()-Number(turn.created)<60000)
        companion.consider(turn.user,turn.reply,turn.suggestion,now,{clips:avatar.motion.clips,turnID:turn.turnID||turn.id});
    }
    const reaction = companion.takeReaction(now,avatar.motion.clips,
      state.reduce || Boolean((avatar.motion.active && !companion.pendingReaction?.action && !companion.pendingReaction?.clipID) || avatar.motion.pending), {hasProp:Boolean(latest.options?.prop)});
    if (reaction?.startsWith('action:')) {
      void window.avatarCommand(reaction.slice(7),false);
    } else if (reaction) {
      const generation = actionGeneration;
      void avatar.motion.play(reaction,{loop:false}).then(played => {
        if (played && generation === actionGeneration) motionStatus('Playing: ' + avatar.motion.clips.get(reaction).label);
      }).catch(() => motionStatus('Could not load motion. Try again.'));
    }
  }
  if(!companion?.walking&&!companion?.roam&&!companion?.follow&&!companion?.come&&!companion?.destination&&!stageTurning)avatar.setOrbit(latest.orbit);
  const density = budget.density;
  const resized=previousSurface&&(previousSurface.width!==surface.width||previousSurface.height!==surface.height);
  const nativeLayout=JSON.stringify([latest.crop.x,latest.crop.y,latest.crop.w,latest.crop.h,latest.orbit?.yaw,latest.orbit?.pitch]);
  if(lastNativeLayout&&nativeLayout!==lastNativeLayout&&!resized){
    stageTurning=false;companion?.pause(now);avatar.stopCameraApproach(now);
    avatar.setOrbit(latest.orbit);if(avatar.studioStage)avatar.studioStage.facingYaw=avatar.orbit.yaw;
    if(travelClip||approachWalking)avatar.motion?.stop();travelClip=false;approachWalking=false;
  }
  lastNativeLayout=nativeLayout;
  let viewport = fitAvatarViewport(latest.crop, surface.width, surface.height, density);
  if(companion&&avatar.studioStage){
    const stage=avatar.studioStage,safe=stageSafeArea({x:0,y:0,width:surface.width,height:surface.height});
    const nativeFit={scale:surface.width/viewport.w,x:-viewport.x*surface.width/viewport.w,y:-viewport.y*surface.height/viewport.h};
    if(!resized)stage.manual(nativeFit,safe);else stage.manualFit=nativeFit;
    const gait=companion.roam==='run-around'?'hello-run':avatar.options.walkingClip();
    const step=stage.step(companion,now,safe,{cursorX:(latest.pointer?.x||0)*surface.width,cursorY:(latest.pointer?.y||0)*surface.height,
      strideSpeed:avatar.motion.clips.get(gait)?.ready?.forwardSpeed,
      seen:Boolean(latest.pointer),blocked:stagePreparing||Boolean(avatar.motion.active&&!avatar.options.isTravelClip(avatar.motion.active.id)),reduce:state.reduce});
    if(step.walking&&(!travelClip||(!avatar.motion.pending&&avatar.motion.active?.id!==gait))){travelClip=true;void avatar.motion.play(gait,{loop:true}).catch(()=>{companion.command('stay');travelClip=false;motionStatus('Could not load motion. Try again.');});}
    else if(!step.walking&&travelClip){travelClip=false;avatar.motion.stop();}
    if(travelClip)avatar.motion.setPlaybackRate(step.gaitRate,now);
    if(now>=companion.pauseUntil&&(companion.roam||companion.follow||companion.come||companion.destination||step.walking||stageTurning)){
      stageTurning=Math.abs(step.yaw)>.005;avatar.setOrbit({yaw:step.yaw,pitch:0});
    }
    avatar.prepareMotionFrame?.(now,Boolean(state.reduce));
    const fit=stage.project(safe);
    viewport={...viewport,x:-fit.x/fit.scale,y:-fit.y/fit.scale,w:surface.width/fit.scale,h:surface.height/fit.scale};
  }
  previousSurface={width:surface.width,height:surface.height};
  if(!avatar.studioStage)avatar.prepareMotionFrame?.(now,Boolean(state.reduce));
  const motionOn=Boolean((avatar.motion?.active||avatar.options?.transition)&&avatar.keepMotionInViewport);
  if(motionOn||motionSmooth){
    const scale=surface.width/viewport.w, base={scale,x:-viewport.x*scale,y:-viewport.y*scale};
    const target=motionOn?motionFit(base,{x:0,y:0,width:surface.width,height:surface.height}):base;
    const k=motionSmooth?1-Math.exp(-Math.min(100,now-motionFitAt)/140):1;motionFitAt=now;
    motionSmooth=motionSmooth?{scale:motionSmooth.scale+(target.scale-motionSmooth.scale)*k,x:motionSmooth.x+(target.x-motionSmooth.x)*k,y:motionSmooth.y+(target.y-motionSmooth.y)*k}:target;
    if(!motionOn&&Math.abs(motionSmooth.scale-base.scale)<1e-4*base.scale&&Math.abs(motionSmooth.x-base.x)<.5&&Math.abs(motionSmooth.y-base.y)<.5)motionSmooth=null;
    const f=motionSmooth||base;
    viewport={...viewport,x:-f.x/f.scale,y:-f.y/f.scale,w:surface.width/f.scale,h:surface.height/f.scale};
  }
  displayedViewport={...viewport};
  const lookTarget = latest.pointer ? avatar.gazePoint({
    x:viewport.x + latest.pointer.x * viewport.w,
    y:viewport.y + latest.pointer.y * viewport.h,
  }) : null;
  const expression = {...state.expression}, mood = avatar.motion?.expression(now,state.reduce) || {};
  for (const key of Object.keys(mood)) expression[key] = Math.max(expression[key] || 0,mood[key]);
  avatar.render(now, {...state,expression,lookTarget,cameraFocus:Boolean(companion?.cameraFocus)}, viewport);
  if (!reported) {reported=true;document.querySelector('#status').remove();report({event:'rendered'});}
}
report({event:'page-ready'});
