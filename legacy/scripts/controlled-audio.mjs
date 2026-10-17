/** Explicit headless adapter: resources and output are immediately available.
 * FieldSoundState still owns play handles, duration, fades and SyncSE waits.
 * This does not decode/output audio or establish browser/native audibility. */
export function controlledAudioRuntime() {
  return {
    audioReadiness: { isReady: () => true },
    soundPresentation: { isPresented: () => true },
  };
}
