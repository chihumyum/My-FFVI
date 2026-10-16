# FFVI Reweb

Goal: port FF6 Pixel Remaster to the Web, playable from a normal new game to the ending. HD-2D comes later.

## Principles
- Playable first. Progress has one measure: how far a normal new game gets in the automated playthrough. Test counts, covered sites and successful builds are not progress.
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
Stop when a milestone is done and wait for the user to confirm. Report: how far it plays, new guessed implementations, known bugs, time spent. No percentages.
