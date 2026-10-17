# FFVI Reweb

Goal: port FF6 Pixel Remaster to the Web, playable from a new game to the ending. Diagnose ordinary battle failures, but do not require a perfect automatic normal-stat run. HD-2D comes later.

## Principles
- Playable first. Report how far the story actually runs and which test mode was used. Test counts, covered sites and successful builds are not progress.
- When the automatic player loses, first distinguish a game bug (formula, ability effect, monster AI or source event) from a player-policy failure. Fix game bugs. For a strategy failure, continue from a real checkpoint in the explicit boosted story-test mode; do not add shopping, training, MP budgeting or other player intelligence to overcome it. Keep normal and boosted evidence separate.
- Data and assets come from PR; behavior follows the SNES disassembly (~/ff6-snes-disasm, commit 8130132). Values explicitly in PR's data win.
- When unsure, implement the most reasonable reading, log a warning, keep running. No unknown may ever stop the story.
- Original game assets, extracted text and generated output stay out of Git.

## Don't
- Don't add source hashes, evidence levels or "verified" flags to objects.
- Don't write a doc per feature. Maintain only README.md (how to run it) and STATUS.md (how far it plays, known issues, list of guessed implementations).
- Don't rebuild all 649 maps on every change; rebuild only what's affected. Don't copy the whole workspace to integrate.
- Don't write lots of tests for implementation details; only add tests for core calculations like battle formulas and for bugs you've fixed.
- Don't do IL2CPP / Ghidra native analysis unless a specific bug can only be investigated that way, capped at 1 hour.
- Don't run multiple parallel sub-agents in "integration waves". Two genuinely independent pieces (e.g. battle formulas and map instructions) may run in parallel and merge directly when done.

## Reporting
Self-accept using automated playthroughs and browser checks, then continue toward the ending without waiting for user confirmation. Ordinary failures must be classified before choosing a fix or a boosted continuation. Report how far it plays, the mode and checkpoint transition, new guessed implementations, known bugs and time spent. No percentages. A strategy failure does not block story migration; boosted completion is not normal battle-balance acceptance.
