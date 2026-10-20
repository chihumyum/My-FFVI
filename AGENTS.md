# My-FFVI

Goal: create a new, nonlinear 2D pixel RPG based on FFVI's world, with freely explorable regions, substantially expanded cities, interconnected stories and an extensible battle system. Keep the 2D pixel art direction and build on the existing battle foundation.

Current foundation: the PR Web port and its original campaign. Stabilize it while proving a reusable content workflow with an expanded city and its surrounding region, then extend the world in batches. The open world is a long-term goal, not a claim about the current game.

## Principles

- Playable first. Report how far the story actually runs and which test mode was used. Test counts, covered sites and successful builds are not progress.
- When the automatic player loses, first distinguish a game bug (formula, ability effect, monster AI or source event) from a player-policy failure. Fix game bugs. For a strategy failure, continue from a real checkpoint in the explicit boosted story-test mode; do not add shopping, training, MP budgeting or other player intelligence to overcome it. Keep normal and boosted evidence separate.
- For original content, data and assets come from PR; behavior follows the SNES disassembly (~/ff6-snes-disasm, commit 8130132). Values explicitly in PR's data win. New content and mechanics follow explicit project designs; intentional changes are not restoration bugs.
- Keep original content and authored additions distinguishable in data and rules. Prefer shared systems and data-driven content over per-scene exceptions; do not rewrite working systems speculatively.
- Reuse assets by game meaning: stable identities for regions, locations, characters, factions and quests, with explicit story-state variants. Quest availability and consequences should use prerequisites and world state instead of a single global chapter counter. These are design requirements for new work, not claims that the systems already exist.
- Keep the original campaign as a compatibility regression: boosted fresh new game through the ending, and normal stats through the three story branches (M3). Accept new content through ordinary inputs, exploration routes, quest prerequisites, outcomes and persistent world changes; do not force it into the original linear route. Automatic play remains regression only.
- When unsure, implement the most reasonable reading, log a warning, keep running. No unknown may ever stop the story.
- Original game assets, extracted text and generated output stay out of Git.

## Don't

- Don't open external Chrome/Safari during development or acceptance. Use the ChatGPT in-app browser; record external-browser compatibility as pending unless the user explicitly asks to run it again.
- Don't read legacy/ or reconnect archived builders, scripts or generated products.
- Don't add game-strategy intelligence to the automatic player: no new shopping, grinding, supplies, MP budgets or counter-cost prediction. Fixed, named story routes and ordinary inputs are allowed to repair regression blockers (for example, talk to the child before delivering cider); don't build smarter pathfinding for moving NPCs. Diagnose genuine game bugs and fix them; use explicit boosted mode for strategy failures.
- Don't add source hashes, evidence levels or "verified" flags to objects.
- Don't write a doc per feature. Keep README.md for project direction and how to run it, AGENTS.md for development rules, and a one-screen STATUS.md for what actually plays, known issues and guessed implementations. Keep plans separate from implemented behavior.
- Don't rebuild all 649 maps on every change; rebuild only what's affected. Don't copy the whole workspace to integrate.
- Don't write lots of tests for implementation details; only add tests for core calculations like battle formulas and for bugs you've fixed.
- Don't do IL2CPP / Ghidra native analysis unless a specific bug can only be investigated that way, capped at 1 hour.
- Don't run multiple parallel sub-agents in "integration waves". Two genuinely independent pieces (e.g. battle formulas and map instructions) may run in parallel and merge directly when done.

## Reporting

Stage A completed at v1.0. The user has now authorized a public source repository and public game URL, with separately hosted resources and isolated anonymous save identities. Original assets/extracted data still never enter Git. Cloudflare resources live in the dedicated R2 bucket; the game URL serves them read-only. Each random recovery key owns an isolated D1 namespace and local IndexedDB. Never log recovery keys, put them in URLs, or silently change a running game's identity. Keep the old password-protected private saves intact. Preserve compare-and-write, both sides of conflicts and historical versions; no timestamp-only last-write-wins. Acceptance uses disposable profiles, never the owner's production private saves. Put reports in build/play/deployment/. Run headless Playwright Chromium/WebKit, a fresh boosted new-game-to-ending regression and unchanged visual standards; do not open native Chrome/Safari. After delivery, stop for manual acceptance. Existing visual/numeric residuals remain open.

The following is historical acceptance context, not an instruction to resume an earlier stage:
The boosted main story, 39 optional-content cases, remaining dragons/Crusader and stage 6 were completed before v1.0. Individual remaining NPC conversations are for the user's manual play. Preserve their versioned acceptance evidence and known residuals.

For gameplay, content or presentation changes, preserve the original boosted fresh-new-game-to-ending regression and applicable visual standards, and check the changed content's own routes and world-state outcomes. Report what actually plays, test mode, screenshots/report paths, new guesses, known bugs and time spent. No percentages. Boosted completion is not normal battle-balance acceptance or acceptance of the expanded world. Documentation-only changes need documentation checks, not a gameplay run.

Run npm run format:check before every commit. Public resource delivery follows the user's current explicit deployment authorization.

## Modules

- tools/export: independent data export from original PR files; keep authored additions separate so re-export cannot overwrite them. Hashes belong only in export caches/manifests.
- src/play: shared game logic, world/quest state and core regression tests; no renderer imports. New rules must preserve the original campaign baseline. Existing automatic-player strategy is frozen.
- apps/play: Pixi/WebGL rendering and game UI; read state/presentation events and dispatch ordinary game inputs. Never import this layer from src/play.
- tools/play: static bundling and regression harnesses; load only already exported data. Vite provides development serving; the shipped game needs only a generic static HTTP server.
- server: optional private self-host service, authentication, protected static resources and transactional SQLite saves; no gameplay rules. deploy/: portable Docker/Caddy templates, no credentials. Plain static mode remains supported without this service.
- cloudflare: Worker, read-only R2 resources and D1 save adapter; no gameplay rules. Public pages/resources are independent of authenticated save namespaces. Legacy private saves retain password authentication. Production secrets and game assets stay out of Git; local Wrangler bindings must not write to production. Preserve compare-and-write and history semantics.
- legacy/: archived old project; do not read.
