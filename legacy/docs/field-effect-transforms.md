# Source noncharacter board transforms

This shared family moves actual `FieldEffects` boards through the existing Puppet VM and Field logical clock. It does not construct an `Actor`, second camera, renderer, collision owner or particle scheduler for them. The explicit Web policy is `web-source-logical-board-transforms-v1`; existing logical media playback remains the Web presentation policy. Unity particles, precise Birdview scaling, Sprite animation and native layer callbacks are not granted.

## Source scope and boundaries

The full census retains 649 maps (5 without compiled geometry), 3,304 physical programs / 186,003 instructions and all 17,477 raw transformation sites: 5,140 SetPos, 6,346 Move, 1,026 MoveTo, 4,897 Lerp and 68 MoveBirdView. Static Puppet aliases nominate 402 board-transform sites across 31 complete bodies / 11,498 instructions: 215 SetPos, 175 Lerp and 12 Move. The 380 ordinary / 22 Birdview counts describe aliases, not distinct boards. One alias also has a possible different target kind; no source alternative is selected by list order.

This implementation supports source-bound, non-building, non-collision, non-screen logical boards with complete all-loop side-effect-free media proof. SetPos requires preserved layer and an empty animation; relative forms resolve their actual current reference owner. Lerp supports the current layer (including native layer 12), empty animation and direct Transform Y arc. Move/MoveTo, layer callbacks, Sprite-specific offsets, unbound media, ambiguous geometry and missing instances remain concrete failures. A complete imported body can still stop on any of those dependencies. Static nomination and controlled original-operand envelopes are not whole-story execution.

## Source proof and runtime authority

`FieldEffectCatalog.boardTransforms` is independent of legacy `webPolicy.boardProjection`. It stores the complete original kind-11 raw-object cohort, including rejection reasons, every source-map hash, exact raw/entity/source membership, immutable factory placement and callback contract. The compiler recomputes placement from the source definition, map range, layer and native standby anchor. It compares the actual strict compiled entity with a fresh import of its original raw object.

A Birdview board must additionally retain its exact legacy flat-v1 raw/entity/factory binding. Legacy flat-v1's placement equality and logical-catalog hash are unchanged. The transform catalog references that existing hash and adds no permission to the old policy.

Current content and a fresh `GameSessionRuntime.fieldEffectTransforms` must both declare the exact marker. The actual `FieldEffects` host must separately declare the same `boardTransforms` marker. Runtime binding verifies source/parent/map identity, current immutable entity membership and the actual camera-host map range. The versioned production declaration and input lock bind the complete assessment and projected catalog. A marker, saved reference, same asset name or successful previous map cannot supply missing proof.

A board's immutable definition/factory position remains separate from its mutable `position`. Creation always starts at the proven factory position. A stable checkpoint stores current numeric coordinates and a versioned source ref, never authority or a live handle. Restore first verifies current source/raw/definition/factory/flat proof and fresh runtime/host authority, then accepts a stable current point. No initializer replay or replacement player allocation occurs. Transient interpolation Z cannot be saved as stable data.

## Actual instance lifetime and transactions

`FieldEffects` owns opaque per-board lifetime tokens in a private sidecar. They survive ordinary effect ticks and successful candidate-to-live publication. Destroy/recreate with the same local ID and even the same cached player/camera creates a new token. Candidate cancellation does not retire the live instance. Tokens never enter JSON, checkpoints, host plans or journals.

`FieldEffectMap.captureBoard` binds the actual map lease, global board identity and token. Retired maps and replaced instances fail before an older task can publish another interpolation step. Source SetPos/Lerp prepares an ordinary effect transaction; its final guard checks the current board, source binding, reference instance/pose and map owner. A failed preparation publishes no transform. Map preparation remains private until the existing WorldSession commit; media failure/cancellation preserves the live pose and retry creates the destination instance once.

Puppet progress additionally binds its actual program object, original operation/fingerprint, PC, General-register bank and expected current position. It cannot migrate to another script or silently resume beyond a stale instance. Existing Save, ChangeScript/hook, main completion, battle and map interpolation barriers include this progress. Field time and effect time pause under the existing Flow/media/battle rules; this is an explicit Web clock contract, not proof of Unity's global-clock behavior.

The VM publishes instructions separately. A later unsupported instruction does not roll back earlier committed instructions, passive effect ticks or unrelated Field state. The whole-map candidate publication remains atomic. The existing external host contract requires prepared publication commits to be non-failing; arbitrary custom irreversible host effects are outside rollback claims.

## Coordinate and clock semantics

The verified cached Puppet SetPos, Lerp, factory and effect-owner methods are reused; this family adds no native export or controller investigation. Existing native checkers retain complete C/PE receipts separately from dynamic acceptance.

SetPos uses the existing source conversion: subtract the map origin with int32 semantics before checking negative-axis sentinels. A negative raw coordinate is not necessarily a sentinel on a negative-origin map. Relative placement floors the actual reference world point to source cells, applies float32 offsets and preserves the destination's Z; it does not subtract the map origin twice. Native SetPos's preserved-Z lookup has only three entries: source Z49 remains a concrete rejection.

Lerp uses the existing Puppet float32 clock and double elapsed/duration ratio, clamps the terminal ratio, then performs float32 coordinate interpolation. Non-Sprite arc writes directly to Transform Y. Its four source layer values are Z349/249/149/49; during interpolation Z is the same value minus five and completion restores it. Zero duration completes on its actual command clock. No shortened durations, map IDs, source PCs or guessed grid routes are used.
