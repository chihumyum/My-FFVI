import type { SoundVoice } from "./field-sound.js";
import type { AudioTrack } from "./static-audio.js";

/** Read-only host observation. An instance's logical clock cannot consume a
 * short sound before the host has submitted its first output frame. Headless
 * execution must supply an explicit controlled observation, never a callback
 * that writes to the VM. This capability is rebound on restore. */
export type FieldSoundPresentation = {
  isPresented(voice: SoundVoice, track: AudioTrack): boolean;
};
