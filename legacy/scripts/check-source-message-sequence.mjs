// Whole supplied field-message family inventory, with actual sole-owner probes.
// Reports retain source text privately under ignored build/, never in git.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSourceMessageCorpusInputs, sourceMessageAuditOptions } from './source-message-corpus-inputs.mjs';

export async function checkSourceMessageSequence(options) {
  const input = await loadSourceMessageCorpusInputs(options);
  const { snapshot, corpus, hash, load, context, binding } = input;
  const { SourceMessageState } = await load('core/source-message');
  const sites = [], exclusions = [], programs = [], tokenCounts = {}, reasonCounts = {};
  for (const program of corpus.scripts) {
    const selected = [];
    for (const instruction of program.instructions) {
      const raw = instruction.raw;
      if (!['Msg', 'MsgClose', 'MsgFinishWait'].includes(raw.mnemonic)) continue;
      const key = raw.operands.sValues[0], text = snapshot.messages.story_mes_zhc[key] ?? null,
        speaker = snapshot.messages.story_cha_zhc[key] ?? null;
      const controls = typeof text === 'string' ? [...text.matchAll(/<[^<>]*>/g)]
        .map(match => ({ raw: match[0], offset: match.index })) : [];
      const site = { site: instruction.site, raw, localized: { key, text, speaker }, controls,
        operandDecoded: instruction.operandDecoded, diagnostic: instruction.diagnostic, decoded: instruction.decoded,
        controlledExecution: { result: 'unassessed' } };
      if (program.domain !== 'field') { exclusions.push({ ...site, reason: 'non-field-domain' }); continue; }
      for (const control of controls) tokenCounts[control.raw] = (tokenCounts[control.raw] ?? 0) + 1;
      if (instruction.diagnostic) {
        const reason = instruction.diagnostic.code + ': ' + instruction.diagnostic.reason;
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
      if (instruction.decoded?.kind === 'source-message' && instruction.decoded.command.kind === 'sequence') {
        selected.push(instruction.site.index);
        const command = instruction.decoded.command;
        if (command.template) site.controlledExecution = { result: 'excluded', reason: 'live-owned-name-owner-required', template: command.template };
        else {
          const owner = new SourceMessageState(), confirms = [];
          try {
            const tx = owner.prepare(instruction.decoded, context); tx.commit();
            let ticks = 0;
            while (ticks < 30000 && !owner.endWaiting) {
              owner.advance(.01); ticks++;
              if (owner.projection?.acceptsInput) {
                const before = owner.projection, accepted = owner.confirm();
                confirms.push({ tick: ticks, before, accepted, after: owner.projection });
              }
            }
            if (owner.endWaiting && owner.projection?.acceptsInput) {
              const before = owner.projection, accepted = owner.confirm();
              confirms.push({ tick: ticks, before, accepted, after: owner.projection });
            }
            assert.ok(owner.endWaiting, 'Manager did not reach EndWait within the explicit bound');
            const projection = owner.projection, status = owner.sequenceStatus(tx.ticket);
            owner.prepare({ kind: 'source-message', command: { kind: 'close' } }).commit();
            assert.equal(owner.active, false);
            site.controlledExecution = { result: 'passed', ticks, confirms, projection, status,
              finalSnapshot: owner.snapshot(), completeSourceProgramPlayed: false };
          } catch (error) { site.controlledExecution = { result: 'frontier', reason: String(error.message),
            confirms, projection: owner.projection }; }
        }
      }
      sites.push(site);
    }
    if (selected.length) programs.push({ id: program.id, source: program.source, rawHash: program.rawHash,
      maps: program.maps, selectedInstructionIndices: selected, raw: program.raw, locals: program.locals,
      instructions: program.instructions, dependencies: corpus.analysis.dependencies.filter(edge => edge.site.asset === program.id),
      otherBlocked: program.instructions.filter(instruction => instruction.operandDecoded === 'blocked'),
      runtimeAdmission: 'unassessed', storyReachability: 'unassessed' });
  }
  const count = result => sites.filter(site => site.controlledExecution.result === result).length;
  const report = { kind: 'source-message-sequence-inventory-v1', result: 'experiment-complete', ...binding,
    corpusCounts: corpus.counts, controlledPolicy: context, counts: {
      fieldSites: sites.length, nonFieldSites: exclusions.length, sequencePrograms: programs.length,
      sequenceInstructions: sites.filter(site => site.decoded?.command?.kind === 'sequence').length,
      finishWaitInstructions: sites.filter(site => site.decoded?.command?.kind === 'finish-wait').length,
      controlledParameterPassed: count('passed'), controlledParameterExcluded: count('excluded'),
      controlledParameterFrontier: count('frontier'), parameterUnassessed: count('unassessed') },
    tokenCounts, reasonCounts, sites, exclusions, programs, runtimeAdmission: 'unassessed',
    sourceStoryReachability: false, sourceCampaignComplete: false, publicContentPublished: false,
    browserVerified: false, originalGameExecuted: false, limitations: [
      'All typed operations come from the verified full corpus. This tool does not recompile source instructions.',
      'Per-site probes use the actual single SourceMessageState owner with the same declared Web context as the app.',
      'Owned-name templates are retained and excluded until a real source-owned naming fixture is supplied.',
      'These manager probes do not execute entire source programs. Separate complete-program VM and new-game route reports are required.',
      'Snapshot/source identities and compiler/runtime generation are verified; original dynamic behavior and native glyph layout are unassessed.' ] };
  await input.finish();
  const output = resolve(options.root, options.output ?? 'build/reports/source-message-sequence-check.json');
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, counts: report.counts, corpusHash: binding.corpusHash, runtimeHash: binding.runtimeHash }));
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await checkSourceMessageSequence(sourceMessageAuditOptions(process.argv.slice(2), resolve(import.meta.dirname, '..')));
