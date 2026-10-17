import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_BATTLE_BRANCH_EXECUTION as policy, classifyDeferredBattleInstruction } from '../src/core/battle-branch-execution.js';
import { advanceBattleEvent, createBattleEventState } from '../src/core/battle-event.js';
import { BattleGame } from '../src/core/battle.js';
import { WEB_BATTLE_EVENT_CONTROLS } from '../src/core/battle-controls.js';
import { fixture } from './fixtures/battle-content.js';
import { compileBattleEvent } from '../src/compiler/battle-event.js';
import { branchRaw as raw, branchProgram, branchSourceData, branchInputs } from './fixtures/battle-branch-execution.js';

test('branch execution retains the implemented no-save forced return and its distinct terminal owner', () => {
  const op = raw('BattleForceExit'), program = branchProgram([op, raw('Wait', [], [.1]), raw('Exit')]);
  assert.equal(classifyDeferredBattleInstruction(op), null);
  assert.equal(program.instructions[0]!.op.kind, 'force-return');
  assert.deepEqual(program.branchExecution!.deferred, []);
  const state = createBattleEventState(program, policy);
  const step = advanceBattleEvent(program, state, { clock: 0, timeSeconds: 0, started: true,
    aiCoreAlive: false, actionStaging: false }, policy);
  assert.deepEqual(step.requests, [{ kind: 'force-return', pc: 0 }]);
  const content = fixture();
  content.lifecycle = { kind: 'battle-lifecycle-v2', mode: 'script', scriptId: 1, program, branchExecution: policy };
  const battle = new BattleGame(content, 13, undefined, undefined, undefined, undefined, undefined, undefined,
    { branchExecution: policy, controls: WEB_BATTLE_EVENT_CONTROLS });
  battle.advance(10);
  assert.equal(battle.phase, 'forced');
  assert.equal(battle.reward, null);
  assert.deepEqual(battle.eventBranchExecution!.committedVisited, [0, 1]);
});

test('known forced-return operand errors stay hard even in a branch that would skip them', () => {
  for (const key of ['iValues', 'rValues', 'sValues'] as const) {
    const op = raw('BattleForceExit');
    (op.operands[key] as (number | string)[])[7] = key === 'sValues' ? 'unresolved' : 1;
    assert.equal(classifyDeferredBattleInstruction(op), null);
    const program = branchProgram([raw('Jump', [1]), op, raw('Exit')]);
    assert.equal(program.instructions[1]!.op.kind, 'blocked');
    assert.deepEqual(program.branchExecution!.deferred, []);
    assert.throws(() => createBattleEventState(program, policy), /Mnemonics\/1/);
  }
});

test('implemented postbattle selectors keep their typed requests while a missing local bank remains hard', () => {
  for (const [selector, kind] of [['血塗られた盾', 'cursed-shield-check'], ['シャドウ離脱抽選', 'shadow-secede-lot']] as const) {
    const op = raw('SysCall', [], [], [selector]);
    assert.equal(classifyDeferredBattleInstruction(op), null);
    const source = branchSourceData([op, raw('Exit')]);
    source.ScriptLocal = ['AI', 'EnemyMode', 'GauMode', 'Shadow'];
    source.ScriptLocalValue = [0, 0, 0, 0];
    const program = compileBattleEvent(source, branchInputs().source, undefined, undefined, policy);
    const step = advanceBattleEvent(program, createBattleEventState(program, policy), {
      clock: 0, timeSeconds: 0, started: true, aiCoreAlive: false, actionStaging: false,
    }, policy);
    assert.deepEqual(step.requests, [{ kind, pc: 0 }]);
    const malformed = structuredClone(op);
    malformed.operands.iValues[7] = 1;
    assert.equal(classifyDeferredBattleInstruction(malformed), null);
    const rejected = branchProgram([raw('Jump', [1]), malformed, raw('Exit')]);
    assert.throws(() => createBattleEventState(rejected, policy), /Mnemonics\/1/);
  }
  const missing = branchProgram([raw('Jump', [1]), raw('SysCall', [], [], ['シャドウ離脱抽選']), raw('Exit')]);
  assert.deepEqual(missing.branchExecution!.deferred, []);
  assert.throws(() => createBattleEventState(missing, policy), /ScriptLocalVariable\[3\]/);
});
