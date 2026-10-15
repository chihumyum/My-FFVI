import assert from 'node:assert/strict';
import { runtimeDigest } from './runtime-digest.mjs';
import { compileSourcePrerequisites } from './compile-source-prerequisites.mjs';
import { webSourceFrameworkInputs } from './source-web-framework-inputs.mjs';
import { linkSourcePrerequisites } from './link-source-prerequisites.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
assert.equal(args.length % 2, 0, 'Expected option/value pairs');
assert.equal(new Set(args.filter((_, i) => i % 2 === 0)).size, args.length / 2, 'Duplicate options');
for (let i = 0; i < args.length; i += 2)
    assert.ok(['--root', '--compiled-dir', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown or missing option value');
const runtimeRoot = resolve(import.meta.dirname, '..'), root = resolve(option('--root') ?? runtimeRoot), out = resolve(root, option('--output') ?? 'build/source-play-animation-candidate'), compiledDir = resolve(root, option('--compiled-dir') ?? 'dist'), sha = b => createHash('sha256').update(b).digest('hex');
const runtimeBefore = await runtimeDigest(runtimeRoot, compiledDir);
const result = await compileSourcePrerequisites({ root, compiledDir, ...webSourceFrameworkInputs() });
console.log('pure source prerequisite compiled');
const linked = await linkSourcePrerequisites({ root, compiledDir, payloads: result.payloads, frameworkOptions: result.frameworkOptions });
assert.equal(await runtimeDigest(runtimeRoot, compiledDir), runtimeBefore, 'Runtime changed during private source compilation');
const objects = [];
for (const [url, value] of linked.inputs) {
    const bytes = JSON.stringify(value) + '\n', file = resolve(out, 'objects', url.slice(1));
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, bytes);
    objects.push({ url, sha256: sha(bytes), bytes: Buffer.byteLength(bytes), contentHash: value.contentHash });
}
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'inputs.json'), JSON.stringify(result.inputs, null, 2) + '\n');
await writeFile(resolve(out, 'report.json'), JSON.stringify({ kind: 'source-play-animation-candidate-v1', status: 'complete', runtimeSha256: runtimeBefore, producer: result.report, link: linked.report, objects, published: false }, null, 2) + '\n');
console.log(JSON.stringify({ objects: objects.length, strict: result.report.strict, framework: linked.report.frameworkWorldHash, published: false }));
