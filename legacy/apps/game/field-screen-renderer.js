// Explicit Web2D presentation. Source numeric task/tint/backdrop state remains
// in FieldGame. This module neither advances clocks nor edits that state.
export const WEB_FIELD_SCREEN_PRESENTATION='web-field-screen-presentation-2d-v1';
export function screenPresentationPixels(image,projection){
 if(!projection||projection.policy!==WEB_FIELD_SCREEN_PRESENTATION)throw Error('Unbound screen presentation renderer');
 const{sepia_ratio:sepia,amplitude,blur_ratio:blur}=projection.parameters;
 for(const n of [sepia,amplitude,blur,projection.clockMs])if(!Number.isFinite(n)||n<0)throw Error('Invalid screen presentation projection');
 if(typeof projection.monochrome!=='boolean'||typeof projection.raster!=='boolean'||sepia>1||amplitude>5||blur>1)throw Error('Invalid screen presentation filter');
 const {width,height,data}=image;if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||!(data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw Error('Missing screen presentation framebuffer');
 const out=new Uint8ClampedArray(data.length),phase=projection.clockMs/1000*2;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  // Declared 2D scanline wave, not the source's Unity raster/shader units.
  const shift=projection.raster?Math.round(Math.sin(y/height*Math.PI*20+phase)*amplitude):0,sx=Math.max(0,Math.min(width-1,x+shift)),p=(y*width+sx)*4,q=(y*width+x)*4;
  let r=data[p],g=data[p+1],b=data[p+2];
  if(blur>0){const l=(y*width+Math.max(0,sx-1))*4,h=(y*width+Math.min(width-1,sx+1))*4;r=r*(1-blur)+(data[l]+r+data[h])/3*blur;g=g*(1-blur)+(data[l+1]+g+data[h+1])/3*blur;b=b*(1-blur)+(data[l+2]+b+data[h+2])/3*blur;}
  const sr=Math.min(255,.393*r+.769*g+.189*b),sg=Math.min(255,.349*r+.686*g+.168*b),sb=Math.min(255,.272*r+.534*g+.131*b);r+=(sr-r)*sepia;g+=(sg-g)*sepia;b+=(sb-b)*sepia;
  if(projection.monochrome){const luma=.2126*r+.7152*g+.0722*b,tint=40/255;r=g=b=luma*(1-tint)+255*tint;}
  out[q]=r;out[q+1]=g;out[q+2]=b;out[q+3]=data[p+3];
 }
 return{width,height,data:out};
}
export function renderScreenPresentation(context,width,height,projection){
 if(!projection)return;
 if(!projection.monochrome&&projection.parameters.sepia_ratio===0&&projection.parameters.amplitude===0&&projection.parameters.blur_ratio===0)return;
 const image=context.getImageData(0,0,width,height),next=screenPresentationPixels(image,projection);image.data.set(next.data);context.putImageData(image,0,0);
}
