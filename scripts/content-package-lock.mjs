import {mkdir,open,rm} from 'node:fs/promises';
import {resolve} from 'node:path';

// Public collection producers share a lock. Pure compilation and private
// outputs have no live registry to arbitrate.
export async function acquireContentPackageLock(root){
  const build=resolve(root,'build'),file=resolve(build,'.content-package-pipeline.lock');
  await mkdir(build,{recursive:true});
  let lock;
  try{lock=await open(file,'wx');}
  catch(error){if(error.code==='EEXIST')throw new Error('Another content package pipeline holds the build lock');throw error;}
  try{await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})+'\n');}
  catch(error){await lock.close();await rm(file,{force:true});throw error;}
  let released=false;
  return async()=>{if(released)return;released=true;await lock.close();await rm(file,{force:true});};
}
