import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const parse=JSON.parse,stringify=JSON.stringify,objectPrototype=Object.prototype,
 arrayPrototype=Array.prototype,getPrototypeOf=Object.getPrototypeOf,
 getOwnPropertyDescriptor=Object.getOwnPropertyDescriptor;
const sha=s=>createHash('sha256').update(s).digest('hex');
function nativeJsonDomain(){
 assert.equal(getPrototypeOf(objectPrototype),null,'Candidate JSON Object prototype changed');
 assert.equal(getPrototypeOf(arrayPrototype),objectPrototype,'Candidate JSON Array prototype changed');
 assert.equal(getOwnPropertyDescriptor(objectPrototype,'toJSON'),undefined,'Candidate JSON cannot use Object toJSON hooks');
 assert.equal(getOwnPropertyDescriptor(arrayPrototype,'toJSON'),undefined,'Candidate JSON cannot use Array toJSON hooks');
}
function jsonDomain(value,owned){
 if(typeof value==='number')assert(Number.isFinite(value),'Candidate JSON contains a nonfinite number');
 else if(value&&typeof value==='object'){
  owned.add(value);for(const k of Object.keys(value))jsonDomain(value[k],owned);
  Object.freeze(value);
 }
 return value;
}

/** Per-open private JSON admission. All caches are derived from actual freshly
 * observed JSON values, never a payload's claimed hash or caller identity.
 * The ordinary exported board validator remains the only policy decision. */
export function createSourceCandidateBoardByteValidator(inputBytes,{validate,hash,canonical}){
 nativeJsonDomain();const lockObjects=new WeakSet(),lock=jsonDomain(parse(Buffer.from(inputBytes).toString('utf8')),lockObjects),hashes=new Map(),canonicalForms=new Map();
 const expected=lock.fieldEffectTransformCatalog?.projection;let expectedReady=false,expectedForm;
 return {parseAndValidate(bytes){
  nativeJsonDomain();const valueObjects=new WeakSet(),value=jsonDomain(parse(Buffer.from(bytes).toString('utf8')),valueObjects),pendingHashes=new Map(),pendingForms=new Map();
  const qualify=v=>{
   if(v!==null&&typeof v==='object')assert(valueObjects.has(v)||lockObjects.has(v),'Candidate memo requires its actual private JSON objects');
   else if(typeof v==='number')assert(Number.isFinite(v),'Candidate memo rejects a nonfinite number');
   else assert(v===null||['undefined','string','boolean'].includes(typeof v),'Candidate memo rejects non-JSON values');
  };
  const key=v=>{nativeJsonDomain();qualify(v);const text=stringify(v);return text===undefined?'undefined':'json:'+Buffer.byteLength(text)+':'+sha(text);};
  const memo=(fn,committed,pending,v)=>{const k=key(v);if(committed.has(k))return committed.get(k);if(pending.has(k))return pending.get(k);const result=fn(v);pending.set(k,result);return result;};
  const policyApi={hash:v=>memo(hash,hashes,pendingHashes,v),canonical:v=>{
   qualify(v);
   if(v===expected){if(!expectedReady){expectedForm=canonical(v);expectedReady=true;}return expectedForm;}
   return memo(canonical,canonicalForms,pendingForms,v);
  }};
  validate(value,lock,policyApi);
  for(const [k,v]of pendingHashes)hashes.set(k,v);for(const [k,v]of pendingForms)canonicalForms.set(k,v);
  return value;
 }};
}
