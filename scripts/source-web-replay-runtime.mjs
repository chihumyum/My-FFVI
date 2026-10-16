// These explicit policies are installed by apps/game/app.js.
// A positive Web replay opts in at its own runtime construction; strict/native
// unknown lanes keep their existing missing providers. No state or fallback
// result is supplied, and GameSession remains the only terminal producer.
const messageWindowAuthorities = new WeakMap();
/** Explicit no-pixels host. Mount creates four private channel attachments;
 * only publish() after real Session/World publication binds their actual owner.
 * Candidate construction and old zero-argument callers remain unready. */
export function createSourceWebReplayMessageWindowController({createAuthority} = {}) {
  if (typeof createAuthority !== 'function') throw new Error('Missing compiled Web message readiness factory');
  let channels = null, current = null, owner = null, disposed = false, generation = 0;
  const retired = new WeakSet(), surface = {}, roles = ['dialogue','speaker','message','next'];
  const authority = createAuthority(() => ({kind:'web-field-message-window-surface-v1',surface,
    initialized: !disposed && channels !== null && channels.length === 4 && channels.every((node,index)=>node.role===roles[index]) &&
      current !== null && current.sourceMessage === owner && current.options?.sourceMessageReady === authority,
    owner: disposed ? null : owner, generation: disposed ? null : current}));
  const controller = Object.freeze({
    authority,
    mount() {
      if (disposed || channels !== null) throw new Error('Controlled message surface cannot mount twice or after disposal');
      channels = Object.freeze(roles.map(role => Object.freeze({role}))); return controller;
    },
    publish(field) {
      if (disposed || channels === null) throw new Error('Controlled message surface is not mounted');
      if (!field || typeof field !== 'object' || !field.sourceMessage || field.options?.sourceMessageReady !== authority || retired.has(field))
        throw new Error('Controlled message surface needs its actual current Field owner');
      if (current === field) { if (field.sourceMessage !== owner) throw new Error('Published Field message owner changed'); return; }
      if (current) retired.add(current);
      current = field; owner = field.sourceMessage; generation++;
    },
    unpublish(field) {
      if (disposed || current !== field) throw new Error('Stale controlled message surface publication');
      retired.add(current); current = null; owner = null; generation++;
    },
    dispose() { if (!disposed) { if (current) retired.add(current); disposed = true; channels = null; current = null; owner = null; generation++; } },
    evidence() { return Object.freeze({kind:'controlled-four-channel-field-message-host-v1',mounted:channels!==null,disposed,
      published:current!==null,generation,presentation:'no-pixels',nativeMessageReady:false}); },
  });
  messageWindowAuthorities.set(controller,authority); return controller;
}
export function sourceWebReplayRuntimePorts(options = {}) {
  if (!options || typeof options !== 'object' || Object.keys(options).some(key=>key!=='messageWindow'))
    throw new Error('Unknown source Web replay runtime options');
  const messageWindow = options.messageWindow;
  if (messageWindow !== undefined && !messageWindowAuthorities.has(messageWindow))
    throw new Error('Missing actual controlled message window controller');
  return Object.freeze({
    transportationParkingUpload:'web-source-transport-parking-upload-v1',
    ...(messageWindow === undefined ? {} : {sourceMessageReady:messageWindowAuthorities.get(messageWindow)}),
    vehicleLifecycle:'web-source-vehicle-lifecycle-v1',
    battleChildPartyAdmission:'web-source-child-party-entry-v1',
    battleEventConditions: "web-source-battle-condition-lists-v1",
    battleBranchExecution: 'web-source-battle-branch-execution-v1',
    worldAutoTasks: 'web-flat-world-auto-tasks-v1',
    worldAutoMove: 'web-flat-world-auto-move-v1',
    birdViewActors: 'web-flat-bird-view-actors-v1',
    mobColorFilter: 'web-flat-mob-color-filter-v1',
    screenPresentation:'web-field-screen-presentation-2d-v1',
    fieldEffectTransforms:'web-source-logical-board-transforms-v1',
    sourceSnapshot:'immutable-owned-field-source-v1',
    sourceFieldUi:'web-source-field-ui-v1',
    sourceNonEncounterAreas:'source-non-encounter-areas-v1',
    mapTransforms:'web-flat-field-map-transforms-v1',
    fieldLayerScrolling:'web-field-layer-scrolling-v1',
    skyboxPresentation:'web-flat-skybox-panorama-v1',
    viewChange: 'web-flat-field-view-change-v2',
    battlePeriodicNumbers:'web-source-periodic-numbers-2d-v1',
    battleEventEffects: 'web-source-battle-effects-pulse-v1',
    battleGlobalFade: 'web-source-battle-global-fade-v1',
    sourcePartySelection: 'web-source-party-selection-atomic-v1',
    sourceCharacterNaming:'web-source-character-naming-input-v1',
    rtsPartySwitch:'web-source-rts-party-switch-v1',
    battleEventMessages: 'web-source-battle-event-messages-v1',
    battleEventControls: 'web-source-battle-event-controls-v1',
    sourceBossEntry: 'web-source-boss-entry-v1',
    sourceBattleResult: 'web-committed-battle-result-v1',
    scriptedBattleActions: 'web-source-scripted-battle-actions-v1',
    puppetRoutes: 'web-source-puppet-route-grid-v1',
  });
}

// A content/runtime transform policy alone cannot authorize the separate
// display host. Use the same explicit capability as the app while preserving
// the caller's exact compiled factory and per-session host lifetime.
export function sourceWebReplayFieldEffectsHost(createHost) {
  if (typeof createHost !== 'function') throw new Error('Missing compiled logical field effects factory');
  return createHost({boardTransforms:sourceWebReplayRuntimePorts().fieldEffectTransforms});
}

// Explicit controlled lane: the caller records every exact actual request and
// must label it controlled-request-consumed/no-pixels. No fake Canvas drawing.
// Use this object to override the marker-only positive replay runtime port.
export function sourceWebReplayPeriodicNumberHost(createControlledHost, consume) {
  if (typeof createControlledHost !== 'function' || typeof consume !== 'function')
    throw new Error('Missing explicit controlled periodic-number consumer');
  return createControlledHost(consume);
}
