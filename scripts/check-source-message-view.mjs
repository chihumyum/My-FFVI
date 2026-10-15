import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--root','--compiled','--report'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--') && !options.has(args[i]));
  options.set(args[i], args[i + 1]);
}
const root = resolve(options.get('--root') ?? resolve(import.meta.dirname, '..'));
const compiled = resolve(root, options.get('--compiled') ?? 'dist');
const { fieldMessageView, syncFieldMessageView } = await import(pathToFileURL(resolve(root, 'apps/game/source-message-view.js')));
const { SourceMessageState } = await import(pathToFileURL(resolve(compiled, 'src/core/source-message.js')));
const { createWebFieldMessageSequencePort } = await import(pathToFileURL(resolve(compiled, 'src/core/source-message-sequence.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const css = await readFile(resolve(root, 'apps/game/style.css'), 'utf8'), renderer = await readFile(resolve(root, 'apps/game/renderer.js'), 'utf8');
const context = createWebFieldMessageSequencePort().prepare().context;
const text = '不裁切的完整长页面。  保留空格与换行。\n'.repeat(100) + 'UNBROKEN_'.repeat(100) + '\nEND_OF_PAGE';
const make = () => ({ sourceMessage: new SourceMessageState(), messageWindow: null, choicePending: false });
const open = game => {
  game.sourceMessage.prepare({ kind: 'source-message', command: { kind: 'sequence', key: 'controlled', speaker: 'Long speaker',
    layout: { window: 'frame', anchor: 'top' }, seconds: 0, bypassSpeed: false, after: 'close',
    document: { kind: 'source-message-sequence-v1', alignment: 'left', tokens: [{ kind: 'text', text }, { kind: 'page', tag: 'P' },
      { kind: 'text', text: 'Second page' }] } } }, context).commit(); game.sourceMessage.advance(.01);
};
function node() { let text = '', writes = 0; return { dataset: {}, style: {}, scrollTop: 0, hidden: false,
  set textContent(value) { text = value; writes++; }, get textContent() { return text; }, get writes() { return writes; } }; }
const elements = Object.fromEntries(['dialogue','speaker','message','next'].map(key => [key, node()]));
const checks = [], check = (name, fn) => { fn(); checks.push({ name, pass: true }); };
const game = make(); open(game);
check('actual helper publishes all source text and layout metadata without truncation', () => {
  syncFieldMessageView(elements, game, false); assert.equal(elements.message.textContent, text);
  assert.equal(elements.dialogue.dataset.window, 'frame'); assert.equal(elements.dialogue.dataset.anchor, 'top');
  assert.equal(elements.message.tabIndex, 0); assert.equal(elements.message.textContent.endsWith('END_OF_PAGE'), true);
});
check('same held page does not reset scroll or rewrite text across app syncs', () => {
  elements.message.scrollTop = 321; const writes = elements.message.writes;
  for (let i=0;i<10;i++) syncFieldMessageView(elements, game, false);
  assert.equal(elements.message.scrollTop, 321); assert.equal(elements.message.writes, writes);
});
check('a real source page transition resets scroll once without advancing a second page', () => {
  game.sourceMessage.advance(.01); game.sourceMessage.advance(.3); game.sourceMessage.advance(.01);
  assert.equal(game.sourceMessage.confirm(), true); game.sourceMessage.advance(.01);
  syncFieldMessageView(elements, game, false); assert.equal(elements.message.textContent, 'Second page'); assert.equal(elements.message.scrollTop, 0);
});
check('a replacement of the same key is another window ticket and resets scroll', () => {
  elements.message.scrollTop = 150; open(game); syncFieldMessageView(elements, game, false);
  assert.equal(elements.message.textContent, text); assert.equal(elements.message.scrollTop, 0);
});
check('a different actual field owner cannot inherit another field scrolling state', () => {
  elements.message.scrollTop = 222; const replacement = make(); open(replacement);
  syncFieldMessageView(elements, replacement, false); assert.equal(elements.message.scrollTop, 0);
});
check('choice and pause visibility stay derived from existing owners', () => {
  game.choicePending = true; syncFieldMessageView(elements, game, true);
  assert.equal(elements.dialogue.hidden, true); assert.equal(elements.next.hidden, true);
  assert.equal(game.sourceMessage.active, true);
});
check('existing v1 automatic subtitle remains on its canvas path only', () => {
  const old = make(); old.sourceMessage.prepare({ kind: 'source-message', command: { kind: 'play', key: 'legacy', speaker: '',
    layout: { window: 'none', anchor: 'bottom' }, seconds: -1,
    document: { kind: 'source-message-document-v1', text: 'Legacy', alignment: 'left', autoPage: true, tailWaitSeconds: null } } }).commit();
  assert.equal(fieldMessageView(old), null); assert.match(renderer, /message && message.documentKind !== "source-message-sequence-v1"/);
});
check('production CSS gives sequence text a bounded, wrapping and scrollable region', () => {
  assert.match(css, /#dialogue\[data-protocol="source-message-sequence-v1"\][\s\S]*max-height: 72%/);
  const body = css.slice(css.lastIndexOf('#dialogue[data-protocol="source-message-sequence-v1"] #message'));
  for (const declaration of ['min-height: 0','overflow: auto','white-space: pre-wrap','overflow-wrap: anywhere']) assert.ok(body.includes(declaration));
});
const report = { kind: 'controlled-source-message-view-v1', result: 'passed', checks,
  sourceHashes: { view: sha(await readFile(resolve(root, 'apps/game/source-message-view.js'))), css: sha(css), renderer: sha(renderer) },
  retainedTextCharacters: text.length, actualProductionHelper: true, actualMessageOwner: true,
  browserLayoutVerified: false, sourceStoryAdmitted: false, originalGameExecuted: false,
  limitations: ['DOM properties and CSS contracts are controlled; viewport layout, pixels and native glyph wrapping remain unverified.'] };
const output = resolve(root, options.get('--report') ?? 'build/reports/source-message-view-check.json');
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, checks: checks.length, retainedTextCharacters: text.length }));
