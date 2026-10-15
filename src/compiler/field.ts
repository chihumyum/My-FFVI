import { compileFieldPuppetReplacementInstruction,sourcePuppetReplacementSelectors } from './field-puppet-replacement.js';
import {compileFieldScreenPresentation,screenPresentationMnemonics,screenPresentationSelectors} from "./field-screen-presentation.js";
import { compileFieldMobControl } from "./field-mob-controls.js";
import { compileFieldBirdViewMoveInstruction } from "./field-bird-view-actors.js";
import { compileFieldStandaloneWaitInstruction, sourceStandaloneWaitSelector } from "./field-standalone-wait.js";
import { compileFieldViewChangeInstruction } from './field-view-change.js';
import { worldAutoMnemonics, compileFieldWorldAutoInstruction,compileFieldWorldAutoMove } from './field-world-auto-tasks.js';
import { compileSourcePartySelectionInstruction, sourcePartySelectionSelectors } from './source-party-selection.js';
import { compileSourceGilTagInstruction } from "./source-message-fees.js";
import { compileFieldPuppetRouteInstruction } from "./field-puppet-route.js";
import { compileFieldScriptRandomInstruction } from "./field-script-random.js";
import { compileFieldAssignedRouteInstruction } from './field-assigned-route.js';
import { compileFieldFiniteAnimationInstruction } from './field-play-animation.js';
import { decodeSourceSystemFlags, type SourceFormatFlagImportBinding } from "./source-system-flags.js";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { hash, record } from "./content.js";
import { ImportedProject } from "../contracts.js";
import { compileEntityGroup } from "./entity-group.js";
import { compileManualMessageInstruction } from "./message.js";
import { compileSourceMessageInstruction } from "./source-message.js";
import { compileSourceMessageSequenceInstruction } from "./source-message-sequence.js";
import { compileFieldChoiceInstruction, type FieldChoiceCompileContext } from "./field-choice.js";
import { compileEventContextBranchInstruction, eventContextBranchMnemonics } from "./event-context-branch.js";
import { compileFieldScriptShopInstruction, fieldScriptShopSelectors } from "./field-script-shop.js";
import { compileFieldPartyQueryInstruction, fieldPartyQueryMnemonics } from "./field-party-queries.js";
import { compileEventScriptTransitionInstruction, compileEventScriptTransitionMetadata } from "./event-script-transition.js";
import { tableId } from "./table-id.js";
import { loadMinimapMedia } from "./map-ui.js";
import { loadAudioMedia } from "./audio.js";
import { compileMapGeometry, type MapTexture } from "./map-geometry.js";
import { bindTileAnimationRegions } from "./tile-animation.js";
import { compileInventoryEvent } from "./inventory-event.js";
import { compileTreasureBoxInstruction, compileTreasureInventoryLimits } from "./treasure-inventory.js";
import { compileNarsheMapEntrySeed } from "./map-party-entry.js";
import { compileFieldTransportationInstruction, fieldTransportationMnemonics, fieldTransportationSelectors } from "./field-transportation.js";
import { compilePartyEvent } from "./party.js";
import { compileOwnedConditionInstruction } from "./owned-condition.js";
import { compileFieldRecoveryInstruction } from "./field-recovery.js";
import { compileSourcePresentationInstruction, sourcePresentationSelectors } from "./source-presentation.js";
import { compileAudioReadinessInstruction } from "./audio-readiness.js";
import { compileFieldSoundInstruction, fieldSoundMnemonics } from "./field-sound.js";
import { compileFieldBgmControlInstruction, fieldBgmControlMnemonics } from "./field-bgm-control.js";
import { compileFieldTimerInstruction, fieldTimerMnemonics, fieldTimerSelectors } from "./field-timer.js";
import { compileFieldScreenEffectInstruction, fieldScreenEffectMnemonics } from "./field-screen-effects.js";
import { compileFieldShakeInstruction } from "./field-shake.js";
import { compileFieldContentInvalidationInstruction } from "./field-content-invalidations.js";
import { compileFieldAutoSaveInstruction } from "./field-auto-save.js";
import { compileFieldInternalClockInstruction } from "./field-internal-clock.js";
import { compileSourceBossEncounterInstruction, compileSourceBattleResultInstruction } from './source-boss-encounter.js';
import { compileSourceEncounterInstruction } from "./source-encounter.js";
import { compilePlayerVisibilityInstruction, compilePlayerVisibilityFactory, playerVisibilityMnemonics } from "./player-visibility.js";
import { compileFieldTaskControlInstruction, fieldTaskControlMnemonics } from "./field-task-control.js";
import { compileFieldFadeInstruction } from "./field-fade.js";
import { compileFieldCameraInstruction, compileFieldCameraMotionInstruction, fieldCameraSelectors } from "./field-camera.js";
import { compileFieldScriptMotionInstruction, fieldScriptMotionMnemonics } from "./field-script-motion.js";
import { compileFieldNativePosition } from "./field-native-position.js";
import { compileFieldActorVisibilityInstruction, fieldActorVisibilityMnemonics } from "./field-actor-visibility.js";
import { DEVELOPMENT_TRANSPARENT_FADE } from "../core/field-fade.js";
import { loadSystemSource } from "./system-source.js";
import { compileTransportationCatalog, compileNarsheTransportationCheckpoint } from "./transportation.js";
import { compilePartyActorCatalog, compileNarshePartyActorCheckpoint } from "./party-actors.js";
import { compileOwnedCharacterInitialization } from "./owned-character.js";
import { compileOrdinaryWeaponEffects } from "./ordinary-weapon.js";
import { compileInitialPartyState } from "./party.js";
import { compileFieldEntryContext } from "./field-entry-context.js";
import { activePartyMembers } from "../core/party.js";
import {
  compileRosterLifecycleEvent,
  rosterLifecycleKnownSelectors,
} from "./roster.js";
import {
  int32,
  isCategory,
  isOperator,
  validVariable,
  type VariableRef,
  type EventValue,
  type ScriptLocals,
} from "../core/event-state.js";
import type {
  Character,
  Direction,
  Evidence,
  FieldContent,
  FieldEntity,
  Op,
  Site,
} from "../field/types.js";
const directions: Direction[] = ["up", "right", "down", "left"];
const integer = (x: unknown): number => {
  if (!Number.isSafeInteger(x)) throw new Error(`Expected integer: ${x}`);
  return x as number;
};
const string = (x: unknown): string => {
  if (typeof x !== "string") throw new Error("Expected string");
  return x;
};
const list = (x: unknown): unknown[] => {
  if (!Array.isArray(x)) throw new Error("Expected array");
  return x;
};
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");

/** DataStorage.CreateScriptLocal copies initial values only when their count matches the labels. */
export function decodeScriptLocals(raw: unknown): ScriptLocals | null {
  const data = record(raw);
  if (data.ScriptLocal == null) return null;
  return {
    labels: list(data.ScriptLocal).map(string),
    values:
      data.ScriptLocalValue == null
        ? null
        : list(data.ScriptLocalValue).map(int32),
  };
}

/** Only the visual-preservation flag is consumed by the admitted recovery path.
 * Other Format flags remain separate capabilities, never inferred defaults. */
export function decodeConditionVisualFlag(raw: unknown, binding?: SourceFormatFlagImportBinding): { keepBadStatusVisual: boolean } | null {
  const flags = record(raw).SystemFlag;
  if (flags == null) return null;
  const value = binding ? decodeSourceSystemFlags(raw, binding).values.KeepBadStatusVisual : record(flags).KeepBadStatusVisual;
  if (value === undefined) return null;
  if (value !== 0 && value !== 1) throw new Error("Unresolved source KeepBadStatusVisual flag");
  return { keepBadStatusVisual: value === 1 };
}

/** Unsupported parameter forms survive as executable stops, never no-ops. */
export function decodeFieldOp(
  raw: unknown,
  site: Site,
  messages: Record<string, unknown>,
  tables: Record<string, unknown> = {},
  context?: FieldChoiceCompileContext,
): Op {
  const m = record(raw), name = string(m.mnemonic);
  const blocked = (reason: string): Op => ({
    ...site,
    kind: "blocked",
    mnemonic: name,
    reason,
  });
  if ((name === "Nop" || name === "Blank") && Object.hasOwn(m, "type")) {
    try { return { ...site, ...compileFieldInternalClockInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "ChangeView") {
    try { return { ...site, ...compileFieldViewChangeInstruction(raw) }; }
    catch(error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (worldAutoMnemonics.includes(name as typeof worldAutoMnemonics[number])) {
    try { return {...site,...compileFieldWorldAutoInstruction(raw)}; }
    catch(error) {return blocked(error instanceof Error ? error.message : String(error));}
  }
  if(name==='AddAirShipMoveTask'){try{return {...site,...compileFieldWorldAutoMove(raw)};}catch(error){return blocked(error instanceof Error?error.message:String(error));}}
  if (name === "SetGilTag") {
    try { return { ...site, ...compileSourceGilTagInstruction(raw, tables) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "Route") {
    try { return { ...site, ...compileFieldPuppetRouteInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "SetRandomValue") {
    try { return { ...site, ...compileFieldScriptRandomInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "AutoSave") {
    try { return { ...site, ...compileFieldAutoSaveInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if ((fieldBgmControlMnemonics as readonly string[]).includes(name)) {
    try { return { ...site, ...compileFieldBgmControlInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if ((screenPresentationMnemonics as readonly string[]).includes(name)) {
    try { return { ...site, ...compileFieldScreenPresentation(raw) }; }
    catch(error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if ((fieldScreenEffectMnemonics as readonly string[]).includes(name)) {
    try { return { ...site, ...compileFieldScreenEffectInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "InvalidateTelepo") {
    try { return { ...site, ...compileFieldContentInvalidationInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "Shake") {
    try { return { ...site, ...compileFieldShakeInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  const timerSelector = name === "SysCall" && record(m.operands).sValues;
  if ((fieldTimerMnemonics as readonly string[]).includes(name) ||
      Array.isArray(timerSelector) && (fieldTimerSelectors as readonly unknown[]).includes(timerSelector[0])) {
    try { return { ...site, ...compileFieldTimerInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (fieldSoundMnemonics.some(mnemonic => mnemonic === name)) {
    try { return { ...site, ...compileFieldSoundInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "FadeIn" || name === "FadeOut") {
    try { return { ...site, ...compileFieldFadeInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "Select") {
    try { return { ...site, ...compileFieldChoiceInstruction(raw, messages, tables, context) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (eventContextBranchMnemonics.some(mnemonic => mnemonic === name)) {
    try { return { ...site, ...compileEventContextBranchInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "ChangeScript") {
    try { return { ...site, ...compileEventScriptTransitionInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (fieldPartyQueryMnemonics.some(mnemonic => mnemonic === name)) {
    try { return { ...site, ...compileFieldPartyQueryInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "HideMob" || name === "RestoreMob") {
    try { return { ...site, ...compileFieldMobControl(raw) }; } catch(error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "MoveBirdView") {
    try { return { ...site, ...compileFieldBirdViewMoveInstruction(raw) }; }
    catch (error) { return { ...site, kind: "blocked", mnemonic: name, reason: error instanceof Error ? error.message : String(error) }; }
  }
  if (fieldScriptMotionMnemonics.some(mnemonic => mnemonic === name)) {
    try { return { ...site, ...compileFieldScriptMotionInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === 'AssignMoveRoute') {
    try { return { ...site, ...compileFieldAssignedRouteInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  const o = record(m.operands), i = list(o.iValues).map(integer),
    r = list(o.rValues).map(Number), s = list(o.sValues).map(string);
  if(name==='SysCall'&&(screenPresentationSelectors as readonly string[]).includes(s[0]??'')){try{return {...site,...compileFieldScreenPresentation(raw)};}catch(error){return blocked(error instanceof Error?error.message:String(error));}}
  if(name==='SysCall' && (sourcePartySelectionSelectors as readonly unknown[]).includes(s[0])) {
    try {return {...site,...compileSourcePartySelectionInstruction(raw)};}
    catch(error){return blocked(error instanceof Error?error.message:String(error));}
  }
  if (name === "SysCall" && s[0] === sourceStandaloneWaitSelector) {
    try { return { ...site, ...compileFieldStandaloneWaitInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if(name==='SysCall'&&s[0]==='戦闘結果取得'){try{return {...site,...compileSourceBattleResultInstruction(raw)};}catch(error){return blocked(error instanceof Error?error.message:String(error));}}
  if(name==='SysCall'&&sourcePuppetReplacementSelectors.includes(s[0]!)){
    try{return {...site,...compileFieldPuppetReplacementInstruction(raw)};}
    catch(error){return blocked(error instanceof Error?error.message:String(error));}
  }
  if (name === "SysCall" && fieldScriptShopSelectors.includes(s[0]!)) {
    try { return { ...site, ...compileFieldScriptShopInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (Object.hasOwn(m, "type") && fieldActorVisibilityMnemonics.some((mnemonic) => mnemonic === name)) {
    try { return { ...site, ...compileFieldActorVisibilityInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (fieldTransportationMnemonics.some((mnemonic) => mnemonic === name) ||
      name === "SysCall" && fieldTransportationSelectors.includes(s[0]!)) {
    try { return { ...site, ...compileFieldTransportationInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "MsgFinishWait") {
    try { return { ...site, ...compileSourceMessageSequenceInstruction(raw, messages, context, tables["character_default_name.csv"]) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "Msg" && [0, 3].includes(i[0]!) && r[0] === 0) {
    try { return { ...site, ...compileManualMessageInstruction(raw, messages, context, tables["character_default_name.csv"]) }; }
    catch {
      try { return { ...site, ...compileSourceMessageSequenceInstruction(raw, messages, context, tables["character_default_name.csv"]) }; }
      catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
    }
  }
  if (name === "MsgClose") {
    try { return { ...site, ...compileSourceMessageInstruction(raw, messages) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "Msg") {
    try { return { ...site, ...compileSourceMessageInstruction(raw, messages) }; }
    catch {
      try { return { ...site, ...compileSourceMessageSequenceInstruction(raw, messages, context, tables["character_default_name.csv"]) }; }
      catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
    }
  }
  const form = (is: number[], rs: number[] = [], ss: number[] = []) =>
    i.every((v, n) => v === 0 || is.includes(n)) &&
    r.every((v, n) => v === 0 || rs.includes(n)) &&
    s.every((v, n) => v === "" || ss.includes(n));
  const simple = {
    Nop: "nop",
    Exit: "exit",
    Hide: "hide",
  } as const;
  if (Object.hasOwn(simple, name) && form([]))
    return { ...site, kind: simple[name as keyof typeof simple] };
  if (fieldTaskControlMnemonics.some((mnemonic) => mnemonic === name)) {
    try { return { ...site, ...compileFieldTaskControlInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (playerVisibilityMnemonics.some((mnemonic) => mnemonic === name)) {
    try { return { ...site, ...compilePlayerVisibilityInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "ReadyBGM" || name === "SyncBGM") {
    try { return { ...site, ...compileAudioReadinessInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "SysCall" && sourcePresentationSelectors.some((selector) => selector === s[0])) {
    try { return { ...site, ...compileSourcePresentationInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "SysCall" && fieldCameraSelectors.some((selector) => selector === s[0])) {
    try { return { ...site, ...compileFieldCameraInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (
    name === "SysCall" &&
    m.type === 1 &&
    i.length === 8 &&
    r.length === 8 &&
    s.length === 8 &&
    form([], [], [0]) &&
    rosterLifecycleKnownSelectors.includes(s[0]!)
  ) {
    try {
      return { ...site, ...compileRosterLifecycleEvent(s[0]!, tables) };
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
  }
  if (
    (name === "GetItem" || name === "RemoveItem" || name === "RemoveGil") &&
    m.type === 1 &&
    form(name === "RemoveGil" ? [0] : [0, 1])
  ) {
    try {
      return { ...site, ...compileInventoryEvent(name, i, tables) };
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
  }
  if (name === "TreasureBox") {
    try {
      const request = compileTreasureBoxInstruction(raw);
      return { ...site, ...request };
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
  }
  if (name === "AddCondition" || name === "RemoveCondition") {
    try { return { ...site, ...compileOwnedConditionInstruction(raw, tables) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "RecoveryHP" || name === "RecoveryMP") {
    try { return { ...site, ...compileFieldRecoveryInstruction(raw, tables) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (
    (name === "OrganizePartySlot" || name === "ChangePartySlot") &&
    m.type === 1 &&
    i.length === 8 &&
    r.length === 8 &&
    s.length === 8 &&
    form(name === "OrganizePartySlot" ? [0, 1, 2, 3, 4] : [0, 1])
  ) {
    try {
      return { ...site, ...compilePartyEvent(name, i, tables) };
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
  }
  if (name === "SetEntities" && m.type === 1 && form([], [], [0]) && s[0])
    return { ...site, kind: "entities", group: s[0] };
  // Runtime dispatch validates tile regions or unmounted actor media.
  // Unsupported target families and missing animation keys remain blockers.
  if (
    name === "CueAnim" &&
    m.type === 2 &&
    form([], [0], [0]) &&
    Number.isFinite(r[0]) &&
    Number.isFinite(Math.fround(r[0]!))
  )
    return {
      ...site,
      kind: "animation-cue",
      animation: s[0] ?? "",
      frame: Math.fround(r[0]!),
    };
  if (name === "PlayAnim" && m.type === 2 && i[1]! > 1) {
    try { return { ...site, ...compileFieldFiniteAnimationInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (
    name === "PlayAnim" &&
    m.type === 2 &&
    form([1], [0], [0]) &&
    [0, 1, -1].includes(i[1]!) &&
    Number.isFinite(r[0]) &&
    r[0]! >= 0
  ) {
    const speed = Math.fround(r[0] || 1);
    if (
      speed > 0 &&
      Number.isFinite(speed) &&
      Number.isFinite(Math.fround(1 / speed)) &&
      Math.fround(1 / speed) > 0
    )
      return {
        ...site,
        kind: "animation-play",
        animation: s[0] ?? "",
        speed,
        loop: i[1] === -1,
      };
  }
  // Source Audio.PlayBGM/PlayEnvSe: i0 master ID, i1 async, i2 channel, r0 fade, r1 seek.
  // Synchronous playback, pan and negative fades remain explicit blockers.
  if (
    ["PlayBGM", "PlayEnvSe"].includes(name) &&
    m.type === 1 &&
    form([0, 1, 2], [0, 1]) &&
    i[0]! > 0 &&
    i[1] === 1 &&
    [0, 1].includes(i[2]!) &&
    (name === "PlayBGM" || (r[1] ?? 0) === 0) &&
    [r[0] ?? 0, r[1] ?? 0].every((n) => Number.isFinite(n) && n >= 0)
  )
    return {
      ...site,
      kind: name === "PlayBGM" ? "bgm-play" : "environment-play",
      track: int32(i[0]),
      channel: i[2]!,
      fade: Math.fround(r[0] ?? 0),
      seek: Math.fround(r[1] ?? 0),
    };
  if (
    ["StopBGM", "StopEnvSe"].includes(name) &&
    m.type === 1 &&
    form([0], [0]) &&
    [0, 1].includes(i[0]!) &&
    Number.isFinite(r[0] ?? 0) &&
    (r[0] ?? 0) >= 0
  )
    return {
      ...site,
      kind: name === "StopBGM" ? "bgm-stop" : "environment-stop",
      channel: i[0]!,
      fade: Math.fround(r[0] ?? 0),
    };
  // MnemonicField.ChangeMap, RVA 0xB4F500: reserve s[0], then load map/PointIn.
  if (
    name === "ChangeMap" &&
    m.type === 1 &&
    form([0, 1, 2, 3, 4], [], [0]) &&
    i.length >= 5 &&
    i[0]! > 0 &&
    i[1]! >= 0
  )
    return {
      ...site,
      kind: "change-map",
      request: {
        mapId: int32(i[0]),
        entrance: int32(i[1]),
        continuation: s[0] || null,
        birdview: i[2] !== 0,
        skipFade: i[3] !== 0,
        skipBgm: i[4] !== 0,
        origin: "script",
      },
    };
  if (name === "Jump" && m.type === 1 && form([0]) && i[0]! >= 0)
    return { ...site, kind: "jump", target: i[0]! };
  const variable = (
    category: string | undefined,
    index: number | undefined,
  ): VariableRef | null => {
    if (category === undefined || index === undefined || !isCategory(category))
      return null;
    const ref = { category, index };
    return validVariable(ref) ? ref : null;
  };
  if (
    ["SetFlag", "ResetFlag", "FlipFlag"].includes(name) &&
    m.type === 1 &&
    form([0], [], [0])
  ) {
    const ref = variable(s[0], i[0]);
    if (ref)
      return {
        ...site,
        kind: "flag",
        ref,
        operation:
          name === "SetFlag" ? "set" : name === "ResetFlag" ? "reset" : "flip",
      };
  }
  if (
    (name === "Calc" || name === "Branch") &&
    m.type === 1 &&
    form(name === "Branch" ? [0, 1, 2] : [0, 1], [], [0, 1, 2])
  ) {
    const left = variable(s[0], i[0]),
      rightRef = variable(s[2], i[1]);
    let right: EventValue | null = null;
    if (s[2] === "imm" && i[1] !== undefined)
      right = { kind: "immediate", value: int32(i[1]) };
    else if (rightRef) right = { kind: "variable", ref: rightRef };
    if (left && right && s[1] !== undefined && isOperator(s[1])) {
      if (name === "Calc")
        return { ...site, kind: "calc", left, operator: s[1], right };
      if (i[2] !== undefined && i[2] >= 0)
        return {
          ...site,
          kind: "branch",
          left,
          operator: s[1],
          right,
          target: i[2],
        };
    }
  }
  if (name === "Wait" && form([], [0]) && Number.isFinite(r[0]) && r[0]! >= 0)
    return { ...site, kind: "wait", seconds: r[0]! };
  if (name === "SetPos") {
    try {
      const nativeCommand = compileFieldNativePosition(raw);
      let cameraCommand: Extract<Op, { kind: "position" }>["cameraCommand"];
      try {
        const motion = compileFieldCameraMotionInstruction(raw).command;
        if (motion.kind === "set-position") cameraCommand = motion;
      } catch { /* Ordinary character admission does not grant dummy admission. */ }
      return { ...site, kind: "position", x: nativeCommand.x, y: nativeCommand.y, animation: nativeCommand.animation,
        nativeCommand, ...(cameraCommand ? { cameraCommand } : {}) };
    } catch (error) {
      if (Object.hasOwn(m, "type")) return blocked(error instanceof Error ? error.message : String(error));
      // Older authored fixtures without a source instruction type retain their
      // bounded decoder. A rejected source command cannot use this fallback.
    }
  }
  if (
    name === "SetPos" &&
    form([0, 1, 2], [], [0]) &&
    [0, 3].includes(i[2]!) &&
    ["", "Default", "WalkL"].includes(s[0]!)
  ) {
    let cameraCommand: Extract<Op, { kind: "position" }>["cameraCommand"];
    try {
      const motion = compileFieldCameraMotionInstruction(raw).command;
      if (motion.kind === "set-position") cameraCommand = motion;
    } catch { /* Ordinary actor admission does not grant camera admission. */ }
    return { ...site, kind: "position", x: i[0]!, y: i[1]!, animation: s[0]!,
      ...(cameraCommand ? { cameraCommand } : {}) };
  }
  if (name === "LookAt" && form([0]) && directions[i[0]!])
    return { ...site, kind: "look", direction: directions[i[0]!]! };
  if(name==='EncountBoss'){try{return {...site,...compileSourceBossEncounterInstruction(raw)};}catch(error){return blocked(error instanceof Error?error.message:String(error));}}
  if (name === "Encount" && Object.hasOwn(m, "type")) {
    try { return { ...site, ...compileSourceEncounterInstruction(raw) }; }
    catch (error) { return blocked(error instanceof Error ? error.message : String(error)); }
  }
  if (name === "Encount" && form([0], [], [0]))
    return { ...site, kind: "encounter", party: i[0]!, continuation: s[0]! };
  return blocked("Instruction or operand form has not been migrated");
}

export async function compileField(root: string): Promise<FieldContent> {
  const imported = await readSnapshot(root + "/build/import"),
    extra = await readSnapshot(root + "/build/field");
  const project = ImportedProject.parse(
    JSON.parse(snapshotFile(imported, "project.json").toString()),
  );
  const field = record(
    JSON.parse(snapshotFile(extra, "field.json").toString()),
  );
  // This checkpoint is a reviewed source profile, not a generic new-game initializer.
  if (
    project.sourceSetHash !==
    "6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965"
  )
    throw new Error("Opening checkpoint needs review for this source set");
  if (
    hash(project.sources) !== project.sourceSetHash ||
    field.parentSourceSetHash !== project.sourceSetHash ||
    hash(field.sources) !== field.sourceSetHash
  )
    throw new Error("Field source manifest does not match base import");
  const extended = list(field.sources).map(record);
  for (const src of project.sources)
    if (
      !extended.some(
        (x) =>
          x.file === src.file &&
          x.sha256 === src.sha256 &&
          x.bytes === src.bytes,
      )
    )
      throw new Error("Field sources dropped a parent dependency");
  if (
    !project.sources.some(
      (s) =>
        s.file === "GameAssembly.dll" &&
        s.sha256 ===
          "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    )
  )
    throw new Error("Unreviewed native collision/animation profile");
  if (
    !project.sources.some(
      (s) =>
        s.file.endsWith("/Metadata/global-metadata.dat") &&
        s.sha256 ===
          "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
    )
  )
    throw new Error("Unreviewed native metadata profile");
  const tables = record(
    JSON.parse(snapshotFile(imported, "tables.json").toString()),
  );
  // The opening import is a selected table closure. Message substitutions
  // require the complete verified name namespace, independently of ownership.
  const systemSource = await loadSystemSource(root, project.sourceSetHash);
  tables["character_default_name.csv"] = systemSource.tables["character_default_name.csv"];
  const assets = project.narshe.assets;
  const asset = (name: string) => {
    const found = Object.values(assets).filter((a) =>
      a.source.assetPath.endsWith("/" + name + ".json"),
    );
    if (found.length !== 1) throw new Error(`Missing map asset ${name}`);
    return found[0]!;
  };
  const rawMap = record(asset("tilemap").data);
  const media: Record<string, MapTexture> = {};
  for (const texture of project.narshe.textures) {
    if (sha(snapshotFile(imported, texture.file)) !== texture.sha256)
      throw new Error("Changed map texture");
    media[texture.name + ".png"] = {
      url: "/imports/" + texture.file,
      width: texture.width,
      height: texture.height,
      source: texture.source,
    };
  }
  const geometry = compileMapGeometry(
    asset("tilemap"),
    asset("collision"),
    media,
  );
  if (geometry.blockers.length) throw new Error(geometry.blockers[0]!.reason);
  const { layers, tilesets, textures, collisions } = geometry;
  const chars: Record<string, Character> = {};
  for (const [name, value] of Object.entries(record(field.characters))) {
    const c = record(value),
      a = record(c.animation),
      animations: Character["animations"] = {};
    const sprites = record(c.sprites) as Character["sprites"];
    for (const sprite of Object.values(sprites))
      if (sha(snapshotFile(extra, sprite.file)) !== sprite.sha256)
        throw new Error("Changed sprite");
    for (const raw of list(record(a.data).animation)) {
      const m = record(raw);
      const frames = list(m.frames).map((v) => {
        const f = record(v),
          rgb = record(f.rgb);
        if (Object.values(rgb).some((v) => v !== 1))
          throw new Error("Unsupported sprite tint");
        const key = string(f.sprite_name);
        if (!sprites[key]) throw new Error("Unresolved sprite " + key);
        return {
          sprite: key,
          x: Number(f.offsetx),
          y: Number(f.offsety),
          flip: !!f.flip,
          alpha: Number(f.alpha),
        };
      });
      animations[string(m.name)] = {
        frames,
        duration: Number(m.play_speed),
        mode: integer(m.play_mode),
        flip: !!m.is_reverse,
        next: string(m.next_anim_name),
      };
    }
    for (const sprite of Object.values(sprites))
      sprite.file = "/field/" + sprite.file;
    chars[name] = { sprites, animations, source: a.source as Evidence };
  }
  // Explicit development checkpoint; unrelated story flags remain unknown in the runtime.
  // The complete original map initializer is preserved in the import, not replaced.
  const activeGroups = [
    "entity_default",
    "ev_e_0609",
    "ev_e_0002",
    "ev_e_0003",
    "ev_e_0004",
    "ev_e_0005",
    "ev_e_0006",
  ];
  const pkg = asset("package"),
    packageMaps = list(record(pkg.data).map)
      .map(record)
      .filter((m) => m.name === "Map_20010");
  if (packageMaps.length !== 1)
    throw new Error("Ambiguous opening map package");
  const packageMap = packageMaps[0]!;
  const groups: NonNullable<FieldContent["map"]["groups"]> = {};
  for (const ref of [
    { name: "entity_default", asset: packageMap.entity_default },
    ...list(packageMap.entity).map(record),
  ]) {
    const name = string(ref.name),
      relative = string(ref.asset);
    if (
      relative.startsWith("/") ||
      relative.includes("\\") ||
      relative.split("/").includes("..")
    )
      throw new Error("Unsafe entity group path");
    const path = posix.join(
        posix.dirname(pkg.source.assetPath),
        relative + ".json",
      ),
      target = assets[path];
    if (!target || groups[name])
      throw new Error("Ambiguous or missing entity group " + name);
    groups[name] = compileEntityGroup(
      name,
      target,
      tables,
      record(field.messages),
    );
    for (const entity of groups[name]!.entities)
      if (entity.asset && !chars[entity.asset])
        groups[name]!.blockers.push({
          reason: `Missing character media ${entity.asset}`,
          source: entity.source,
        });
  }
  bindTileAnimationRegions(groups, geometry);
  const entities: FieldEntity[] = [];
  for (const name of activeGroups) {
    const group = groups[name];
    if (!group) throw new Error("Missing bootstrap group " + name);
    for (const issue of group.blockers) {
      const entity = group.entities.find(
        (e) => e.source.pointer === issue.source.pointer,
      );
      // Preserve only the previously declared development omissions of this existing checkpoint.
      // All new SetEntities activations must pass the complete group blockers at runtime.
      if (
        entity &&
        ![2, 3, 4, 6, 19].includes(entity.kind) &&
        /^(Unsupported entity kind |Unsupported entity direction$|Unsupported entity transform$)/.test(
          issue.reason,
        )
      )
        continue;
      // Preserve this existing checkpoint's unsupported encounter-NPC action omission.
      // The opening's separate trigger scripts remain its explicit encounter approximation.
      if (
        entity?.kind === 6 &&
        /^Unsupported NPC contact encounter$/.test(issue.reason)
      )
        continue;
      // This checkpoint already declares omitted environment particles. The
      // source compiler now identifies the entity instead of calling it an
      // unknown kind; retain that same explicit development boundary.
      if (entity?.kind === 11 && issue.reason.startsWith("Field effect particle provider unavailable:"))
        continue;
      throw new Error(issue.reason);
    }
    entities.push(...group.entities);
  }
  if (new Set(entities.map((e) => e.id)).size !== entities.length)
    throw new Error("Ambiguous active entity identity");
  const scripts: Record<string, Op[]> = {};
  const scriptLocals: Record<string, ScriptLocals | null> = {};
  const scriptTransitionMetadata: NonNullable<FieldContent["scriptTransitionMetadata"]> = {};
  const scriptSystemFlags: NonNullable<FieldContent["scriptSystemFlags"]> = {};
  for (const [path, a] of Object.entries(assets)) {
    const d = record(a.data);
    if (!Array.isArray(d.Mnemonics)) continue;
    const name = path
      .split("/")
      .at(-1)!
      .replace(/\.json$/, "");
    scriptLocals[name] = decodeScriptLocals(d);
    try { scriptTransitionMetadata[name] = compileEventScriptTransitionMetadata(d); }
    catch { scriptTransitionMetadata[name] = null; }
    scriptSystemFlags[name] = decodeConditionVisualFlag(d);
    const instructions = d.Mnemonics;
    scripts[name] = instructions.map((m, index) =>
      decodeFieldOp(
        m,
        {
          script: name,
          index,
          source: { ...a.source, pointer: `/Mnemonics/${index}` },
        },
        record(field.messages),
        tables,
        { nextMnemonic: index + 1 < instructions.length ? string(record(instructions[index + 1]).mnemonic) : null },
      ),
    );
  }
  const entryScript = record(asset("sc_e_0001_5").data);
  // These two source task targets are absent from this supplied entity group.
  // Only their exact Hide-only routines may run; no synthetic visible entity is created.
  const absentHideTargets = ["154", "156"];
  for (const id of absentHideTargets) {
    if (entities.some((e) => e.id === id))
      throw new Error("Previously absent entity now needs source review");
    const ops = scripts.sc_e_0006_1!;
    const calls = ops.filter((op) => op.kind === "puppet" && op.actor === id);
    if (
      calls.length !== 1 ||
      calls[0]?.kind !== "puppet" ||
      ops
        .slice(calls[0].target, calls[0].target + 3)
        .map((op) => op.kind)
        .join() !== "nop,hide,exit"
    )
      throw new Error("Absent entity target is no longer Hide-only");
  }
  const ins = list(entryScript.Mnemonics).map(record);
  // Assert the source locations which derive (38,58) -> (38,49), rather than inventing a spawn.
  for (const [index, name, a, b] of [
    [29, "SetPos", 38, 58],
    [47, "Move", 0, 2],
    [63, "Move", 0, 6],
    [116, "Move", 0, 1],
  ] as const) {
    const m = ins[index]!,
      operands = list(record(m.operands).iValues);
    if (m.mnemonic !== name || operands[0] !== a || operands[1] !== b)
      throw new Error("Opening checkpoint evidence changed");
  }
  const mapRows = list(tables["map.csv"])
    .map(record)
    .filter((row) => row.map_name === project.narshe.mapName);
  if (mapRows.length !== 1) throw new Error("Ambiguous opening map identity");
  const transportationCatalog = compileTransportationCatalog(systemSource.reader,
    systemSource.tables["transportation.csv"]!.map((r) => tableId(r.id))).catalog;
  const transportation = compileNarsheTransportationCheckpoint(transportationCatalog, systemSource.assets);
  const mapEntrySeed = compileNarsheMapEntrySeed(systemSource.assets);
  const miscSources = systemSource.assets.filter((a) => a.source.assetPath.endsWith("/serial_misc_assets.json"));
  if (miscSources.length !== 1) throw new Error("Missing or ambiguous party appearance source settings");
  const partyCatalog = compilePartyActorCatalog(systemSource.tables, miscSources[0]!.data).catalog;
  const extraSources = systemSource.assets.filter((a) => a.source.assetPath.endsWith("/battle_extra_data.json"));
  if (extraSources.length !== 1) throw new Error("Missing or ambiguous weapon additional-ability source");
  const weaponEffects = compileOrdinaryWeaponEffects(systemSource.reader, extraSources[0]!.data).catalog;
  const initialOwners = systemSource.tables["initialize_data.csv"]!
    .filter((r) => /^INIT_PARTY_\d+$/.test(r.key_name!)).map((r) => {
      const template = compileOwnedCharacterInitialization(systemSource.reader, systemSource.tables,
        tableId(r.value1), (key) => key, weaponEffects).template;
      return { id: `player:${template.initial.sourceId}`, ...template.initial, enabled: true };
    });
  const initialParty = compileInitialPartyState(systemSource.tables, initialOwners).state;
  const partyCheckpoint = compileNarshePartyActorCheckpoint(partyCatalog, systemSource.assets,
    activePartyMembers(initialParty).map((member) => {
      const owner = initialOwners.find((p) => p.id === member.id)!;
      return { ...member, sourceId: owner.sourceId, jobId: owner.jobId,
        enabled: owner.enabled, conditionIds: [...owner.conditionIds] };
    }));
  const developmentOmissions: NonNullable<FieldContent["developmentOmissions"]> = [];
  for (const group of Object.values(groups)) {
    for (const entity of group.entities.filter((entity) => entity.kind === 11))
      developmentOmissions.push({ kind: "field-effect", entityId: entity.id, group: group.name,
        source: entity.source, reason: "Existing development checkpoint omits environment particles" });
    // Keep group blockers: a later activation may not inherit the bootstrap
    // approximation merely because this controlled entry omitted its pixels.
    group.entities = group.entities.filter((entity) => entity.kind !== 11);
  }
  const result: Omit<FieldContent, "contentHash"> = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: string(field.sourceSetHash),
    parentSourceSetHash: project.sourceSetHash,
    map: {
      id: project.narshe.mapName,
      identity: {
        mapId: tableId(mapRows[0]!.id),
        areaId: tableId(mapRows[0]!.area_id),
      },
      entryContext: compileFieldEntryContext(systemSource.assets, systemSource.tables, tableId(mapRows[0]!.id)),
      width: integer(rawMap.width),
      height: integer(rawMap.height),
      tileSize: integer(rawMap.tilewidth),
      layers,
      tilesets,
      textures,
      collisions,
      entities: entities.filter((entity) => entity.kind !== 11),
      groups,
      initialGroups: activeGroups,
      partyActorCamera: partyCheckpoint.context.camera,
      source: asset("tilemap").source,
    },
    characters: chars,
    developmentOmissions,
    minimap: await loadMinimapMedia(root, project.sourceSetHash),
    bgm: await loadAudioMedia(root, project.sourceSetHash, "bgm"),
    se: await loadAudioMedia(root, project.sourceSetHash, "se"),
    environment: await loadAudioMedia(
      root,
      project.sourceSetHash,
      "environment",
    ),
    treasureInventoryLimits: compileTreasureInventoryLimits(systemSource.tables).limits,
    scripts,
    scriptLocals,
    scriptTransitionMetadata,
    scriptSystemFlags,
    playerFactory: compilePlayerVisibilityFactory(extended.map((s) => ({ file: string(s.file), sha256: string(s.sha256) }))),
    entry: {
      fade: structuredClone(DEVELOPMENT_TRANSPARENT_FADE),
      absentHideTargets,
      transportationId: transportation.identity.id,
      initialEventValues: [...mapEntrySeed.values, ...transportation.knownReleaseFlags],
      partyActors: { kind: "field-party-actors-v1", context: partyCheckpoint.context,
        playerAssetCacheId: partyCheckpoint.playerAssetCacheId },
      player: {
        x: 38,
        y: 49,
        direction: "up",
        layer: 1,
        asset: "mo_ff6_p001",
        mount: "mo_ff6_v006_c00",
      },
      evidence: [...transportation.scripts.map((s) => s.source), ...mapEntrySeed.scripts.map((s) => s.source),
        ...partyCheckpoint.sourceProof.entityGroups.map((s) => s.source), ...[29, 47, 63, 116].map((i) => ({
        ...asset("sc_e_0001_5").source,
        pointer: `/Mnemonics/${i}`,
      }))],
      description: "开场行军之后的开发入口；开场影片和完整初始化尚未接入。",
    },
    limitations: [
      "纳尔谢街道战斗使用可玩开发规则；完整地图流程、队伍菜单和存读档仍未完成。",
      "背景音乐、普通脚本音效与结束等待已接入共用音频状态；本检查点尚未确定初始音乐。机关、宝箱与字段状态音效仍分别记录省略。",
      "环境音暂停/变调、特殊音效程序、环境粒子、精确镜头与演出时序仍有缺口；骑乘合成和碰撞等待正式对照。",
      "环境音已保留来源音量、循环和线性淡入；SEAD 类别混音、起止宏、空间处理与混响未复现。",
      "此入口使用明确的开场状态，尚未执行完整地图初始化脚本。",
      "既有开场检查点的 NPC 使用静止、不可推动的开发近似；新实体组不继承这些行为省略。",
    ],
  };
  return { ...result, contentHash: hash(result) };
}
