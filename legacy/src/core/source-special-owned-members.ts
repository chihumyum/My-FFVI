import {canonical} from './canonical.js';
import {checkpointKeys} from './checkpoint-validation.js';
import type {RosterGroupTransaction} from './roster-groups.js';

/** Source wrappers use CharacterStatus IDs; actual held IDs remain GameState's. */
export type SourceSpecialOwnedCatalog={kind:'source-special-owned-members-v1';nativeSha256:string;
 gauSourceId:12;ghostSourceIds:[17,18];ghostResetAdditionalExp:0};
export function sourceSpecialOwnedCatalog():SourceSpecialOwnedCatalog{return{kind:'source-special-owned-members-v1',
 nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',gauSourceId:12,
 ghostSourceIds:[17,18],ghostResetAdditionalExp:0};}
export function validateSourceSpecialOwnedCatalog(value:SourceSpecialOwnedCatalog):void{
 if(canonical(value)!==canonical(sourceSpecialOwnedCatalog()))throw Error('Missing or unsupported source special-owned catalog');
}
export type SourceSpecialOwnedCommand={kind:'gau';firstEncounter:boolean}|{kind:'ghost';sourceId:17|18};
export function validateSpecialOwnedCommand(command:SourceSpecialOwnedCommand):void{
 if(command.kind==='gau'){checkpointKeys(command,'kind,firstEncounter');if(typeof command.firstEncounter!=='boolean')throw Error('Unknown Gau ScenarioVariable[8] branch');}
 else if(command.kind==='ghost'){checkpointKeys(command,'kind,sourceId');if(command.sourceId!==17&&command.sourceId!==18)throw Error('Unknown source Ghost identity');}
 else throw Error('Unknown source special-owned join');
}
export type SourceSpecialOwnedEventOp={kind:'special-owned-join';member:'gau'|'ghost-1'|'ghost-2';dependencies:{table:string;id:number}[]};
/** The existing FieldRoster port publishes the same draft and actor lease. */
export type SourceSpecialOwnedTransaction=RosterGroupTransaction;
