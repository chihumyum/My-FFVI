# FFVI Reweb

Goal: port FF6 Pixel Remaster to the Web, playable from a new game to the ending. Automatic play is regression only: boosted fresh new game through the ending, and normal stats through the three story branches (M3). HD-2D comes later.

## Principles
- Playable first. Report how far the story actually runs and which test mode was used. Test counts, covered sites and successful builds are not progress.
- When the automatic player loses, first distinguish a game bug (formula, ability effect, monster AI or source event) from a player-policy failure. Fix game bugs. For a strategy failure, continue from a real checkpoint in the explicit boosted story-test mode; do not add shopping, training, MP budgeting or other player intelligence to overcome it. Keep normal and boosted evidence separate.
- Data and assets come from PR; behavior follows the SNES disassembly (~/ff6-snes-disasm, commit 8130132). Values explicitly in PR's data win.
- When unsure, implement the most reasonable reading, log a warning, keep running. No unknown may ever stop the story.
- Original game assets, extracted text and generated output stay out of Git.

## Don't
- Don't open external Chrome/Safari during development or acceptance. Use the ChatGPT in-app browser; record external-browser compatibility as pending unless the user explicitly asks to run it again.
- Don't read legacy/ or reconnect archived builders, scripts or generated products.
- Don't add game-strategy intelligence to the automatic player: no new shopping, grinding, supplies, MP budgets or counter-cost prediction. Fixed, named story routes and ordinary inputs are allowed to repair regression blockers (for example, talk to the child before delivering cider); don't build smarter pathfinding for moving NPCs. Diagnose genuine game bugs and fix them; use explicit boosted mode for strategy failures.
- Don't add source hashes, evidence levels or "verified" flags to objects.
- Don't write a doc per feature. Maintain only README.md (how to run it) and STATUS.md (how far it plays, known issues, list of guessed implementations).
- Don't rebuild all 649 maps on every change; rebuild only what's affected. Don't copy the whole workspace to integrate.
- Don't write lots of tests for implementation details; only add tests for core calculations like battle formulas and for bugs you've fixed.
- Don't do IL2CPP / Ghidra native analysis unless a specific bug can only be investigated that way, capped at 1 hour.
- Don't run multiple parallel sub-agents in "integration waves". Two genuinely independent pieces (e.g. battle formulas and map instructions) may run in parallel and merge directly when done.

## Reporting
Current priority: restore a complete boosted fresh-new-game-to-ending regression before new feature work, then rerun the 39 optional-content cases. Complete the remaining four dragons and the same-save Crusader reward to finish stage 5. Pause individual NPC-dialogue acceptance; the remaining conversations are for the user's manual play. Then proceed directly to stage 6 (bestiary, gallery, reference library and music player).

Implement in order: battle commands/effects, foundation adjustment (format only; independent PR export; Opus/Web Audio; Pixi/WebGL; Vite static bundle), PR UI, battle presentation, field/audio, optional content, peripheral systems. At each stage, run boosted fresh-new-game-to-ending regression, update a one-screen STATUS.md, report browser screenshots/new guesses/issues/elapsed time, and continue without asking for acceptance. Ordinary failures must be classified before choosing a fix or a boosted continuation. Report how far it plays, the mode and checkpoint transition, new guessed implementations, known bugs and time spent. No percentages. A strategy failure does not block story migration; boosted completion is not normal battle-balance acceptance.

Foundation steps are sequential and separately committed. Every step must pass boosted fresh-new-game-to-ending regression and add a result line to STATUS.md. No game-logic changes in this phase; src/play must never import a renderer. Audio work moves from field presentation into foundation. Never deploy original assets publicly or commit them to Git.

After the formatter is introduced, run npm run format:check before every commit.

## Modules
- tools/export: independent data export from original PR files; hashes belong only in export caches/manifests.
- src/play: game logic and core regression tests; no renderer imports. Existing automatic-player strategy is frozen.
- apps/play: Pixi/WebGL rendering and game UI; read state/presentation events and dispatch ordinary game inputs. Never import this layer from src/play.
- tools/play: static bundling and regression harnesses; load only already exported data. Vite provides development serving; the shipped game needs only a generic static HTTP server.
- legacy/: archived old project; do not read.
