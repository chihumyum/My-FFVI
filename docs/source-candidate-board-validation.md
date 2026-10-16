# Candidate board validation

The complete candidate reader still observes every object's bytes and checks
source inputs, runtime, content hashes, map identities and policy bindings at
entry and exit. Repeated board metadata can reuse successful canonical and hash
calculations within that one open operation.

The private byte validator parses its own lock and each actual payload, rejects
nonfinite numbers, and freezes both graphs before policy evaluation. Memo
arguments must belong to those private parsed graphs or be JSON primitives.
Keys contain the actual subtree's serialized size and SHA256. Claimed hashes,
external object identity, game state, failures and host results are not keys.
The exported mutable board validator retains its existing policy; the public
candidate reader still returns independent mutable clones.

The finite JSON restriction is stricter than the old board-only path for fields
it did not visit. It is not an equivalence claim for arbitrary JavaScript
objects. Object/Array prototype changes and `toJSON` hooks reject. When both
board metadata and a map binding are invalid, the first reported error may
change; both remain rejected.

Independent review rejected the first implementation for accepting inherited
external objects into its memo. The revised implementation passed 10 independent
negative cases and 14 focused checks. Old and revised validation produced equal
results for all 2608 objects (3,777,487,561 bytes) in a frozen source candidate,
including 1298 strict/framework map identity checks. Input, byte, report and
runtime fences were checked before and after. All 2608 validations still ran;
repeated hash calls fell from 1298 to 1 and canonical calls from 2596 to 2.

The full validation loop used 98.253 seconds of CPU before and 43.443 seconds
after; these were separate periods. Six interleaved actual objects measured a
21.36% median CPU reduction, or 18.73% including cold setup. These measurements
describe content preparation, not game speed, browser behavior or story
completion. Original source gates and historical lock versions gain no new
authority from this optimization.
