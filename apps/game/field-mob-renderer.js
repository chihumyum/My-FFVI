/** Explicit flat black material filter. RGB changes; source sprite alpha,
 * logical visibility, depth and collision do not. Original pixels stay intact. */
export function filterMobPixels(image, alpha) {
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<=0||image.height<=0||
      !ArrayBuffer.isView(image.data)||image.data.length!==image.width*image.height*4||!Number.isFinite(alpha)||Math.fround(alpha)!==alpha||alpha<0||alpha>1)
    throw new Error('Invalid flat Mob filter image/alpha');
  const data=new Uint8ClampedArray(image.data),scale=1-alpha;
  for(let i=0;i<data.length;i+=4){data[i]=Math.round(data[i]*scale);data[i+1]=Math.round(data[i+1]*scale);data[i+2]=Math.round(data[i+2]*scale);}
  return {width:image.width,height:image.height,data};
}
