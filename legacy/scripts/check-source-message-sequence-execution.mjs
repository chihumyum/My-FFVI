// Whole-corpus execution experiment using the game's existing event VM.
// Controlled input states prove execution only, never original story reachability.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSourceMessageCorpusInputs, sourceMessageAuditOptions } from './source-message-corpus-inputs.mjs';

const options = sourceMessageAuditOptions(process.argv.slice(2), resolve(import.meta.dirname, '..'));
const { root } = options;
const inputs = await loadSourceMessageCorpusInputs(options);
const { load, hash, snapshot, system, corpus, assets: sourceScripts, byId: compiledScripts } = inputs;
const [{ EventState }, { FieldGame }, { DEVELOPMENT_TRANSPARENT_FADE }] = await Promise.all([
  'core/event-state', 'core/field', 'core/field-fade',
].map(load));
const corpusHash = corpus.contentHash, sourceDigest = inputs.sourceDigest,
  executionRuntimeHash = inputs.binding.runtimeHash;
const allowed = new Set(['nop', 'blank', 'exit', 'return', 'call', 'wait', 'jump', 'branch', 'calc', 'flag', 'message', 'choice',
  'source-message', 'field-fade', 'field-color-fade', 'field-flash', 'field-timer', 'bgm-pause', 'bgm-replay', 'event-save']);
const exclusions = [], programs = [];

for (const asset of sourceScripts) {
  const translated = compiledScripts.get(asset.id), reasons = [];
  assert.equal(translated.rawHash, hash(asset.data), 'Translated script raw fingerprint mismatch: ' + asset.id);
  assert.deepEqual(translated.raw, asset.data, 'Translated script source body changed: ' + asset.id);
  assert.deepEqual(translated.source, asset.source, 'Translated script provenance changed: ' + asset.id);
  const raw = asset.data.Mnemonics;
  if (!Array.isArray(raw)) throw new Error('Source program has no instruction array: ' + asset.id);
  assert.equal(translated.instructions.length, raw.length, 'Translated instruction count changed: ' + asset.id);
  translated.instructions.forEach((instruction, index) => {
    assert.equal(instruction.site.script, asset.id);
    assert.equal(instruction.site.index, index);
    assert.equal(hash(instruction.raw), hash(raw[index]), 'Translated instruction changed address/source');
  });
  // Do not feed battle/AI or unbound programs to a field adapter or field VM.
  if (translated.domain !== 'field') {
    assert.ok(translated.instructions.every(instruction => instruction.operandDecoded === 'unassessed' && instruction.decoded === null));
    exclusions.push({ id: asset.id, source: asset.source,
      reasons: [{ code: 'non-field-domain', domain: translated.domain }] });
    continue;
  }
  const ops = translated.instructions.map(instruction => instruction.decoded);
  for (const [index, op] of ops.entries()) {
    if (op === null) {
      reasons.push({ code: 'operand-not-decoded', index,
        diagnostic: translated.instructions[index].diagnostic });
      continue;
    }
    assert.equal(op.script, asset.id);
    assert.equal(op.index, index);
    if (!allowed.has(op.kind)) reasons.push({ code: 'host-or-capability-required', index,
      kind: op.kind, reason: op.reason ?? null });
    if (op.kind === 'field-timer' && ['set', 'change-script-if-expired'].includes(op.command.kind))
      reasons.push({ code: 'source-timer-callback-namespace-required', index });
    // FieldMessage properties are on Op itself; no nested op.message exists.
    if (op.kind === 'message' && op.template) reasons.push({ code: 'owned-message-names-required', index });
    if (op.kind === 'source-message' && op.command.kind === 'sequence' && op.command.template) reasons.push({ code: 'owned-message-names-required', index });
    // Call is a local instruction address. No script lookup or rewrite occurs.
  }
  if (!ops.some(op => op?.kind === 'source-message' && ['sequence','finish-wait'].includes(op.command.kind)))
    reasons.push({ code: 'outside-selected-message-batch' });
  const segments = asset.data.Segments;
  if (!Array.isArray(segments) || segments.length !== 1 || segments[0].EntryPoint !== 0 || segments[0].Count !== ops.length)
    reasons.push({ code: 'segment-lifecycle-outside-experiment' });
  const locals = translated.locals.decoded;
  if (translated.locals.operandDecoded !== 'decoded')
    reasons.push({ code: 'script-locals-invalid', diagnostic: translated.locals.diagnostic });
  if (reasons.length) exclusions.push({ id: asset.id, source: asset.source, reasons });
  else programs.push({ asset, ops, locals, maps: translated.maps });
}

function states(ops) {
  const inputs = new Map([['initialized-zero', []]]);
  for (const op of ops.filter(op => op.kind === 'branch' && op.right.kind === 'immediate')) {
    if (['ScriptLocalVariable', 'MessageSelection', 'ItemSelection'].includes(op.left.category)) continue;
    const values = op.left.category.includes('Flag') ? [0, 1] : [op.right.value - 1, op.right.value, op.right.value + 1];
    for (const value of values) if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && value !== 0)
      inputs.set(`${op.left.category}[${op.left.index}]=${value}`, [{ ref: op.left, value }]);
  }
  return [...inputs].map(([id, writes]) => ({ id, writes }));
}

function execute(program, input, choicePrefix) {
  const { asset, ops, locals } = program, state = EventState.initialized();
  state.beginScript(locals);
  for (const write of input.writes) state.write(write.ref, write.value);
  const before = state.snapshot();
  const content = {
    formatVersion: 1, kind: 'field-development', sourceSetHash: snapshot.sourceSetHash,
    parentSourceSetHash: snapshot.manifest.parentSourceSetHash, contentHash: hash({ id: asset.id, data: asset.data }),
    map: { id: 'controlled-story-vm-host', width: 1, height: 1, tileSize: 16, layers: [], tilesets: [],
      textures: {}, collisions: { 1: [0] }, entities: [], source: asset.source },
    characters: {}, scripts: { [asset.id]: ops }, scriptLocals: { [asset.id]: locals },
    developmentProfile: { kind: 'framework-development-v1', policy: 'omit-anonymous-environment-particles-v1',
      sourceContentHash: hash({ id: asset.id, data: asset.data }), omissions: [], storyRuntime: 'web-field-story-runtime-v1',
      autoSave: 'web-field-autosave-barrier-v1' },
    entry: { player: { x: 0, y: 0, layer: 1, direction: 'up', asset: '', mount: '' },
      fade: structuredClone(DEVELOPMENT_TRANSPARENT_FADE),
      description: 'Controlled whole-corpus experiment; not a story checkpoint', evidence: [asset.source] },
    limitations: ['controlled-state', 'headless-event-host', 'no-original-oracle'],
  };
  const dialogue = [], choices = [], confirms = [], saves = [];
  let game = null, exception = null;
  let ticks = 0, boundary = null;
  try {
    const options = { sourceMessageSequence: inputs.policy };
    game = new FieldGame(content, new EventState(structuredClone(before)), undefined, undefined, options);
    assert.equal(game.startEvent(asset.id), true);
    while (ticks < 12000 && (game.busy || game.fader.active || game.storyRuntimeSnapshot?.colorFilter?.tween) && !game.stop) {
      ticks++;
      if (game.eventSaveRequest) {
        const request = game.eventSaveRequest, checkpoint = game.eventCheckpoint(request);
        const restored = FieldGame.restore(content, JSON.parse(JSON.stringify(checkpoint)), options);
        assert.deepEqual(restored.eventState.snapshot(), game.eventState.snapshot(), 'Event round trip changed source banks');
        assert.equal(restored.eventSaveRequest, null, 'Restore must continue after the saved barrier');
        saves.push({ site: request.site, checkpointHash: hash(checkpoint) });
        game.acknowledgeEventSave(request);
        game = restored;
      } else if (game.choice) {
        const request = game.choice;
        if (choices.length >= choicePrefix.length) {
          boundary = { code: 'choice-frontier', options: request.options.map(option => option.key),
            prefix: [...choicePrefix] }; break;
        }
        const answer = choicePrefix[choices.length];
        if (!game.choose(request.id, answer)) { boundary = { code: 'rejected-choice', answer }; break; }
        choices.push({ answer, options: request.options.map(option => option.key) });
        // Choice callbacks complete on their next logical interpreter clock.
        game.advance(10);
      } else if (game.dialogue) {
        const current = game.dialogue;
        if (current.manual && game.time < current.manual.availableAt) {
          game.advance(10);
          continue;
        }
        dialogue.push({ key: current.key, page: current.manual?.page ?? 0 });
        // confirm() intentionally returns void. Its observable effect is a
        // page/window/choice change, never a boolean acceptance signal.
        game.confirm();
        if (!game.stop && game.dialogue === current) {
          boundary = { code: 'dialogue-did-not-progress', key: current.key,
            page: current.manual?.page ?? 0, availableAt: current.manual?.availableAt ?? null };
          break;
        }
      } else {
        game.advance(10);
        if (game.sourceMessage.projection?.acceptsInput) {
          const before = game.sourceMessage.projection;
          game.confirm(); confirms.push({ tick: ticks, before, after: game.sourceMessage.projection });
        }
      }
    }
  } catch (error) {
    exception = { code: 'execution-exception', reason: error instanceof Error ? error.message : String(error) };
  }
  if (!exception && !boundary && !game?.stop && !game?.busy && game?.sourceMessage.active) boundary = { code: 'retained-global-window', projection: game.sourceMessage.projection };
  const after = game?.eventState.snapshot() ?? structuredClone(before), changes = [];
  for (const bank of ['scenario', 'treasure', 'global', 'area', 'map', 'script'])
    if (Array.isArray(after[bank]))
    after[bank].forEach((value, index) => {
      const previous = before[bank]?.[index] ?? null;
      if (value !== previous) changes.push({ bank, index, before: previous, after: value });
    });
  for (const bank of ['selected', 'itemSelected', 'currentMapId'])
    if (after[bank] !== before[bank]) changes.push({ bank, before: before[bank], after: after[bank] });
  const pending = game && (game.busy || game.fader.active || game.storyRuntimeSnapshot?.colorFilter?.tween);
  return { input, choicePrefix, choices, dialogue, confirms, saves, changes, stateHash: hash(after),
    hostStateHash: game ? hash({ runtime: game.storyRuntimeSnapshot, sourceMessage: game.sourceMessage.snapshot(), fade: game.fader.snapshot(), bgm: game.bgm.snapshot() }) : null,
    outcome: exception ? 'error' : boundary ? 'frontier' : game.stop ? 'stopped' : pending ? 'budget-exhausted' : 'finished',
    boundary: exception ?? boundary ?? game?.stop ?? null };
}

const results = [];
for (const program of programs) {
  const cases = [];
  for (const input of states(program.ops)) {
    const queue = [[]], seen = new Set();
    while (queue.length && seen.size < 128) {
      const prefix = queue.shift(), key = JSON.stringify(prefix);
      if (seen.has(key)) continue;
      seen.add(key);
      const first = execute(program, input, prefix), repeat = execute(program, input, prefix);
      assert.deepEqual(repeat, first, 'Source script replay changed for ' + program.asset.id);
      cases.push(first);
      if (first.boundary?.code === 'choice-frontier' && prefix.length < 8)
        first.boundary.options.forEach((_, answer) => queue.push([...prefix, answer]));
    }
    if (queue.length) cases.push({ input, outcome: 'coverage-budget-exhausted', pendingChoices: queue.length });
  }
  results.push({ id: program.asset.id, source: program.asset.source, maps: program.maps,
    program: compiledScripts.get(program.asset.id),
    dependencies: corpus.analysis.dependencies.filter(edge => edge.site.asset === program.asset.id), cases });
}
const cases = results.flatMap(result => result.cases);
const counts = { totalScripts: sourceScripts.length, selectedScripts: programs.length, excludedScripts: exclusions.length,
  cases: cases.length, finished: cases.filter(result => result.outcome === 'finished').length,
  choiceFrontiers: cases.filter(result => result.boundary?.code === 'choice-frontier').length,
  stopped: cases.filter(result => result.outcome === 'stopped').length,
  executionExceptions: cases.filter(result => result.outcome === 'error').length,
  executionBudgetExhausted: cases.filter(result => result.outcome === 'budget-exhausted').length,
  coverageBudgetExhausted: cases.filter(result => result.outcome === 'coverage-budget-exhausted').length,
  scriptsWithStateChanges: results.filter(result => result.cases.some(value => value.changes?.length)).length,
  scriptsWithChoiceAnswers: results.filter(result => result.cases.some(value => value.choices?.length)).length };
counts.scriptsWithEventRoundTrips = results.filter(result => result.cases.some(value => value.saves?.length)).length;
counts.eventRoundTrips = cases.reduce((count, value) => count + (value.saves?.length ?? 0), 0);
assert.equal(counts.totalScripts, counts.selectedScripts + counts.excludedScripts, 'A source program was omitted');
assert.ok(counts.selectedScripts > 0 && counts.finished > 0, 'No source script execution was demonstrated');
await inputs.finish();
const report = { kind: 'source-message-sequence-execution-v1', result: 'experiment-complete', sourceSetHash: snapshot.sourceSetHash,
  ...inputs.binding, storyCorpusHash: corpusHash, controlledPolicy: inputs.context, systemMessageSource: system.source,
  runtimeHash: executionRuntimeHash, sourceDigest, counts, selection: { allowed: [...allowed],
    host: 'explicit web-field-message-sequence-v1 policy: source-explicit-pages, integratorAutomatic=false, prepared BattleMessageSpeed factor=1, edge confirm guard10ms; explicit Web linear RGBA screen, transparent fader, known absent timer, empty BGM bus and event checkpoint round trip; no native sync, durable storage, camera shader or playback parity',
    states: 'source zero initialization plus isolated branch boundary inputs', choiceDepth: 8, maxChoiceCasesPerState: 128,
    segmentScope: 'one complete source program at entry zero' }, results, exclusions,
  runtimeAdmission: 'unassessed', sourceStoryReachability: false, sourceCampaignComplete: false,
  publicContentPublished: false, browserVerified: false, originalGameExecuted: false, limitations: [
    'Controlled states are not reachable source-game saves; this does not establish full-map or campaign playability.',
    'Single-cell boundary states and bounded choice expansion are not exhaustive path coverage.',
    'Every source program is retained in the selected or excluded inventory; failures remain in the receipt.',
    'FieldGame consumes typed operations from the verified full story-corpus artifact without recompilation; this script supplies inputs and collects detached observations only.',
  ] };
const output = resolve(root, options.output ?? 'build/reports/source-message-sequence-execution.json');
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, runtimeHash: report.runtimeHash, counts, sourceSetHash: report.sourceSetHash }));
