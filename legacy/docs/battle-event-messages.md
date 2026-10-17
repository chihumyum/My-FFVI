# Source battle-event messages

This lane compiles the complete BattleScript/CommonBattleScript Msg and
MsgClose family. It does not route those programs through the field decoder,
turn unsupported instructions into logs, or grant a source program because its
messages decode. The inventory retains every physical program, raw instruction,
source PC, source hash, local bank, blocker and source party/AI dependency. The
parameter envelopes and complete-body attempts have separate denominators.

`web-source-battle-event-messages-v1` is an explicit GameSession runtime host
policy, installed by the app and `sourceWebReplayRuntimePorts`. Source catalogs
carry the typed text and physical localization/name-table binding, without a new
owned roster, global name dictionary, mutable fee owner or saved capability.
Window 0 retains Field style, 1 Battle/left and 2 Battle/right. The existing Web
DOM renders all text and explicit pages, including long scrolling pages. Native
speaker assets, font layout and default Battle text-anchor adjustments are not
certified. Other window forms and unproved system-message routing remain gates.

The actual current `FieldGame.sourceMessage` remains the only message manager.
BattleGame receives it from the Session, with the existing owned-name projection
and explicit message-sequence context. It holds only VM wrapper tickets/cursors
and presentation metadata. The same Field entity-update-mask owner consumes
message group 8 and close group 12; an unknown custom effects host cannot be
silently omitted. Pure frame forks are private transaction candidates. A failed
VM/action/provider frame discards them and rolls back battle queues, conditions,
resources, PC, clock and RNG. The actual manager revision and window tickets are
monotonic; a frame commit never restores an old snapshot or ticket.

A message-bearing root starts on its first admitted battle tick. Constructing a
media candidate does not publish a window. Web ordering is a 10 ms shared-manager
update followed by the existing battle VM/action clock. Msg does not implicitly
pause battle progression. Source BattlePause and Flow visibility/readiness/
overlays retain their existing gates. Negative Msg publishes once and continues;
zero/positive Msg waits on that exact ticket and existing page/timing protocol.
Only real confirmation input, explicit source automatic timing or MsgClose moves
the manager. The VM never calls a fabricated confirm to finish a program.

Media failure and cancelled retry/return preserve the outgoing manager/window.
Only a successful retry/return publication explicitly retires the Web battle
scene window and restores the Field mask. This retirement is not a claim of
native message completion. Old Battle instances and prepared old writes cannot
confirm, advance or close a later battle's window. A new battle cannot steal a
pre-existing field window. Terminal text may continue its manager delta on the
same admitted Session clock; battle actions and battle logical time stay ended.
Active battles/windows still block stable saves. After successful return, the
existing CheckpointStorage/Session restoration resumes stable Field state and
does not replay a battle initializer or message.

Run the maintained tools with one exact compiled generation:

```sh
node scripts/check-battle-event-message-native.mjs
node scripts/inspect-battle-event-messages.mjs --compiled /absolute/private/dist
node scripts/check-battle-event-messages.mjs --compiled /absolute/private/dist --smoke one --report build/reports/message-smoke-one/check.json
node scripts/check-battle-event-messages.mjs --compiled /absolute/private/dist --smoke all --report build/reports/message-smoke-all/check.json
node scripts/compile-source-candidates.mjs --compiled-dir /absolute/private/dist --output build/source-candidate
node scripts/check-battle-event-messages.mjs --compiled /absolute/private/dist --candidate-dir build/source-candidate
```

The source checker uses the shared candidate reader's runtime, input-lock and
whole-object validation at both ends. Previous game catalog bytes are only
locked compatibility/owned-state comparison inputs; current battle/common/text
content comes from the current pure raw-source compile. No public collection is
read by this private workflow. The controlled caller/input trace is declared,
not original contact or campaign reachability. Unknown source instructions,
missing names and missing original party capabilities remain in the report.

The older field-message/native audits retain their own historical admission
limits. Their static receipts establish the common WindowParams/Client/Manager
chain; they are not a dynamic run of the supplied Windows game. Native general
register projection for this battle wrapper is not certified by the Web cursor.
