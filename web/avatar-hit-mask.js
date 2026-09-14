// One small alpha readback per rendered silhouette; pointer events only query
// cached pixels, never synchronously read the full WebGL framebuffer.
export class AvatarHitMask {
 constructor(){this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('2d',{willReadFrequently:true});this.pixels=null;}
 update(canvas){
  const scale=192/Math.max(canvas.width,canvas.height),w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
  this.context.clearRect(0,0,w,h);this.context.drawImage(canvas,0,0,w,h);this.pixels=this.context.getImageData(0,0,w,h);
 }
 contains(x,y,width,height){
  const m=this.pixels;if(!m||x<0||y<0||x>=width||y>=height)return false;
  return m.data[(Math.floor(y/height*m.height)*m.width+Math.floor(x/width*m.width))*4+3]>18;
 }
}
