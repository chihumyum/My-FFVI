// Closed producer modes. Neither an old input lock nor saved content grants a
// fresh build: the fresh producer captures its own seed-free raw input fence.
export const LEGACY_SOURCE_COMPATIBILITY='legacy-source-compatibility-v1';
export const FRESH_SOURCE_PRODUCTS='fresh-source-products-v1';
export const FRESH_SOURCE_PACKAGE_NAMESPACE='/content-packages/source-products';
export const FRESH_SOURCE_INPUT_LOCK='fresh-source-product-input-lock-v1';
const policies=[1,2,3,4,5].map(n=>'source-prerequisite-input-lock-v'+n),media='source-prerequisite-input-lock-v6';
export function sourceProductionMode(value=LEGACY_SOURCE_COMPATIBILITY){
 if(![LEGACY_SOURCE_COMPATIBILITY,FRESH_SOURCE_PRODUCTS].includes(value))throw Error('Unknown source production mode');
 return value;
}
/** Unwrap only the fresh mode envelope; the separate media v6 owner retains
 * its baseLockKind and complete independent two-generation media audit. */
export function sourceInputEnvelopeKind(lock){
 const kind=lock?.kind===FRESH_SOURCE_INPUT_LOCK?lock.sourceLockKind:lock?.kind;
 if(lock?.kind===FRESH_SOURCE_INPUT_LOCK&&lock.packageNamespace!==FRESH_SOURCE_PACKAGE_NAMESPACE)throw Error('Unknown fresh source package namespace');
 if(lock?.kind===FRESH_SOURCE_INPUT_LOCK&&![...policies,media].includes(kind))throw Error('Unknown fresh source lock policy version');
 return kind;
}
export function sourceInputLockKind(lock){
 const kind=sourceInputEnvelopeKind(lock);
 if(kind===media){if(!policies.includes(lock.baseLockKind))throw Error('Unknown source media base lock policy');return lock.baseLockKind;}
 return kind;
}
export function promoteSourceInputLockKind(lock,next){
 if(!policies.includes(next))throw Error('Unknown source lock promotion');
 if(sourceInputEnvelopeKind(lock)===media){sourceInputLockKind(lock);lock.baseLockKind=next;}
 else if(lock.kind===FRESH_SOURCE_INPUT_LOCK){sourceInputLockKind(lock);lock.sourceLockKind=next;}
 else lock.kind=next;
 return lock;
}
export function freshSourceInputLock(lock){
 if(![...policies,media].includes(lock?.kind)||Object.hasOwn(lock,'sourceLockKind'))throw Error('Invalid fresh capture base lock');
 sourceInputLockKind(lock);return {...lock,kind:FRESH_SOURCE_INPUT_LOCK,sourceLockKind:lock.kind,packageNamespace:FRESH_SOURCE_PACKAGE_NAMESPACE};
}
