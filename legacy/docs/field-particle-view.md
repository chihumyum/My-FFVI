# Particle view provider: recorded investigation, not runtime admission

This v37 workstream stopped when the user prioritized a runnable game-system
framework over further particle detail. It adds a source exporter and preserves
the completed native inspection inputs. It adds **no core/compiler provider,
renderer integration, gameplay admission or new playable profile**. Existing
particle provider gates remain in force. The proposed API below is not available
to production callers.

## Source facts retained

`tools/export_field_particle_view.py` reads the checked corpus and original
bundles. It retains decimal-string object IDs, serialized-file identities,
bundle digests, raw transform/active fields, and a checked output snapshot.
Original asset data remains under ignored `build/` paths.

The selected `FieldMap` scene component has `effectParent` referencing a
standalone `EffectRoot` Transform: no parent, zero position, identity rotation,
unit scale, active GameObject. This is an object-reference binding, not a match
inferred from its name. The inspected `FieldMap.CreateInstance` (`0x38dda0`)
passes that reference to `MapManager.effectRootObjectTransform` at offset
`0x80`, before `SetCommonResource` (`0x30f710`) passes it into
`FieldEffectInstanceManager.Init` (`0x575030`). The latter creates a GameObject
and parents its Transform with `worldPositionStays=false`.

The existing `CreateEffect` (`0x574910`) parents each particle entity beneath
that manager root and assigns its local Y using the manager's allocation
sequence. This Y already belongs to `FieldEffectPlayerState.positionY`; a view
provider must consume that owner. The board's map position is not the particle
root position.

The five selected EffectPrefabs have `playOnAwake=true`. Their particle
GameObjects and every Transform ancestor through the selected prefab are
active. The field particle entity prefab and scene EffectRoot are also active.
This export supplies activation inputs; it does not establish how many Play
calls or random draws the runtime performs. That ordering belongs to the
separate lifecycle investigation.

The original `globalgamemanagers` contains:

- PlayerSettings path ID `1`: `m_ActiveColorSpace=0` (Gamma).
- GraphicsSettings path ID `7`: no custom render pipeline.
- BuildSettings path ID `11`: `m_GraphicsAPIs=[2]`, `enabledVRDevices=[]`.

The matching UnityPlayer D3D11 constructor binds the device projection method
at virtual slot `0x180` to `0x892590`. GraphicsCaps construction initializes the
projection flags to zero; D3D11 initialization sets reversed Z. The projection
method separately handles Y inversion and the reversed-Z remapping. Gamma
color space does not select the projection's depth direction.

`Camera.GetProjectionMatrix` (`0x5f4740`) and `Matrix4x4.SetOrtho` (`0x759530`)
provide the ordinary orthographic branch. `Camera.GetWorldToCameraMatrix`
(`0x5f5da0`) applies the camera handedness change to
`Transform.GetWorldToLocalMatrixNoScale` (`0xde1520`). These are inspected
source functions, not a completed source-driven projection implementation.

For motion, `ParticleSystem.UpdateLocalToWorldMatrixAndScales` (`0x199b60`)
builds its simulation matrix according to the selected transform/scaling mode
and computes an inverse using a float32 determinant and cofactors. It does not
simply transpose the emitter rotation, and it is not the same computation as
`Transform.GetWorldToLocalMatrix` (`0xde1460`). This distinction matters for
the rotated `ef_ff6_m_001` emitter and must survive a future implementation.

## Reproducible export and retained receipts

```sh
.venv/bin/python tools/export_field_particle_view.py \
  --source build/runtime/game \
  --output build/v37-field-particle-view
```

The completed export has five prefab records and source-set hash
`0197c75bde75fa4cb1392b8993451932dcac76b79809cc03919fe9d68a04b938`.
`view.json` and `snapshot.json` include the scene root, entity prefab, active
ancestor chains and the three settings objects. Export success is an input
integrity check, not a passing particle runtime check.

The dedicated `tools/native/ExportUnityParticleViewMethods.java` uses the
existing exact-PDB inspection format and bounded function ranges. Completed
ignored receipts are:

| Directory under `build/native/` | Methods |
| --- | --- |
| `v37-field-particle-view` | `30f710` |
| `v37-field-particle-root` | `38dda0` |
| `v37-unity-particle-view` | `892590`, `759530`, `5f5da0`, `44b550`, `45efa0` |
| `v37-unity-particle-view-transform` | `7ce5f0`, `de1520`, `de1460`, `754370`, `759810` |
| `v37-unity-particle-view-matrix` | `914620`, `ddf860`, `18f460` |
| `v37-unity-particle-view-submit` | `895950`, `8961d0`, `895880` |
| `v37-unity-particle-view-motion` | `b5b50`, `199b60`, `197200` |
| `v37-unity-particle-view-target` | `671c70`, `671b30` |

All eight final export processes completed. Their receipts contain two
GameAssembly and 21 UnityPlayer methods and retain `semanticsVerified=false`.
Managed C output may omit code after an incorrectly inferred non-returning
write barrier; the complete original method range remains the authority.
`3106a0` was rejected by the managed exporter because its RVA has shared IL2CPP
signatures; it is not counted as a completed export. `895aa0` was rejected by
the generic CFG inspector for its indirect tail call; it is not counted either.
No unknown branch was accepted merely to finish either export.

## Deferred executable contract and remaining work

The proposed, **unimplemented** contract was:

```text
compileFieldParticleView(rendering, viewExport, nativeInspections)
  -> immutable source-bound definition
projectFieldParticleView(definition, {cameraId, assetGroup, positionY})
  -> {parentTransform, projection, motionSpace.linearInverse}
```

It would derive temporary matrices from the existing shared effect-player
owner; it must not create another persistent actor/transform store. Remaining
requirements include the following:

- Close the actual source RT inversion flag and camera submission path, then
  compare the complete GPU view-projection against executed source instructions.
- Reproduce the actual simulation transform mode, float32 matrix construction
  and cofactor inverse used for gravity; a transpose is not an accepted shortcut.
- Implement strict compiler/native-receipt binding, independent semantic tests,
  source/native check scripts and production host consumption. None was added
  in this stopped workstream.
- Keep live particle state, final size/color, allocation and lifecycle under
  their existing owners. Their independent recovery does not automatically
  admit a complete emitter.
- Preserve the separate GPU raster acceptance boundary from
  `field-particle-rendering.md`; static receipts and instruction probes do not
  establish original-game or GPU visual equivalence.

There is no complete particle admission or gameplay progress claim associated
with this investigation. Further rendering detail is deferred behind the
runnable shared gameplay framework and its batch content interfaces.
