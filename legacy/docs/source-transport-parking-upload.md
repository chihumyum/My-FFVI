# Source transportation parking upload

This shared increment implements the parking upload phase of source transportation Change. It does not implement manual driving, parked-body boarding or landing. The complete source inventory remains 3304 programs/186003 operations, 64 Change calls/49 physical callers, the prior 30 lifecycle calls/25 callers, 6 native callbacks/82 operations and all 283 dependency bodies/26937 operations. Original script bodies and unresolved providers remain intact.

## Evidence and deliberate Web boundary

The original Change body calls SetupCurrentMapping then UploadTransportationData. Upload clones all owned transportation records, applies OverridePositionAndDirection and writes each record through UserDataManager. Five A5 methods/3040 original PE bytes and four A4 methods/1552 bytes were independently checked against complete original DLL ranges, all aliases, next boundaries, typed receiver metadata and the bound symbols/header. A separate approved 160-byte PE check closes OwnedTransportation.SetData and its saved-data copy. Evidence lives in ignored source-nonwalking-transport-entry-contract-review and source-nonwalking-transport-writeback-contract-review; no original game was run.

Override writes a known transportation info's StayMapId first. Only a real MapObject supplies position and direction. Missing info skips the row; known missing body retains the row's pose. The concrete IMapAccessor slot4 uses the same float32 map-local floor conversion as FieldCamera. ConvertEntityPosition preserves actual world Z; the decompiler's float-to-int cast has no corresponding PE conversion instruction. Direction independently ORs positive Y=1, positive X=2, negative Y=4 and negative X=8. SetData copies pose, mapId and timestamp for a matching actual ID, preserving ID and enable. Timestamp is unchanged here because Upload's clone retained it.

The explicit Web registry is rebuilt from the existing GameState records, original release flags and actual Field factory. Its away/disabled records have a known absent Web body. Local enabled records must match a real current Actor/native instance and asset. A missing, duplicate, replaced, moving or unknown instance fails. This is an explicit Web projection; it does not assert native MapObject absence from a missing provider.

## Ownership and transaction

GameState remains the sole persistent owner. Its batch preparation clones all records and validates every observation before publication. A second invalid row cannot commit the first. The Field source Change prepares actual actor replacement/party/current/collision and the parking batch together, validates the live fingerprint, then publishes once. Revision, candidate generation, active Battle lease and Field retirement fences prevent stale writes. No second parking map, cached enable or saved authority is introduced.

Only Change receives this evidenced upload phase. SetVehicle placement, LoseVehicle, SwitchVehicleActive, OnTheVehicle position-copy and NPC ride commands retain their prior owners and semantics. No phase is inferred from an instruction's name. Manual input, nonwalking identity, source landing conditions, terrain/collider/BirdView and unknown callback bodies remain gates.

## Trusted production and saves

`transportationParkingUpload: web-source-transport-parking-upload-v1` requires matching trusted content and runtime declarations plus the existing vehicle/walking-Magitek owners. Profile upgrade v13 binds the compiled provider `fieldTransportationParkingBinding`; profiles v1-v12 retain their exact prior shapes. Source prerequisite input lock v5 adds the marker and the complete compiler-derived transportation catalog hash to the existing v4 lock tuple. The hash is recomputed from all original locked source transportation rows and verified against strict world, initialized builder, candidate and producer/link reports. Old input locks do not grant this capability or silently refresh historical pins.

Storage contains state only. Trusted loaded content and runtime must separately reauthorize restoration. With this policy a saved actual body may retain a stable subcell position whose native floor conversion equals the owned parking cell and whose layer matches. A changed cell, missing body, unsupported direction, moving task or missing authority remains rejected. Old profiles retain exact initial parking pose validation.

## Acceptance scope

Controlled tests exercise the actual source-initialized GameSession, Field/Actor, prepared Battle handoff/retry/return, map publication, single GameState and CheckpointStorage APIs. Pose input is explicitly controlled on an existing real body; it is not proof of manual driving. Source parameter wrappers and complete source-body execution are reported separately. The whole-source audit compares before/current decoders over every raw instruction, rebinds all immutable nominated bodies and keeps every callback and map dependency. Zero decoder changes are expected. No 649-world compilation or publication belongs to this family.
