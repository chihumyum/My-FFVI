# Fresh source products and historical compatibility

The full original new-game product depends on captured raw snapshots, source masters, current emitted compiler modules and explicit Web presentation policies. Historical authored demos are separate consumers. `compileSourcePrerequisites` keeps its default `legacy-source-compatibility-v1`: both real old `build/game` seeds, independent source capability/fee baselines and all recipe pins remain strict. `compileFreshSourceProducts` and `compileFreshSourceCandidate` fix `fresh-source-products-v1`; they compile the complete current shared catalog without reading either historical seed or compiling an unused opening subset. They do not claim save/recipe compatibility or source gameplay admission.

Fresh capture has its own closed `fresh-source-product-input-lock-v1` with `sourceLockKind` preserving the policy lock version. Old locks keep their original required seed dependencies; fresh locks reject legacy game dependencies, unknown fields and unknown modes. Receipt mode and lock kind must agree. Fresh receipts bind the physical source root, runtime root and emitted-module directory, and readers recheck those paths, exact runtime bytes, compiler digest, all raw inputs and every strict/framework map. Re-labelling an old lock, candidate or save cannot grant fresh production.

The separate media owner uses `source-prerequisite-input-lock-v6` plus `baseLockKind`. At integration, `sourceInputEnvelopeKind` unwraps the fresh mode and `sourceInputLockKind` unwraps the media base for board/parking policy checks. Promotions preserve both outer identities. The combined consumer preserves the media validator, dual snapshots, original PNG bytes and independently compiled 179-field comparison. Selected and baseline media each use their own option-bound strict-world stage. Fresh mode removes legacy game seeds, not media provenance or its comparison.

Compilation and publication remain separate:

```sh
node scripts/build-fresh-source-candidate.mjs \
  --root /absolute/source-root --runtime-root /absolute/source-root --compiled-dir /absolute/source-root/dist \
  --source-sprite-media build/source-sprite-media --baseline-sprite-media build/world-media \
  --output build/reports/fresh-source-candidate \
  --strict-world-cache build/cache/strict-source-world

node scripts/publish-fresh-source-products.mjs \
  --root /absolute/source-root --compiled-dir /absolute/source-root/dist \
  --candidate-dir build/reports/fresh-source-candidate \
  --source-sprite-media build/source-sprite-media --baseline-sprite-media build/world-media
```

Fresh whole-world mode retains its strict stage in `build/cache/strict-source-world` by default; the option above chooses another private cache directory.

The publication consumer only opens an already complete, same-runtime fresh candidate. It reuses its complete full-new-game/full-battle bindings, requests/reports, strict/source and framework worlds and every indexed map, including blocked or unvisited bodies. Fresh linking already binds `/content-packages/source-products/{source,framework}/...` in the candidate and lock. The new top-level references are `/content-packages/source-products-source.json` and `/content-packages/source-products-framework.json`; both have `development: null`. The framework reference is the full original new-game route using the complete current Web battle directory. Old source/framework/sample references and their dependency URLs remain intact. Publication cannot rewrite a legacy candidate into this namespace. It never reads old recipe selections, ordinary-battle caches or old opening roles. Existing `publishContentPackages`, `GameContentRepository`, archive/CAS checks, collection lock and atomic replacement own publication. Their existing copy preserves independent registry files and old CAS; no second publisher, automatic pin update or deletion of old content is introduced. A non-default runtime root is an explicit API/CLI argument and must match the original candidate's exact producer paths and bytes.

`source-world-stage-cache.mjs` retains only a complete strict stage, before source entry/framework derivation. The binding contains the exact raw file/directory pins, original source identity, strict world options, producer mode, Node/platform, actual world module import closure, installed zod package and parser bytes. Unknown package/computed dependencies reject. Framework-only modules are outside this strict closure; consumed-module/raw/mode changes cannot reuse it. On a hit, every object hash, complete raw map domain and identity, source/media association and strict profile are checked again before returning it. The full map bodies and unknown diagnostics remain unchanged. A downstream framework failure leaves this private stage available; it does not install a complete candidate. Corrupt or incomplete cache directories reject rather than silently reconstructing proof. Later candidate/publication readers still validate their full current runtime and input lock.

External media files are read only through their exact logical path, real path, byte count and SHA-256 in the validated candidate input lock. Other files in the same external directory receive no access; external JSON does not acquire media access. Final freshness validation rejects changed bytes or a changed symlink target even when its contents match.

Both candidate and publication APIs accept the same explicit `sourceSpriteMedia` declaration. CLI callers supply both `--source-sprite-media` and `--baseline-sprite-media`; one missing argument, different candidate/archive declarations or a public-directory input rejects.

This work's evidence lanes are distinct: an actual raw-only full catalog preflight with historical seeds physically unavailable; synthetic complete-map cache/Repository/private-publisher failure and retry tests; and future original whole-world production. No original whole-world build, public publication, browser acceptance, native comparison or complete story batch is claimed here.
