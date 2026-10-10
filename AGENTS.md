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

The user rejected scene-by-scene implementation. Follow `docs/batch-migration.md`: implement shared VM, world-state, map lifecycle, battle and presentation capabilities, then import their source-data dependents in batches. Use `npm run corpus:plan` to identify affected scripts and maps. Exact coordinates and message IDs are source parameters, not separate implementation tasks. Do not add new map-name or encounter-ID branches to runtime rules. The existing opening profile is a regression fixture and temporary bootstrap, not a template to copy across the game. Static decoding counts must never be reported as playable map coverage.

## Verification and delivery

Run `npm run check`, Python tests, then the relevant real-source import/compile when adapters change. Acceptance commands intentionally fail while required lanes are unknown. Never relax a gate to make the build green. Add tests for semantic failures (state mismatch, identity loss, missing references, broken replay), not implementation mirrors.

Keep original game assets, extracted story text, local paths and generated previews in ignored local outputs. Commit tools, schemas, manifests, authored metadata and redistributable synthetic fixtures. No automatic publication or remote creation is part of this project setup.
