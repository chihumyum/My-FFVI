# FFVI Reweb development rules

Read `docs/architecture.md`, `docs/world-knowledge.md`, `docs/implementation-plan.md`, and the target dossier before changing behavior or content. Repository documents are the maintained project context. Do not depend on chat memory.

## Priority and evidence

Execution order is mandatory: migrate the original game to Web and pass the migration release gate before investigating or producing HD-2D enhancements. Narshe and opera are migration samples first. Existing opera effects may be studied only as necessary to reproduce the original Web behavior. Remaster documents and contracts are deferred design, not authorization to run an art workstream alongside migration.

Clean ownership and correctness take precedence over apparent coverage. Preserve observations, interpretations, unverified hypotheses, and deliberate changes as different records. Current source is the supplied Pixel Remaster build; Unity version is not the game's patch version. Do not substitute SNES formulas or lore recollections for this build's behavior.

Every extracted object retains source-set fingerprint, source file, file digest, and object/path identity. Unity path IDs are decimal strings across the Python/JavaScript boundary. Never round them through JavaScript numbers. Never edit generated `build/` files as an authoring workflow.

Unknown instructions, system-call selectors, dependencies, state applicability, or timeline semantics remain explicit. No silent no-op, nearest-looking asset substitution, guessed era, or fake passing oracle. Parser success, synthetic tests, browser inspection, original-game behavior, and artistic acceptance are independent evidence lanes.

## Semantic assets and world knowledge

Query `npm run knowledge -- <region-id>` before working on a region. Read the reported gaps. Assets have physical identity, region/culture/function, world/plot-state applicability, and provenance. Reuse requires those constraints to match. Visual similarity is discovery evidence only. A missing world-state value is unknown, not false. Several eligible variants are ambiguous, not first-match wins.

Add evidence-backed facts to the knowledge registry and record their scope. Facts from a source build do not silently transfer to another build. Contradictions must remain visible and prevent affected claims from becoming verified. Record speculative reconstruction in the dossier backlog, not as canon. User-authored additions belong to an explicit variant profile.

## Module ownership

`tools/source_adapter/` owns Unity parsing. `src/compiler/` owns typed content and capability analysis. `src/knowledge/` owns contextual fact and asset selection. `src/core/` owns deterministic game state. `apps/workbench/` inspects artifacts; it is not the game runtime. Renderer libraries stay outside core and knowledge. Add a dependency only for a demonstrated need.

Scene changes are recipes, semantic annotations, or versioned asset changes. A shared asset update requires an impact report and revalidation of dependent scenes. Preserve legacy logical collision and trigger anchors separately from new visual geometry.

## Batch migration priority

2026-10-14 user correction: prioritize the shared gameplay skeleton over isolated details. The v75 common battle increment is bounded; initial status and received-type capability do not admit a whole encounter pool. Close NPC autonomous activity and event ownership as the next complete module, with loading, cancellation and persistence at the existing owner boundaries. Do not turn one remaining battle AI PC or an opening camera instruction into the main workstream.

2026-10-13 renewed user priority: deliver the interactive systems skeleton before expanding regions or decoding more isolated source instructions. The systems playground must use the same repository, session, Flow, map loader, prepared battle handoff, commands and save APIs as the app. Authored demonstration content has its own package and save namespace; it never counts as source-story reachability. Close shared lifecycle defects and verify continuous play, then nominate bulk content work.

Framework work is measured by complete contracts between systems, not by reaching the next unimplemented instruction in the opening. Prioritize one session owner, content loading, transaction boundaries, failure/cancellation/retry and persistence across a continuous loop. Keep source-route probes as separate evidence; do not repeatedly turn their next visual or timing blocker into the main workstream. Validate representative combinations before expanding content batches.

The content-batch runner and app must consume the same entry, command, map and prepared battle-handoff APIs. Trusted content-package references, declared menu inputs and continuing after restore are implemented. After the representative shared loop passes, nominate complete content batches and implement their actual gaps as common capabilities. Do not extend framework work with isolated checks or hold this milestone until every special skill or exact presentation provider is recovered.

2026-10-12 user correction: prioritize the runnable game framework over detailed reproduction. The next deliverable is a continuous title/start → field/events → battle → rewards/growth → menu/save/load loop, with one session owner, shared flow control and a common content-loading contract. Freeze particle/shader/float-level reverse engineering unless it is indispensable to that loop. Use the explicit development profile for framework integration; retain exact-source gaps separately. Do not let a missing visual provider turn framework work into another extended low-level investigation. Establish and test the common systems before batch content population.

The latest user instruction is systems first, content population afterward. Until the shared gameplay systems form a working loop, prioritize battle resolution/status/scheduling/AI, persistent party/inventory/equipment/growth, saves and field integration. Existing content remains regression material; new source records may be used as controlled mechanism probes. Do not resume map-count or region-expansion work merely because one more parser or calculation is available. Track the systems gate in `docs/core-mechanics.md`.

The user rejected scene-by-scene implementation. Follow `docs/batch-migration.md`: implement shared VM, world-state, map lifecycle, battle and presentation capabilities, then import their source-data dependents in batches. Use `npm run corpus:plan` to identify affected scripts and maps. Exact coordinates and message IDs are source parameters, not separate implementation tasks. Do not add new map-name or encounter-ID branches to runtime rules. The existing opening profile is a regression fixture and temporary bootstrap, not a template to copy across the game. Static decoding counts must never be reported as playable map coverage.

## Verification and delivery

Run `npm run check`, Python tests, then the relevant real-source import/compile when adapters change. Acceptance commands intentionally fail while required lanes are unknown. Never relax a gate to make the build green. Add tests for semantic failures (state mismatch, identity loss, missing references, broken replay), not implementation mirrors.

Keep original game assets, extracted story text, local paths and generated previews in ignored local outputs. Commit tools, schemas, manifests, authored metadata and redistributable synthetic fixtures. The user has authorized Git tracking and synchronization to the private `chihumyum/ffvi-reweb` GitHub repository. Keep the repository private and exclude original assets and generated local outputs from commits.
