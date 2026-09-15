// Zoom changes the visible crop, never the rendering surface or camera's
// distance/near plane. One million times is a numerical guard, far beyond a
// pupil close-up; it prevents non-finite projection matrices after long input.
const MIN = 1e-6, MAX = 1e6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function zoomScale(scale, factor, min = MIN, max = MAX) {
  if (!(Number.isFinite(scale) && scale > 0)) scale = 1;
  if (!(Number.isFinite(factor) && factor > 0)) return clamp(scale, min, max);
  return Math.exp(clamp(Math.log(scale) + Math.log(factor), Math.log(min), Math.log(max)));
}
export function zoomFit(fit, factor, point, min = MIN) {
  const scale = zoomScale(fit.scale, factor, min), ratio = scale / fit.scale;
  return {scale, x:point.x - (point.x - fit.x) * ratio, y:point.y - (point.y - fit.y) * ratio};
}
export function keepZoomVisible(fit, surface, bounds) {
  const [x,y,w,h] = bounds, overlap = 24;
  // Allow the crown and chin to leave the screen so any facial detail can be
  // centered. Only constrain a pan that would lose the whole projected body.
  return {...fit,
    x:clamp(fit.x, surface.x + overlap - (x+w)*fit.scale, surface.x + surface.width - overlap - x*fit.scale),
    y:clamp(fit.y, surface.y + overlap - (y+h)*fit.scale, surface.y + surface.height - overlap - y*fit.scale)};
}
export function normalizeView(view, width, height) {
  return {x:view.x/width, y:view.y/height, w:view.w/width, h:view.h/height};
}
export function pixelView(view, width, height) {
  return {x:view.x*width, y:view.y*height, w:view.w*width, h:view.h*height,
    pixelWidth:width, pixelHeight:height, projectedHeight:Math.min(4096,height/view.h)};
}
export function zoomCrop(view, before, after, point, factor) {
  // Account for the visible frame growing until it meets the display edge.
  // Further pinching shrinks the crop, with the pixel under the pointer fixed.
  const magnification = zoomScale(1/view.w, factor * before.w/after.w);
  const w = 1/magnification, h = 1/zoomScale(1/view.h, factor * before.h/after.h);
  const x = view.x + (point.x-before.x)/before.w * view.w - (point.x-after.x)/after.w * w;
  const y = view.y + (point.y-before.y)/before.h * view.h - (point.y-after.y)/after.h * h;
  return {x,y,w,h};
}
export function panCrop(view, dx, dy, rect) {
  return {...view,x:view.x-dx/rect.w*view.w,y:view.y-dy/rect.h*view.h};
}
