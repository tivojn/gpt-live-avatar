// Frame the face using the avatar's original projection, with space for hair.
// The explicit crop avoids changing the model, lens, pose or wardrobe.
export function closeupFit(layout,surface,crown){
 const [x,y,w,h]=layout.faceBounds||layout.bounds;
 const top=Math.min(y-h*.18,Number.isFinite(crown?.y)?crown.y-h*.06:y);
 const left=x-w*.24,right=x+w*1.24,bottom=y+h*1.14;
 const scale=Math.min(surface.width*.88/(right-left),surface.height*.88/(bottom-top));
 return {scale,x:surface.x+surface.width/2-(left+right)/2*scale,y:surface.y+surface.height/2-(top+bottom)/2*scale};
}
export function closeupView(avatar){
 const fit=closeupFit(avatar.layout(),{x:0,y:0,width:avatar.width,height:avatar.height},avatar.crownProjection());
 return {x:-fit.x/fit.scale,y:-fit.y/fit.scale,w:avatar.width/fit.scale,h:avatar.height/fit.scale,pixelWidth:avatar.width,pixelHeight:avatar.height,projectedHeight:1536*fit.scale};
}
