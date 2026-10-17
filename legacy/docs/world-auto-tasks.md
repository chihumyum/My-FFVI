# World auto-task scalar family

This family retains 68 complete original programs / 6,709 instructions and all
460 named sites. The admitted common commands are 82 rotation tasks, 94 flight
altitude tasks, 29 up/down tasks and 147 Start commands: 352 sites. The 40 spatial
auto-move and 68 MoveBirdView sites retain complete raw/source/PC evidence and
explicit gates. Scalar support does not grant spatial motion, source aircraft
control, an actor's BirdViewPuppet elevation component or joined Move completion.

`web-flat-world-auto-tasks-v1` requires both a runtime host and the same marker in
the trusted current framework content. `compileFrameworkContent` accepts it as
an explicit option; the shared Web source producer declares that option. Strict
source derivation does not. Old content and hosts remain unchanged. No map name,
script ID, PC, transportation ID or guessed story flag selects implementation.
Neither task commands nor camera checkpoints can grant the policy.

FieldGame owns one ordered parallel queue on its existing 10 ms field clock.
Each Add reads its current camera scalar immediately unless i0=1 supplies r2 as
the start. r0 is float32 seconds; r1 is the rotation increment or the altitude /
up-down endpoint. Rotation writes captured start + clamped progress * increment;
the other channels write float32 Lerp. A zero or negative duration does not invoke
a setter or force an endpoint; it terminates on a real following tick. Completed
tasks retire rather than accumulating stale callbacks.

Start returns immediately and does not clear or consume the task list. This Web
policy starts all pending tasks together, preserves already running elapsed time
on repeated Start, and requires another Start for a task appended while others
are running. Simultaneous writes to one channel apply in insertion order. These
are explicit, tested Web scheduling rules; native Start calls every ITask.Start,
and this work does not claim Unity frame partition or repeated-Start parity.

The existing FieldCameraHost owns the only scalar pose. New camera v4 contains
the current view plus a source-bound world-auto pose; old v2/v3 checkpoint shapes
are unchanged. The declared initial flat pose is rotation=0, altitude=0,
upDown=0, rather than an inferred native camera default. The production Canvas
renderer rotates the map/actor frame around its center, maps altitude to bounded
exponential zoom, and maps up/down to vertical source-pixel offset. Logical actor
coordinates, collision, camera target/dummy and transportation ownership do not
change. Dialogue/HUD/fades remain screen-space. This is a flat projection, not
Unity Bird perspective, aircraft pitch/bank/animation or render-target fidelity.

Pending or running tasks prohibit stable and event-barrier saves. After the queue
drains, the camera pose persists through CheckpointStorage and restores only with
the same trusted field binding and runtime policy. Map preparation can run Add
and Start into a private held queue, but it cannot tick before publication. Queue
and pose enter the existing preparation fence. Failed initialization, media
failure, cancellation or a stale candidate retires private tasks without changing
the outgoing owner. Successful map publication retires the old queue and begins
the destination's fresh flat pose. Old work cannot affect the new Field/camera.

Battle uses the same suspended Field/camera. Its auto tasks do not tick during
battle; they resume after successful return. Existing Session story timer/BGM/SE/
environment clocks remain separate, independently committed passive domains.
This family does not reopen those clocks or claim cross-domain rollback.

`check-world-auto-tasks-native.py` verifies all 24 cached complete methods and
7,056 original PE bytes, keeping every shared alias. Init/Destroy have incorrect
Ghidra early returns after GC barriers: the original PE stream proves Init's
TaskMachine(1, Parallel), Destroy's cleanup call and all six cleared delegates.
The receipt states the decompiler limitation explicitly. No Ghidra session or
original game execution is required by this checker.

`check-source-world-auto-tasks.mjs` loads the verified corpus once, verifies the
full nomination and retains every selected original body, unknown and reference.
Its 352 actual source operands run through separate authored Session envelopes;
those are parameter lifecycle checks, not selectively rewritten source programs
or story reachability. Actual whole-body/campaign replay belongs to the parent's
single subsequent candidate. No world producer or public publisher runs here.
