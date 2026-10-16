import { canonical } from './canonical.js';
import { assertBattleRewardFlags, parseBattleRewardPolicy, type BattleRewardPolicy } from './battle-result.js';
import { parseBattleChildAdmission, type BattleChildAdmission } from './battle-child-admission.js';
import { parseSourceBattleFlags, type BattleFlagRowSource, type SourceBattleFlags } from './battle-flags.js';

/** Source facts only. This declaration grants no actual runtime provider. */
export const WEB_BATTLE_PARTY_CONTEXT = 'web-source-battle-party-context-v1' as const;
export type WebBattlePartyContext = typeof WEB_BATTLE_PARTY_CONTEXT;
export function parseWebBattlePartyContext(raw: unknown): WebBattlePartyContext {
  if (raw !== WEB_BATTLE_PARTY_CONTEXT) throw Error('Unknown Web battle party context policy');
  return raw;
}
export type BattlePartyDescriptor = {
  partyId: number;
  source: BattleFlagRowSource;
  battleFlagGroupId: number;
  backgroundId: number;
  bgmId: number;
  appearanceProduction: number;
  notEscape: number;
  getAp: number;
  getValue: number;
  scriptId: number;
  flagRows: { flagId: number; source: BattleFlagRowSource }[];
  patterns: number[];
};
export type BattlePartyContext = {
  kind: 'source-battle-party-context-v1';
  policy: WebBattlePartyContext;
  rootPartyId: number;
  /** Immutable definitions, never a second owner of the current party. */
  entries: Record<string, BattlePartyDescriptor>;
};

function record(raw: unknown, expected?: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw Error('Invalid battle party context record');
  const descriptors = Object.getOwnPropertyDescriptors(raw), own = Reflect.ownKeys(raw);
  if (own.some(key => typeof key !== 'string') ||
      Object.values(descriptors).some(property => !property.enumerable || !('value' in property)) ||
      (expected !== undefined && Object.keys(descriptors).sort().join(',') !== expected.split(',').sort().join(',')))
    throw Error('Invalid battle party context fields');
  return Object.fromEntries(Object.entries(descriptors).map(([key, property]) => [key, property.value]));
}
function integer(raw: unknown, minimum = 0): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || Object.is(raw, -0) || raw < minimum || raw > 0x7fffffff)
    throw Error('Invalid battle party context integer');
  return raw;
}
function text(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.length || raw.trim() !== raw)
    throw Error('Invalid battle party context source text');
  return raw;
}
function source(raw: unknown, table: 'monster_party.csv' | 'battle_flag_group.csv'): BattleFlagRowSource {
  const value = record(raw, 'file,assetPath,serializedFile,objectId,rowId');
  const file = text(value.file), assetPath = text(value.assetPath), serializedFile = text(value.serializedFile),
    objectId = text(value.objectId), rowId = text(value.rowId);
  if (!(assetPath === table || assetPath.endsWith('/' + table)) ||
      !/^-?(?:0|[1-9]\d*)$/.test(objectId) || objectId === '-0' ||
      BigInt(objectId) < -(1n << 63n) || BigInt(objectId) >= (1n << 63n) ||
      !/^[1-9]\d*$/.test(rowId) || BigInt(rowId) > 0x7fffffffn)
    throw Error('Invalid battle party context physical row source');
  return { file, assetPath, serializedFile, objectId, rowId };
}
function array(raw: unknown, length?: number): unknown[] {
  if (!Array.isArray(raw) || (length !== undefined && raw.length !== length))
    throw Error('Invalid battle party context collection');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== raw.length + 1 ||
      Object.values(descriptors).some(property => !('value' in property)))
    throw Error('Invalid battle party context collection fields');
  return Array.from({ length: raw.length }, (_, index) => {
    const property = descriptors[String(index)];
    if (!property?.enumerable || !('value' in property)) throw Error('Sparse battle party context collection');
    return property.value;
  });
}

/** Keep raw source metadata even when no consumer or result provider is
 * admitted. In particular a nonzero AP fact is not an AP implementation. */
export function parseBattlePartyContext(raw: unknown): BattlePartyContext {
  const input = record(raw, 'kind,policy,rootPartyId,entries');
  if (input.kind !== 'source-battle-party-context-v1' || input.policy !== WEB_BATTLE_PARTY_CONTEXT)
    throw Error('Unknown battle party context declaration');
  const rootPartyId = integer(input.rootPartyId, 1), entries: Record<string, BattlePartyDescriptor> = {};
  for (const [key, rawEntry] of Object.entries(record(input.entries))) {
    const entry = record(rawEntry, 'partyId,source,battleFlagGroupId,backgroundId,bgmId,appearanceProduction,notEscape,getAp,getValue,scriptId,flagRows,patterns');
    const partyId = integer(entry.partyId, 1), origin = source(entry.source, 'monster_party.csv');
    if (String(partyId) !== key || origin.rowId !== key) throw Error('Changed battle party context row identity');
    const battleFlagGroupId = integer(entry.battleFlagGroupId), flagSources = new Set<string>();
    const flagRows = array(entry.flagRows).map(rawFlag => {
      const flag = record(rawFlag, 'flagId,source'), flagId = integer(flag.flagId, 1),
        origin = source(flag.source, 'battle_flag_group.csv');
      if (flagSources.has(origin.rowId)) throw Error('Duplicate battle party context flag row');
      flagSources.add(origin.rowId); return { flagId, source: origin };
    });
    if ((battleFlagGroupId === 0) !== (flagRows.length === 0)) throw Error('Missing battle party context flag group binding');
    entries[key] = { partyId, source: origin, battleFlagGroupId, flagRows,
      backgroundId: integer(entry.backgroundId), bgmId: integer(entry.bgmId),
      appearanceProduction: integer(entry.appearanceProduction), notEscape: integer(entry.notEscape),
      getAp: integer(entry.getAp), getValue: integer(entry.getValue), scriptId: integer(entry.scriptId),
      patterns: array(entry.patterns, 6).map(value => integer(value)) };
  }
  if (!Object.hasOwn(entries, rootPartyId)) throw Error('Missing battle party context root descriptor');
  return { kind: 'source-battle-party-context-v1', policy: WEB_BATTLE_PARTY_CONTEXT, rootPartyId, entries };
}

/** The actual Battle owner supplies its current ID. This pure lookup neither
 * changes that owner nor grants entry, flag or terminal-write applicability. */
export function currentBattlePartyReward(context: BattlePartyContext, partyId: number): BattleRewardPolicy {
  const bound = parseBattlePartyContext(context), descriptor = bound.entries[String(integer(partyId, 1))];
  if (!descriptor) throw Error('Missing current battle party reward descriptor');
  return parseBattleRewardPolicy({ kind: 'battle-reward-policy-v1', ap: descriptor.getAp, magicPoints: descriptor.getValue });
}

/** Join existing trusted declarations without interpreting child flags as
 * entry flags. Missing or extra descriptors cannot expand the original cut. */
export function validateBattlePartyContextBinding(
  context: BattlePartyContext,
  rootId: number,
  rootReward?: BattleRewardPolicy,
  childAdmission?: BattleChildAdmission,
  sourceFlags?: SourceBattleFlags,
): void {
  const bound = parseBattlePartyContext(context);
  if (bound.rootPartyId !== integer(rootId, 1)) throw Error('Changed battle party context root binding');
  const root = bound.entries[String(rootId)]!;
  assertBattleRewardFlags(root.flagRows.map(row=>row.flagId));
  if (rootReward !== undefined && canonical(currentBattlePartyReward(bound, rootId)) !== canonical(parseBattleRewardPolicy(rootReward)))
    throw Error('Changed battle party context root reward binding');
  const children = childAdmission === undefined ? undefined : parseBattleChildAdmission(childAdmission);
  if (children && children.rootPartyId !== rootId) throw Error('Changed battle party context child root binding');
  const childIds = Object.keys(children?.entries ?? {});
  if (childIds.includes(String(rootId)) ||
      canonical(Object.keys(bound.entries).sort()) !== canonical([String(rootId), ...childIds].sort()))
    throw Error('Changed complete battle party context descriptor directory');
  for (const child of Object.values(children?.entries ?? {})) {
    const descriptor = bound.entries[String(child.partyId)]!;
    if (canonical(descriptor.source) !== canonical(child.source) || descriptor.battleFlagGroupId !== child.flagGroupId ||
        canonical(descriptor.flagRows) !== canonical(child.flagRows) || descriptor.notEscape !== child.notEscape)
      throw Error('Changed battle party context child source/flag/escape binding');
  }
  if (sourceFlags !== undefined) {
    const flags = parseSourceBattleFlags(sourceFlags);
    if (canonical(root.source) !== canonical(flags.partySource) || root.battleFlagGroupId !== flags.groupId ||
        canonical(root.flagRows) !== canonical(flags.rows)) throw Error('Changed battle party context entry flag binding');
  }
}
