import {z}from'zod';import{record}from'./content.js';import{int32}from'../core/script-integer.js';import type{FieldScreenPresentationCommand}from'../core/field-screen-presentation.js';
export const screenPresentationMnemonics=['ScreenEffect','BackdropColor']as const;
export const screenPresentationSelectors=['モノクロフィルターかける','モノクロフィルターはずす','セピア中めまい開始','セピア中めまい終了','セピア中めまい再生中']as const;
export function compileFieldScreenPresentation(raw:unknown):{kind:'field-screen-presentation';command:FieldScreenPresentationCommand}{
 const i=record(raw),o=record(i.operands);if(i.type!==1)throw Error('Screen presentation requires MainCore source type1');
 const ints=z.array(z.unknown()).length(8).parse(o.iValues).map(int32),reals=z.array(z.number().finite()).length(8).parse(o.rValues),strings=z.array(z.string()).length(8).parse(o.sValues);
 let command:FieldScreenPresentationCommand;
 if(i.mnemonic==='ScreenEffect'){
  if(ints.slice(4).some(v=>v!==0)||reals.slice(1).some(v=>v!==0)||strings.some(v=>v!==''))throw Error('Unknown source ScreenEffect operand shape');
  if(![1,3].includes(ints[0]!))throw Error('ScreenEffect preset requires unresolved native texture, parameter or warp-callback provider');
  const seconds=Math.fround(reals[0]!);if(!Number.isFinite(seconds)||seconds<0)throw Error('Negative or overflowing ScreenEffect task duration is outside the declared Web2D clock');
  command={kind:'preset',preset:ints[0]as 1|3,fadeIn:ints[1]===0,seconds,sourceCenter:{x:ints[2]!,y:ints[3]!}};
 }else if(i.mnemonic==='BackdropColor'){
  if(ints.slice(4).some(v=>v!==0)||ints.slice(0,4).some(v=>v<0||v>255)||reals.slice(1).some(v=>v!==0)||strings.some(v=>v!==''))throw Error('Unknown source BackdropColor operand shape');
  const seconds=Math.fround(reals[0]!);if(!Number.isFinite(seconds))throw Error('BackdropColor duration overflow');command={kind:'backdrop',seconds,color:{r:Math.fround(ints[0]!/255),g:Math.fround(ints[1]!/255),b:Math.fround(ints[2]!/255),a:Math.fround(ints[3]!/255)}};
 }else if(i.mnemonic==='SysCall'&&(screenPresentationSelectors as readonly string[]).includes(strings[0]!)){
  if(ints.some(v=>v!==0)||reals.some(v=>v!==0)||strings.slice(1).some(v=>v!==''))throw Error('Unknown source screen presentation selector operands');
  const n=screenPresentationSelectors.indexOf(strings[0]as typeof screenPresentationSelectors[number]);command=n<2?{kind:'monochrome',enabled:n===0}:{kind:'sepia-sickness',action:(['start','stop','playing']as const)[n-2]!};
 }else throw Error('Unknown source screen presentation instruction');
 return{kind:'field-screen-presentation',command};
}
