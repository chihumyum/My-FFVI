# Shared world auto movement

Forty `AddAirShipMoveTask` sites occur in 12 complete programs / 592 instructions.
The parent nomination retains all 68 programs / 6,709 instructions and 460 sites.
The decoder keeps r0 float32 seconds, the full unnormalized r1/r2 axis and i0
speed ID. Reserved fields, unknown speeds and non-Main forms stay blocked. Add
returns immediately; the existing Start/parallel queue remains the sole clock.

`web-flat-world-auto-move-v1` requires runtime and current trusted content, in
addition to `web-flat-world-auto-tasks-v1`. Saves carry no authorization. This
policy does not admit a missing transportation, renderer, media, active raycast,
collision or owned participation provider.

The source controller reads CameraFollowing.TargetEntity on each task tick,
rotates the original axis by the current camera Z rotation, multiplies by 16
source pixels and calls the actual entity's MoveTo. It does not move a camera
projection in place of an entity. Existing movement rejects another request
while its segment is busy. Duration comes from the source speed table and is
multiplied by sqrt2 only when both original input-axis coordinates are nonzero;
it is not multiplied by vector length. Zero/negative task durations invoke no
movement; zero axes and a source-proven absent following target invoke no entity
translation while the task clock really advances and retires.

The explicit flat Web policy uses the existing following player Actor.motion or
the camera dummy's existing transform and the same motion integrator. Logical
positions are real. It uses magnification 1, ordinary directional animation,
map bounds and periodic canonicalization. Unity player's movement-state
magnification and animation/movement callbacks, arbitrary collider raycasts and
3D pitch/bank are not reproduced. Active collision remains an explicit reached
gate; controlled parameter envelopes declare a collision-free precondition
through the real Field collision port rather than changing owned story flags.
Movement is not normalized or replaced with a guessed cardinal grid route.
Existing source script-boundary position-copy gates still reject resetting an
actively moving player/leader. Known InitCameraDummy resets cancel its old
transient segment through the same camera owner before later task requests.

One queue preserves insertion order across scalar and movement requests; each
movement request observes the rotation at its list position. A request against
an already moving owner does not restart it. Repeated Start preserves elapsed;
new append waits for another Start. Task duration can end before the final
entity segment ends. Active queue and final motion prohibit stable/event saves;
only the stable existing native actor/dummy codecs persist positions. There is
no new checkpoint version or separate saved aircraft pose.

Map preparation holds private queues. Cancellation, initialization/media failure
and stale candidates retire them. Publication retires the old queue/motion and
starts the destination owner. For an outgoing map request, only this exact
controller-owned motion has a private prepared-retirement projection. The real
native candidate remains moving; media failure/cancel leaves it untouched, and
real position/motion/instance fences reject old candidates. Other manual/NPC/
controller motions retain the original native handoff gate. Existing battle entry gates apply, and queued
movement remains suspended with its Field during a battle until successful
return. Existing passive Session audio/timer domains remain independent.

The whole-source checker retains original bodies, references, PCs and unknowns.
Its 40 actual operands run in explicitly authored Session envelopes; that lane
is not original-body execution, native parity or campaign reachability. The
parent owns one subsequent source-world producer and publication.

The shared producer requests exact `compiled-framework-profile-upgrade-v7`. It
requires all prior v6 hosts plus `worldAutoMove`, and hashes the actual
`worldAutoMoveBinding` provider used by FieldGame. v1–v6 keep their previous exact
shapes. Entry/world/map profiles carry the same current marker; this additive
proof cannot change scripts, geometry, media, source admission or save authority.
The generic initialized profile helper can declare movement with its queue
policy independently of bird actors; only the shared v7 derivation requires
the complete v6 marker set.
