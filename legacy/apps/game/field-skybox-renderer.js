// Explicit Web2D panorama: the top third of the background samples the full
// source Texture, with source offset measured in texture pixels. Ground and
// actors compose afterwards; opaque tile/background pixels are clipped out of
// this reserved display band. Unity mesh, fog and shader passes are not claimed.
export const WEB_FLAT_SKYBOX='web-flat-skybox-panorama-v1';
const wrap=(v,size,mode)=>mode===0?((v%size)+size)%size:Math.max(0,Math.min(size-1,v));
function sample(image,x,y,definition){
 const p=(x,y)=>{const i=(wrap(y,image.height,definition.wrap[1])*image.width+wrap(x,image.width,definition.wrap[0]))*4;return image.data.subarray(i,i+4);};
 if(definition.filterMode===0)return p(Math.floor(x),Math.floor(y));
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,a=p(ix,iy),b=p(ix+1,iy),c=p(ix,iy+1),d=p(ix+1,iy+1);
 return Array.from({length:4},(_,i)=>(a[i]*(1-fx)+b[i]*fx)*(1-fy)+(c[i]*(1-fx)+d[i]*fx)*fy);
}
export function skyboxPanoramaPixels(background,projection,images){
 if(!projection||projection.policy!==WEB_FLAT_SKYBOX||!Number.isFinite(projection.offset)||!Number.isFinite(projection.blendRatio)||projection.blendRatio<0||projection.blendRatio>1)throw Error('Unbound Web Skybox projection');
 const {width,height,data}=background;if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||!(data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw Error('Invalid Skybox background pixels');
 const bound=part=>{const d=part.skybox,image=images.get('/field-skybox-media/'+d.file);if(!image||image.width!==d.width||image.height!==d.height||!(image.data instanceof Uint8ClampedArray)||image.data.length!==d.width*d.height*4)throw Error('Missing exact Skybox Texture pixels: '+d.file);return{definition:d,image};};
 const primary=bound(projection.primary),secondary=projection.secondary?bound(projection.secondary):null,out=data.slice(),band=Math.ceil(height/3);
 for(let y=0;y<band;y++)for(let x=0;x<width;x++){
  const read=({definition:d,image})=>sample(image,(x+.5)/width*image.width-.5,(y+.5)/band*image.height-.5-projection.offset,d),a=read(primary),b=secondary?read(secondary):a,t=secondary?projection.blendRatio:0,p=(y*width+x)*4,alpha=(a[3]*(1-t)+b[3]*t)/255;
  for(let k=0;k<3;k++)out[p+k]=(a[k]*(1-t)+b[k]*t)*alpha+data[p+k]*(1-alpha);out[p+3]=255*alpha+data[p+3]*(1-alpha);
 }
 return{width,height,data:out};
}
export function renderSkyboxPanorama(context,width,height,projection,images,pixels){
 if(!projection)return;
 const bound=new Map();for(const part of[projection.primary,projection.secondary])if(part){const url='/field-skybox-media/'+part.skybox.file,image=images.get(url);if(!image)throw Error('Missing source Skybox media: '+url);bound.set(url,pixels(image));}
 const frame=context.getImageData(0,0,width,height),next=skyboxPanoramaPixels(frame,projection,bound);frame.data.set(next.data);context.putImageData(frame,0,0);
}
