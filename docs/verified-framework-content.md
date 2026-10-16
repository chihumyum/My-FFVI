# Verified immutable framework definitions

This explicit entry is for the common source observer. The existing mutable
compiler and Session factories still capture their inputs before awaiting and
verify every payload on each call. The app and save schemas do not opt in.

`captureVerifiedContent` synchronously takes an independent R2 JSON-domain copy,
freezes that private copy, and verifies its complete payload digest. Only then
can the module create a document with its real private brand. The creation key,
class and prototype are not writable through a returned cap's constructor.
Plain/null-prototype data and arrays remain legal; mutable internal-slot values,
accessors, functions and cycles do not. Callers are never frozen. A claimed hash,
external identity, JSON marker, checkpoint, forged prototype/Proxy or cap from
another module instance cannot replace capture and verification.

`compileFrameworkNewGameFromVerified` reads six genuine document caps. Every
tuple still checks the original source/profile/provenance/factory/initializer
and owned-catalog bindings and derives the same FrameworkNewGame document. New
caller operands and battle programs still produce and verify new documents.

`GameSession.prepareFrameworkNewGameFromVerified` accepts four genuine caps and
requires the existing `immutable-owned-field-source-v1` runtime mode. It still
verifies the actual initializer digest and all framework bindings per call,
captures runtime/fade before awaiting, and creates fresh owned state, events,
Session, World/Field, actors, leases, clocks, RNG and initializer execution. R2
World/Field snapshot construction and host/publication validation are unchanged.
Each Field top-level content and lifecycle identity remains independent. Only
deeply readonly source definitions are shared; no host, live state, action,
initializer result or checkpoint is cached.

The observer owns the caps for one fixed experiment generation. Its cache keys
are exclusively its own frozen definitions, never outside mutable objects or
headers. Failure is not cached. All 222 parameter records, 53 complete programs
and 490 original requests retain their existing per-row checks and execution.
Whole source/candidate/policy/media fences remain at both ends. Storage and
restore still use actual current content; a save cannot grant this capability.

Preparation cost, actual loop cost, cold admission and the final whole-object
fence must be reported separately. Controlled cross-generation candidate tuples
are mechanism evidence, not same-runtime source-candidate or story acceptance.
