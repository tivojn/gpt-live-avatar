// The floating controls move independently of the transparent avatar stage.
export function installGroupPanel(panel,{storage=localStorage,onInteraction=()=>{}}={}){
 const key='gla-together-panel-v1',header=panel.querySelector('header'),minimize=panel.querySelector('#minimize');
 let gesture=null,expandedHeight='',saved,unfoldedAt=0;try{saved=JSON.parse(storage.getItem(key));}catch{}
 const finite=n=>Number.isFinite(n);
 function clamp(){const r=panel.getBoundingClientRect();Object.assign(panel.style,{left:Math.max(8,Math.min(innerWidth-r.width-8,r.left))+'px',top:Math.max(8,Math.min(innerHeight-r.height-8,r.top))+'px'});}
 function save(){const r=panel.getBoundingClientRect();try{storage.setItem(key,JSON.stringify({x:r.x,y:r.y,w:r.width,h:panel.classList.contains('minimized')?Number.parseFloat(expandedHeight)||null:r.height,minimized:panel.classList.contains('minimized')}));}catch{}}
 function setMinimized(value){
  if(value===panel.classList.contains('minimized'))return;
  if(value)expandedHeight=panel.style.height;
  panel.classList.toggle('minimized',value);panel.style.height=value?'auto':expandedHeight;
  minimize.title=value?'Expand':'Minimize';minimize.setAttribute('aria-label',minimize.title);minimize.setAttribute('aria-expanded',String(!value));clamp();save();
 }
 const initial=panel.getBoundingClientRect();Object.assign(panel.style,{transform:'none',left:(finite(saved?.x)?saved.x:initial.x)+'px',top:(finite(saved?.y)?saved.y:initial.y)+'px'});
 if(finite(saved?.w))panel.style.width=Math.max(360,Math.min(innerWidth-16,saved.w))+'px';
 if(finite(saved?.h))panel.style.height=Math.max(120,Math.min(innerHeight-16,saved.h))+'px';
 clamp();if(saved?.minimized)setMinimized(true);
 panel.addEventListener('pointerdown',event=>{
  const resize=event.target.closest('.panel-resize');
  if(event.button!==0||(!resize&&(!header.contains(event.target)||event.target.closest('button,input,select,a'))))return;
  if(resize&&panel.classList.contains('minimized'))return;
  const r=panel.getBoundingClientRect();gesture={id:event.pointerId,x:event.clientX,y:event.clientY,rect:r,resize:Boolean(resize)};panel.setPointerCapture(event.pointerId);onInteraction();event.preventDefault();
 });
 panel.addEventListener('pointermove',event=>{if(!gesture||gesture.id!==event.pointerId)return;const {rect,x,y,resize}=gesture,dx=event.clientX-x,dy=event.clientY-y;
  if(resize){panel.style.width=Math.min(innerWidth-rect.left-8,Math.max(360,rect.width+dx))+'px';panel.style.height=Math.min(innerHeight-rect.top-8,Math.max(120,rect.height+dy))+'px';}
  else {panel.style.left=rect.left+dx+'px';panel.style.top=rect.top+dy+'px';clamp();}
 });
 function release(event){if(!gesture||event?.pointerId!==undefined&&event.pointerId!==gesture.id)return;const {id}=gesture;gesture=null;if(panel.hasPointerCapture(id))panel.releasePointerCapture(id);save();}
 panel.addEventListener('pointerup',release);panel.addEventListener('pointercancel',release);addEventListener('blur',release);
 minimize.onclick=()=>setMinimized(!panel.classList.contains('minimized'));
 // A folded panel shows a plus in the yellow light, and any click on its header
 // unfolds it; a double-click on an open header folds it (the first click of a
 // double-click has already unfolded a folded one, so it never folds back).
 header.addEventListener('dblclick',e=>{if(!e.target.closest('button')&&!panel.classList.contains('minimized')&&performance.now()-unfoldedAt>400)setMinimized(true);});
 header.addEventListener('click',e=>{if(panel.classList.contains('minimized')&&!e.target.closest('button')){setMinimized(false);unfoldedAt=performance.now();}});
 addEventListener('resize',()=>{panel.style.width=Math.min(innerWidth-16,panel.getBoundingClientRect().width)+'px';clamp();});
 return {get dragging(){return Boolean(gesture);},setMinimized,clamp};
}
