# Source Unity particle emission kernels

v35 implements the exact local engine's random streams, seed reset subset, constant emission/burst accumulation and particle-system clock. The five actual EffectPrefabs can use these kernels with explicit input state. They still cannot run as complete emitters: Cone sampling, Noise, birth/capacity order, motion, prewarm scheduling and particle geometry remain separate requirements. No smoke substitute or source admission gate was added.

The verification lanes are distinct. Source DLL/PDB binding and isolated x64 instruction emulation have passed. The instruction probes execute selected DLL functions in Unicorn with controlled memory; they do not start Windows, Unity, the game or a browser. All reports retain `semanticsVerified: false`.

## Exact engine identity

The local `UnityPlayer.dll` contains version `2019.4.20f1_6dd1c08eedfa`, image base `0x180000000`, and SHA-256 `7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845`. Its PE CodeView record identifies:

- PDB: `UnityPlayer_Win64_il2cpp_x64.pdb`.
- GUID: `4420B376-89DD-4CFE-AEC8-2300F4A999D2`; age: `1`.
- PDB SHA-256: `c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85`.

The matching file was obtained from the [official Unity symbol store](https://symbolserver.unity3d.com/UnityPlayer_Win64_il2cpp_x64.pdb/4420B37689DD4CFEAEC82300F4A999D21/UnityPlayer_Win64_il2cpp_x64.pdb). This is a GUID/age match to this binary, not substitution from a nearby Unity release. Public symbols and stripped local procedure names survive; C++ type records do not. Decompiler-generated field names/types therefore remain interpretations, checked against raw instructions.

`tools/native/inspect_unity_particles.py` validates PE sections, CodeView, the PDB summary, cached symbol dumps against fresh PDB extraction, 779 ParticleSystem/module ICall registrations and exact selected function ranges. ICall registration binds both name and function operand. Examples are `Play → 0x378480`, `Simulate → 0x378e00`, `get_randomSeed → 0x3804f0`, and `set_randomSeed → 0x38d130`.

One `.pdata` entry can describe only the first unwind fragment of a function. The inspector traverses the local control flow within PDB function bounds, or uses an exact stripped local procedure length. It does not hash just the first fragment and call it the whole method. Out-of-section addresses, ambiguous lengths and unsupported indirect branches fail explicitly. Aliases remain lists; the tool does not assign the first alias's signature.

The independent `unity-particles-v35` Ghidra project imports UnityPlayer with no global analysis or GameAssembly header. `ExportUnityParticleMethods.java` verifies each source byte range before bounded disassembly/decompilation. Its completion receipt binds the executable, inspection and C digests. It never opens the shared GameAssembly database.

## Recovered state and execution

| Native RVA | Identity and supported role |
| --- | --- |
| `0x764ce0` | `RandN::SetSeed`, four independent lane states |
| `0x18d790`, `0x18e050` | `RandN::Get`, `GetFloat`, integer and float draws |
| `0x191860` | `ParticleSystem::ResetSeeds`, automatic manager draw and per-module reset order |
| `0x20abb0`, `0xda98f0` | Initial/Shape reset from the resolved system seed |
| `0x206ce0` | Noise `ResetScroll` / `AwakeFromLoad` shared body; scroll reset only |
| `0x184760`, `0x764bd0`, `0x814370` | Manager construction, `Rand::RandomizeState`, system entropy |
| `0x1af7e0` | `EmissionModule::EmitOverTime` |
| `0x1aeab0`, `0x1ae9a0`, `0x1ae630` | Continuous accumulation, burst interval selection, burst count |
| `0x1b0d30` | `ParticleSystemState::Tick`, loop time and counter |

`seedParticleRandom(seed)` creates four uint32 words by repeated multiplication by `0x6c078965`, plus one. `seedParticleRandomLanes(seed)` creates independent lanes seeded at `seed + 0`, `+367`, `+734`, `+1101`, modulo 2³². Advancing a lane uses the source xorshift128 operations with shifts 11, 8 and 19. A float draw takes the low 23 bits and multiplies by source float32 bits `0x34000001`. It can reach 1; replacing it with division by 2²³ changes the stream's values.

`resetParticleEmitterRandom({seed, autoRandomSeed}, managerState)` returns a new emitter subset and candidate manager state. Automatic mode consumes one integer from the supplied manager stream. Initial and Shape get independent copies of the same seeded lanes; Emission uses its own four words; Noise scroll becomes zero. The manager constructor calls `Rand::RandomizeState`, whose first branch uses `GetSystemEntropy → BCryptGenRandom`. Its fallback depends on other system inputs. No deterministic initial manager state can be recovered from the serialized `randomSeed: 0`; missing automatic state is an explicit failure.

This reset function is **not** `Play`, `Simulate` or prewarm. Their call sequence can invoke seed resets again. The host must recover and preserve that lifecycle rather than call this helper once and assume playback is initialized. Other enabled random modules and subemitters are not granted by the subset.

`emitParticleInterval(plan, state, {previousTime, currentTime})` implements the constant-rate, constant-count path used by all five actual assets:

- It advances the emission RNG once for the rate sample even when rate is constant or zero.
- Rate accumulation, fractional carry, integer count conversion and spacing use float32 order.
- Burst times use `[previousTime, currentTime)`. A zero-length interval does not fire a time-zero burst.
- A wrap accumulates beginning-of-cycle bursts before end-of-cycle bursts, retaining source RNG order.
- Probability zero skips a draw; probability one also skips a draw; intermediate probability consumes one draw and rejects at equality.
- Repeated bursts are selected once per record when an interval crosses a cycle boundary. The function does not synthesize one burst for every skipped cycle.

The actual rates are `10, 14, 8, 8, 8`; all actual burst counts are 1. Varying rate/count evaluation, infinite cycles, overflow and out-of-domain clock intervals remain rejected. No capacity policy or particle birth is inferred from an emitted count.

`tickParticleSystemClock` takes a supplied timestep. Looping uses repeated float32 subtraction and a wrapping uint32 loop counter; non-looping clamps to duration. It does not select the engine timestep. The local loop budget rejects unrealistic input before publishing any result.

## Compiler and ownership

`compileParticleEmitterEngine(inspections)` requires the exact reviewed DLL/PDB identity and fourteen kernel body hashes. File verification belongs to the inspector/checker; these JSON fields are not independently trusted host capabilities. `compileFieldParticleEmitter(group, graph, engine)` reuses strict EffectPrefab/module validation, then compiles the actual constant emission plan and unresolved requirements.

The output's simulation contract is explicit: local space, hierarchy scaling, speed 1, scaled time. This module does not rotate or transform positions. Future birth/motion code must retain local positions; the geometry host must apply the source emitter and parent transforms at their actual stage, not rotate the same particle twice.

The pure functions return candidates and never mutate caller state. The future shared particle owner must publish manager and emitter candidates together. A per-map reset would lose the real shared engine/pool lifecycle. This work changes no FieldGame, WorldSession, production renderer or save codec.

## Remaining source requirements

The 26-method exports also locate `Play`, `Simulate`, `ComputePrewarmStartParameters`, `ParticleSystemGeometryJob` preparation and the actual `GenerateParticleGeometry<0,0,0,0>` template. Those names and decompilations do not grant full execution.

`ComputePrewarmStartParameters` reads the engine TimeManager timestep, uses lifetime extrema and simulation speed, and performs emission advancement before regular simulation. A fixed Web timestep or one-duration-only shortcut is not established. Cone's draw consumption and transform order, Noise's derivatives/permutation, initial parameter draw dispatch, birth substeps, live-particle capacity/death order and integration still need their providers. Geometry and render-target color space are covered separately by the geometry line.

The actual five resource plans therefore retain explicit blockers and `admittedFullEmitters: 0`. The controlled 0.01-second source checks do not claim that 0.01 is Unity's timestep or prewarm schedule.

## Repeatable checks

Local tooling is LLVM `llvm-pdbutil`, Capstone 5.0.9, Ghidra 12.1.4/Temurin 21, and Unicorn 2.1.4. Capstone and Unicorn are pinned in `requirements.lock` for the local analysis/probe environment; neither is a Web runtime dependency. Obtain the exact PDB at the above GUID/age URL; never commit it or the DLL.

```sh
.venv/bin/python -m pip install -r requirements.lock
npx tsc -p tsconfig.json --outDir build/v35-particles-dist
node --test build/v35-particles-dist/tests/field-particle-emitter.test.js
.venv/bin/python -m unittest tools/tests/test_unity_particle_inspection.py
node scripts/check-field-particle-emitter-native.mjs
node scripts/check-field-particle-emitter.mjs --compiled-dir build/v35-particles-dist
```

The focused suite passes 13 TypeScript semantic tests and four Python inspector tests. Native binding passes 166 checks covering 26 methods, 779 ICall registrations and the direct entropy/reset call identities. The source checker passes 602 assertions: 144 RNG steps, 10 clock cases and 240 emission intervals match isolated execution of the actual DLL instructions. It also runs 120 explicit controlled intervals on each real source asset with one shared, explicitly seeded manager stream. These are kernel/state checks, not complete particle frames.

Local evidence is in `build/native/unity-player-symbols`, `build/native/v35-unity-particle-seeds`, `build/native/v35-unity-particle-emission`, and `build/reports/field-particle-emitter-{native-check,check,instruction-probes,inspection}.json`. Original binaries, PDB data, disassembly, decompiled code and source asset exports remain ignored.
