# Field empty and confirmed missing messages

The compiler restores the native `Msg` empty-lookup branch for Field programs.
It requires the existing complete v2 body/speaker/name/system/etc dictionary
binding. An empty source key or a key absent in that verified static body
namespace produces `field-empty-message-stop`, retaining all original i/r/s
operands. A partial per-map message object cannot establish absence. Nonempty
messages and Battle messages keep their existing compilers and gates.

The complete input contains 4,838 Msg sites. Exactly 51 Field sites change:
11 empty inputs and 40 uses of five keys absent in all 48 original localized
resources. The other 4,787 results, including four non-Field missing rows,
FULL_SPACE, ITEM_N and nonempty window forms, are unchanged. Original bodies,
source identities, 53/2,312 battle instructions and 490 dependencies remain.
This is a static dictionary policy; unknown future dynamic AddMessage owners
are not implemented by an absence assumption.

## Actual Web window readiness

`web-field-message-window-ready-v1` is an explicit Web policy, not a claim that
Unity Integrator.MessageReady has been reconstructed. The genuine runtime
capability requires a live measurement callback. It is not serializable and
has no default true path. Every prepare/validate compares the actual source
message owner, its revision, surface, mounted state and Field generation.
The Field reserves its real SourceMessageState frame and captures its complete
publication fence before entering the opaque host. Query failure, reentrancy,
owner/content mutation or a changed second measurement rejects before window
publication. An already committed manager tick is not rolled back by this.

The App's existing source-message view binds the actual dialogue, speaker,
message and next nodes after initialization, pins their document and IDs,
and checks that all four remain connected and resolve to the same nodes.
It reads the current Flow Session Field on every query. Audio/media readiness
is unrelated. Hidden ordinary dialogue is a valid mounted window. A prepared,
unpublished map or new-game Field cannot claim the outgoing Field's readiness;
it waits at the same source PC until World/Flow publishes it. This waiting
state does not prevent World candidate commit.

Positive headless replay requires a different, explicitly controlled host:

```js
const window = createSourceWebReplayMessageWindowController({
  createAuthority: api.createWebFieldMessageWindowReady,
});
window.mount();
const runtime = { ...sourceWebReplayRuntimePorts({ messageWindow: window }) };
const game = await prepareSession(runtime); // candidate remains unbound
window.publish(game.field);                 // only after real publication
// Before each ordinary tick, synchronize only the currently published getter:
window.publish(game.field);
flow.advance(10, host);
```

The controller creates four private channel attachments, binds the actual
Field/sourceMessage pair and records `controlled-four-channel` / `no-pixels`.
It is not DOM, native readiness or media acceptance. Repeated publication of
that same pair is idempotent. Replaced/unpublished Fields are retired; late
publication cannot take back the surface. Disposal is permanent. Restore
requires an explicitly supplied runtime and a fresh successful publication.
Zero-argument `sourceWebReplayRuntimePorts()` keeps its missing authority.

## Dedicated Stop and transaction boundary

On known not-ready, the VM keeps the same Msg PC with no Core, window or
entity-update-group write. On ready, Stop is prepared in the actual shared
window's frame, clears its value/current ticket, and commits a structured
missing-row warning only for a nonempty missing key. It emits no group effect,
fee effect, PlayMessageCommon or Core projection. It does not reuse MsgClose,
which has a separate group12 behavior. Previous prepared writes/tickets become
stale. Frame discard preserves the real old window and warning journal.

Unknown cross-task native wrapper cancellation is not guessed. If any actual
source message wrapper/finish-wait/timer is still pending, Stop is a specific
hard gate before publication; it never erases that task's Core/timer obligation.
Negative-duration asynchronous or already completed retained windows remain
eligible. Choice/shop/treasure special windows retain their owner gates.

The ordinary Field and Battle use the same SourceMessageState. Existing battle
return owns retirement/reset and rewards; this branch adds neither a second
window nor a return/reward path. A cancelled return leaves that owner intact.
A successful return then permits an ordinary Field Stop once.

## Storage boundary

No checkpoint format is changed and no saved field grants Ready authority.
The transient Stop/warning journal and its runtime authority are not saved.
Native source maps already persist `nativeCheckpoint.updateMask`; a real
source Session verifies group9 remains9 through Stop, event save, Storage and
restore. Stop does not invent group12 to make storage easier.

The legacy non-native codec cannot represent a non-default update mask.
After this new Stop, saving a non-native Field with mask other than3 therefore
fails explicitly. Mask3 still round-trips. Existing MsgClose codec behavior is
unchanged. A general legacy update-mask codec is separate future work.

Acceptance distinguishes 51 independent Sessions using original operands from
original body execution. Full bodies, original story state and source reach
are not established by these controlled callers. Actual App tests execute its
production module and live window helper with controlled DOM/media; they are
not browser-pixel acceptance or a completed source campaign.
