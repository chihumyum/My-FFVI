# Shared source field Shake lifecycle

This increment addresses the complete source `Shake` family, not one map or the next opening instruction. Fresh nomination covers all 3,304 physical programs: 534 Shake instructions in 166 physical programs, with 560 instruction/map-alias uses in 177 complete map/program roots across 103 maps. The central dependency scanner retains source initializers, Resident bindings, entity groups, outside-map edges and every unresolved provider. Its complete graph reaches 635 maps and retains 11,238 diagnostics, 28,123 requirements and 50,616 edges. These are dependency counts, not playable coverage.

`compileFieldShakeInstruction` accepts only the actual MainCore/type-1 family. All six type combinations, zero/default real intervals and nonzero re-execute values are preserved. The source wrapper consumes i3 on Play: the four original short three-integer starts remain blocked; their missing operand normalizer is unproved. The four one-integer Stops consume only i0 and need no invented padding. All original raw operands, locals, source identities and complete programs remain available in the inventory.

The source calls IMapAccessor slot 14, SetCameraOffset, which delegates to CameraController.SetOffsetPosition. The Shake `duration` field is a sampling interval: the effect continues until Stop. The actual ranges are (2,0), (4,1), (0,2), (1,4), (2,2), (4,4). The native update uses strict counter > period, discards overshoot, draws X and Y once, and the camera callback rounds the sampled pixel offset. Source Play resets range/scale/counter/magnitude and seeds Unity's global RNG from DateTime.Now.Millisecond. No original executable or browser parity is claimed by the static audit.

The explicit `web-field-camera-shake-v1` policy supplies a nonzero seed and a per-field xorshift32 presentation stream. FieldGame owns it within the existing story-runtime owner; it is not the battle, field-magic or encounter RNG. Existing fixed 10 ms field updates sample the effect. The actual camera host receives only an effectOffset; logical camera targets, dummy/player positions, map scroll, owned state and GeneralRegisters are untouched. The actual app supplies the same policy factory as the source replay driver. Without a declared story runtime, that policy and an actual normal camera host, a reached Shake remains blocked. An unused Shake in another script adds no eager gate.

Menu/hidden/operation pauses use the existing Flow/Session clock. A prepared battle and media failure/cancellation/retry preserve the suspended field's exact stream. At successful battle return, nonzero i3 replays the retained configuration, resetting scale/counter without reseeding the stream; zero i3 stops it. The source FieldMap resume callback and destruction cleanup are retained as evidence, while the Web pause/reseed/new-map policy is explicit. A new map starts stopped; preparing, rejecting or discarding that candidate cannot stop the old field.

After Shake is used, the existing outer field checkpoint carries internal `web-field-story-runtime-v2` with the stream and scalar shake state. Before use, the old v1 story snapshot is unchanged. The snapshot contains no actor/camera position, callback, program or permission. Active state binds the exact trusted map hash, script alias and Web array PC; source Site.index is not used as an array index. Restore validates that original command and independently supplied policy, preserves draws/counter/scale and performs neither Play initialization nor RNG sampling. Stable and event-save paths use the existing storage and single-publication owners.

Verification lanes stay separate:

- Pure and real Session/native actor tests cover the full parameter family, effect-only projection, old snapshot compatibility, event save, native map cancellation/staleness/retry, prepared battle media failure/cancellation, natural defeat/fixed-entry retry, return/one reward, storage restoration and a subsequent battle.
- The actual app runs with its production factory, Repository/History, Flow, Handoff, Commands and Storage. DOM, media decoding and Renderer drawing are controlled; its actual FieldCameraHost projection is inspected. This is not browser or original-game acceptance.
- Whole-program source experiments run complete original bodies, PCs, branches and locals in original-map and explicitly declared controlled-map lanes. Public startEvent nominates a whole program after initialization; it does not establish navigation or story reachability. All 166 physical programs and all 177 alias roots remain recorded; only the freshly enumerated same-map operand-closed subset is attempted. Individual site execution is not inferred from a successful root.

Reproduce after compiling the same frozen runtime:

```sh
.venv/bin/python scripts/inspect-source-shake-native.py --root "$PWD" --output build/reports/source-shake-native.json
node scripts/inspect-source-shake-batch.mjs --root "$PWD" --compiled dist --output build/reports/source-shake-batch
node scripts/compile-source-encounter-candidates.mjs --root "$PWD" --compiled dist --output build/reports/source-encounter-candidates
node scripts/check-source-shake-programs.mjs --root "$PWD" --compiled dist --candidate-dir build/reports/source-encounter-candidates --inventory-dir build/reports/source-shake-batch --report build/reports/source-shake-programs-check.json
```

No content package, original input, story flag, HP/skill seed or published save is rewritten by these tools. Source initialization/provider failures, strict Unity RNG, native timing, nonnormal camera hosts, browser parity and full campaign migration remain independently unverified.
