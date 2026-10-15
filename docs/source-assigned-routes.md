# Source assigned NPC route lifecycle

`AssignMoveRoute` is an asynchronous controller takeover. It is separate from
puppet `Route` and autonomous NPC polyline movement. Source aliases, instruction
arrays, raw operands and decimal-string physical IDs remain intact.

The explicit runtime policy `web-assigned-npc-route-grid-v1` uses the existing
FieldGame clock, Actor motion/native entity/animation and EventState owners.
MoveTo uses deterministic bounded four-neighbor grid search over the existing
collision and occupancy host. This is a deliberate Web policy, not a claim of
native MapRouteSearcher/raycast parity. No-path retries without teleporting.
Cross-layer MoveTo, nonzero arc, unknown instruction, unavailable animation or
nonpositive playback scale remain explicit blockers.

All ten source instruction kinds are parsed as a complete program before
controller takeover; an unsupported later action cannot partially reset the
actor first. Replacing an owned assigned route cancels its own movement only.
Main completion does not retire the route. Route execution performs one
Execute/Update phase per fixed tick. Existing Flow/map/battle leases freeze it.

Active Delay, Compare, cardinal motion and ordinary Lerp use source-bound
checkpoint metadata. The live policy, exact source catalog and original script
site are required to restore. Restoring does not replay Assign or Setup.
New codecs are `idle-field-v14` and `event-field-v5` when this lane is enabled;
old content/lanes retain their prior codecs. AutoSave uses the same event owner.

The public compiler attaches the complete package-local `npcRoutes` catalog.
Old recipe pins are unchanged. An explicit
`compiled-source-npc-route-evidence-addition-v1` declaration permits only the
exact additive catalog rederived from the verified complete source corpus;
full alias/body/physical refs and all other source/media/profile identities
remain checked. This evidence grants no runtime or story admission.

Reproduce ignored candidate and whole-program attempts:

```
node scripts/compile-source-assigned-routes.mjs --compiled dist --output build/reports/source-assigned-route-candidate
node scripts/check-source-assigned-routes.mjs --compiled dist --candidate-dir build/reports/source-assigned-route-candidate --report build/reports/source-assigned-routes-check.json
python3 scripts/inspect-assigned-route-native.py --evidence-dir build/native/source-assigned-routes --report build/reports/source-assigned-route-native.json
```

The first two tools bind compiler/app/script hashes and original inputs. The
native packet is generated separately with the repository's bounded Ghidra
exporter; the audit reads raw bytes and existing cached receipts. Original
assets, programs, native C and generated reports remain ignored.

Whole-program evidence distinguishes the original initializer from an explicitly
authored controlled Exit entry over the same source map. All root programs and
same-map namespaces stay unchanged; unknown initializers, branches and providers
are recorded. Complete original programs, finite route completion, loop-cycle
boundaries and active-save restoration are separate outcomes. None of these
controlled probes establishes source story navigation or full-game completion.
