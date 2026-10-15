# Source non-damaging battle abilities

This common family extends the existing development battle executor. It does not grant story reachability, native VFX parity, ability ownership or a menu entry.

The complete source census contains 1,530 abilities. Of the 36 abilities referenced by the 63 `BattleAction` sites in 13 physical source programs, 26 previously blocked abilities share one source protocol: a sole Function19 with zero operands, `None` process, type35/system2, range5, no content/element/condition flags, and zero power, MP, level and wait inputs. The compiler selects this protocol by its complete rows, not by skill ID. All other Function19 compositions and the three special scripted-action dependencies remain blocked.

## Source contract

The fixed DLL's FunctionProvider dispatches Function19 to `NonFunction` and `NonFixedMissFunction`. `NonFunction.Calc` calls `SetStatus`, then `GetFixedStatus(Hit=0)`. Its `UpdateParameter` override is the verified shared return body. This is a present fixed-Hit result with zero value/hit count and no parameter update. It is distinct from the FF6 Unique empty dictionary, a miss, zero HP damage, healing or a status change. Type35 selects `NonActFunction`; the original action and animation stages are preserved as evidence, not silently declared absent.

The source effect and sound asset table references remain bound and recorded. Missing effect/sound rows reject the plan. Source abilities with no `content.csv` row retain `display.kind = missing-content`, `abilityContentIds[id] = null` and an empty display name. Only the complete supported non-damaging protocol may execute without that menu identity. Ambiguous content, a missing referenced message and all other missing-content abilities remain blocked. Neither an owned ability nor a command is created.

## One owner and explicit Web presentation

`BattleGame` keeps its existing action, queue, RNG, payment, reaction, target instance, condition and settlement owners. The typed result does not modify target HP, MP or conditions and draws no random value. The existing action host handles any cost, counter/received-command reactions, retirement, rollback, pause and synchronization. System2 remains subject to the existing ordinary-counter exclusions; a source received-command counter may still observe type35. Empty-dictionary results still do not count as a hit.

Each compiled definition declares `web-source-non-damaging-effect-deferred-v1`, the exact `BattleEffectAssetId`, effect row fields and sound IDs. Native effect graphics, audio and animation timing are deferred. The existing 400/900 ms Web action stages provide a bounded continuation policy; they are not an original animation or native completion measurement. The actual BattleView draws no invented beam, lunge, damage number or miss for this result. A missing or unknown declaration blocks the action before enqueue, and it is checked again before effect commit.

No new save schema, clock, controller, battle owner or resource store is introduced. Stable owned Storage follows the existing terminal return transaction. Pending battle state is not made saveable by this capability.

## Reproducible checks and limits

`tools/native/check_non_damaging_abilities.py` verifies the complete six new native bodies, three existing provider/fixed-status bodies, raw virtual-call operands, metadata, original DLL/header/symbol hashes and shared return aliases. Native binaries and C output remain ignored local evidence.

`node scripts/inspect-source-non-damaging-abilities.mjs` uses the verified full corpus and pure ability/battle-directory compilers. It retains all 284 Function19 abilities, all 53 battle programs and their original source/AI dependencies, all 63 scripted-action sites and the complete 490-party battle directory. It never compiles the world or publishes content. Unknown script, AI, flags, parameters and provider diagnostics remain in the report. Mechanism tests and controlled App/BattleView tests are independent of complete original-program acceptance.

In the private source snapshot, the complete protocol adds 144 plans; the remaining 140 Function19 abilities retain their unresolved inputs. Scripted-action plans increase from 7 to 33 of 36. The complete pure battle directory still admits zero encounters because other dependencies remain unresolved. These counts are source/compiler observations, not 144 playable skills or completed story scenes. Final source execution uses the parent's one fresh candidate for the combined frozen runtime; old candidates are not re-signed.
