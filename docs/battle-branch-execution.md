# Source battle branch execution

Strict whole-program admission remains the default. The explicit Web policy
`web-source-battle-branch-execution-v1` permits a path to run while retaining
opaque, unimplemented instructions in branches it has not visited. It never
implements, skips, resumes past, or supplies results for those instructions.

Authorization requires all three owners: a `battle-event-v2` program and
`battle-lifecycle-v2` script declaration; source directory policy v4 declaring
the same policy; and the actual runtime host supplying that policy. The game
App and shared replay runtime use the same GameSession/BattleGame host port.
Legacy lifecycle/program v1 retains strict admission. Checkpoint Storage contains
no capability grant, and restoring requires the host to supply its policy again.

Every v2 program retains its complete original source identity and source body:
Main range, title/name, all instructions and operand arrays, labels/comments,
script-local declarations/initial values, SystemFlag and custom animations.
Parsing validates the entire body and all typed operations on every preflight,
including instructions outside the current branch. Full Main, source identity,
source/local consistency, all jump targets, binding ownership and operand
dimensions remain hard gates.

Only blocked semantic operations are eligible for deferral. Classification uses
the original type, full operand form, mnemonic and implemented selector set; the
diagnostic wording cannot grant or revoke admission. Opaque SysCall requires
the complete zero-argument form with its sole nonempty selector in s0. Its
category is `unimplemented-selector`; unknown instruction semantics use
`unimplemented-instruction`. A known implementation with invalid arguments,
missing local state, missing message/effect/master data or unsupported resource
binding remains hard. The v2 dependency list must exactly match those original
blocked sites and retains their original PC, category and reason.

Gau leap/join/reserve/appearance and other opaque selectors receive no owned
character, Rage, roster, replacement, queue or visual lifecycle permission from
this policy. Their specific reasons remain intact. A future implementation must
extend the shared implemented set so its bad forms cannot be classified as
opaque. Existing AI, flags, conditions, participant layout, borrow/return and
dynamic provider diagnostics are not downgraded by branch admission. Materializing
a root can reveal additional typed dynamic dependencies which strict preflight
previously hid; both initial bindings and those dynamic gates must be reported.

The first v2 source execution occurs in the existing BattleGame frame, including
roots without a message/effect. Actual entry to an unknown instruction throws
BattleEventError with source, exact PC, original reason, raw instruction and
attempted visits. BattleGame restores VM continuation, locals/shared banks, RNG,
combatants, actions, UI, timers and prepared shared message/effect state. Resource
cleanup occurs after state restoration and cannot replace the original error.
Successful frame publication records committed visits; failed-frame attempted
visits and unvisited PCs/dependencies are separate evidence. An unchanged retry
hits the same unknown instruction. Return/retry retires the old BattleGame owner.

GameSession passive domains advance before the BattleGame subframe: field story
timer, BGM, SE and environment clocks retain their existing independently committed
semantics. A failed battle subframe does not roll those clocks or physical audio
back. Field script dispatch and owned rewards remain suspended/unpublished. This
policy makes no cross-clock atomicity or Unity timing/particle parity claim.

`inspect-source-battle-branch-execution.mjs` loads the verified source corpus once
and compares strict and explicit policies over every retained battle program and
every original party dependency. It reports exact downgraded unknown sites,
newly visible hard gates, full body/source records and no source execution claim.
`check-source-battle-branch-execution.mjs` consumes an existing candidate through
the shared complete-body replay path and records actual outcomes and traces.
Neither tool launches the world producer. A preflight-accepted program, a compiled
encounter definition, or a completed synthetic path does not certify a complete
source family, source storyline, original-game parity or the whole Web migration.
