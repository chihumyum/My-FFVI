const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
export const radians = (v) => (v * Math.PI) / 180;
const directionAngle = { up: 0, right: -90, down: 180, left: 90 };
const channel = {
  AddAirShipRotateChangeTask: "rotation",
  AddAirShipFlightAltitudeChangeTask: "altitude",
  AddAirshipUpDownMoveTask: "upDown",
};
const valueAt = (track, time) =>
  mix(track.from, track.to, clamp((time - track.time) / track.duration));
// Mathf.Sign(0) is +1 in PR, unlike JavaScript's Math.sign.
const sign = (v) => (v < 0 ? -1 : 1);

/** Host-owned PR parallel TaskMachine; no renderer or saved game mutations. */
export class AirshipMotion {
  constructor({ warn = () => {} } = {}) {
    this.warn = warn;
    this.reset();
  }
  reset() {
    this.tracks = [];
    this.moves = [];
    this.started = false;
    this.base = { rotation: 0, altitude: 0, upDown: 0 };
    this.originOffset = { x: 0, y: 0 };
    this.manualRotation = null;
    this.manualTurn = null;
    this.manualDirection = null;
    this.last = null;
  }
  trackAt(key, time) {
    // Old tasks keep running after Start. Parallel list order resolves writers
    // in a frame; a completed newer tween can be overwritten by an older one.
    let result = null,
      written = -Infinity;
    for (const track of this.tracks) {
      if (track.key !== key || time < track.time) continue;
      const at = Math.min(time, track.time + track.duration);
      if (at >= written) {
        result = track;
        written = at;
      }
    }
    return result;
  }
  scalar(key, time, fallback = this.base[key] || 0) {
    const track = this.trackAt(key, time);
    return track ? valueAt(track, time) : fallback;
  }
  start(event, parameters = {}) {
    const time = Number(event.time) || 0;
    if (!this.started && this.manualRotation != null) this.base.rotation = this.manualRotation;
    this.started = true;
    this.manualRotation = null;
    this.manualDirection = null;
    const pending = [];
    for (const { name, i = [], r = [], time: added } of event.tasks || []) {
      const duration = Number(r[0]) || 0,
        key = channel[name];
      // Native coroutines don't assign an endpoint when requiredSec <= 0.
      if (duration <= 0) continue;
      if (key) {
        const from = i[0] === 1 ? Number(r[2]) || 0 : this.scalar(key, added ?? time);
        pending.push({
          key,
          time,
          duration,
          from,
          to: key === "rotation" ? from + (Number(r[1]) || 0) : Number(r[1]) || 0,
        });
      } else if (name === "AddAirShipMoveTask") {
        const seconds = parameters.moveSeconds?.[i[0]];
        if (seconds == null)
          this.warn(
            `move-speed:${i[0]}`,
            `Unknown PR flight speed ${i[0]}; using its default movement interval.`,
          );
        this.moves.push({
          time,
          duration,
          x: Number(r[1]) || 0,
          y: Number(r[2]) || 0,
          speed: (parameters.movementMultiplier ?? 4) / (seconds ?? 0.24),
        });
      } else this.warn(`task:${name}`, `Unknown PR airship task ${name}; source game continues.`);
    }
    this.tracks.push(...pending);
  }
  offsetAt(time) {
    const result = { ...this.originOffset };
    for (const move of this.moves) {
      const end = Math.min(time, move.time + move.duration);
      if (end <= move.time) continue;
      // Integrate the exact linear heading across task boundaries. This is
      // independent of browser FPS and frozen checkpoint sampling order.
      const boundaries = [
        ...new Set([
          move.time,
          end,
          ...this.tracks
            .filter((t) => t.key === "rotation")
            .flatMap((t) => [t.time, t.time + t.duration])
            .filter((t) => t > move.time && t < end),
        ]),
      ].sort((a, b) => a - b);
      for (let n = 1; n < boundaries.length; n++) {
        const a = boundaries[n - 1],
          b = boundaries[n],
          dt = b - a;
        const track = this.trackAt("rotation", (a + b) / 2);
        const first = radians(track ? valueAt(track, a) : this.base.rotation),
          last = radians(track ? valueAt(track, b) : this.base.rotation);
        const delta = last - first;
        const cs =
          Math.abs(delta) < 1e-9
            ? Math.cos(first) * dt
            : ((Math.sin(last) - Math.sin(first)) * dt) / delta;
        const sn =
          Math.abs(delta) < 1e-9
            ? Math.sin(first) * dt
            : ((Math.cos(first) - Math.cos(last)) * dt) / delta;
        result.x += (move.x * cs - move.y * sn) * move.speed;
        // PR world is Y-up, field tile coordinates are Y-down.
        result.y -= (move.x * sn + move.y * cs) * move.speed;
      }
    }
    return result;
  }
  at(time) {
    const active = (key) => {
      const track = this.trackAt(key, time);
      return track && time < track.time + track.duration ? sign(track.to - track.from) : 0;
    };
    return {
      rotation: this.scalar("rotation", time),
      altitude: this.scalar("altitude", time),
      altitudeAuthored: !!this.trackAt("altitude", time),
      upDown: this.scalar("upDown", time),
      turn: active("rotation"),
      climb: active("altitude"),
      offset: this.offsetAt(time),
      active: [...this.tracks, ...this.moves].some(
        (t) => time >= t.time && time < t.time + t.duration,
      ),
    };
  }
  sample(game) {
    const time = Number(game?.time) || 0,
      state = this.at(time),
      angle = directionAngle[game?.player?.direction] || 0;
    if (this.started && !state.active && game?.control !== false && !game?.busy) {
      this.base = { rotation: state.rotation, altitude: state.altitude, upDown: state.upDown };
      this.originOffset = { ...state.offset };
      this.tracks = [];
      this.moves = [];
      this.started = false;
      this.manualRotation = state.rotation;
      this.manualDirection = angle;
      this.manualTurn = { from: state.rotation, to: state.rotation, time, duration: 0.3 };
    }
    if (!this.started) {
      if (this.manualRotation == null || time < this.last) this.manualRotation = angle;
      if (this.manualDirection !== angle) {
        const distance = ((((angle - this.manualRotation) % 360) + 540) % 360) - 180;
        this.manualTurn = {
          from: this.manualRotation,
          to: this.manualRotation + distance,
          time,
          duration: 0.3,
        };
        this.manualDirection = angle;
      }
      this.manualRotation = valueAt(this.manualTurn, time);
      state.rotation = this.manualRotation;
      const distance = this.manualTurn.to - this.manualRotation;
      state.turn = Math.abs(distance) > 1 ? sign(distance) : 0;
    }
    this.last = time;
    return state;
  }
  snapshot() {
    return structuredClone({
      tracks: this.tracks,
      moves: this.moves,
      started: this.started,
      base: this.base,
      originOffset: this.originOffset,
    });
  }
  restore(saved) {
    this.reset();
    if (saved) Object.assign(this, structuredClone(saved));
  }
}

// Native FF6 camera and altitude converters use unclamped endpoint ratios.
export function flightCamera(state, parameters = {}, heightNormalize = 1) {
  const ratio = state.altitude;
  return {
    fov:
      heightNormalize === 1
        ? mix(parameters.fovLow ?? 35, parameters.fovHigh ?? 60, ratio)
        : mix(parameters.fovHigh ?? 60, parameters.fovLow ?? 35, heightNormalize),
    flightAltitude:
      heightNormalize === 1
        ? 60 * mix(parameters.flightRatioLow ?? 0.4, parameters.flightRatioHigh ?? 1.2, ratio)
        : mix(320, 60 * (parameters.flightRatioLow ?? 0.4), heightNormalize),
    pitch: Math.min(82.8, 90 + (parameters.cameraRotateAngle ?? -55) * heightNormalize),
    rotation: state.rotation,
    upDown: state.upDown,
    distance: 180 / Math.tan(radians(30)),
  };
}
export function flightPose(state, parameters) {
  return parameters.poseKeys[1 + (state.climb || 0)][1 - (state.turn || 0)];
}
export function flightShadow(state, parameters, heightNormalize = 1) {
  const frame = Math.min(
    4,
    Math.max(
      1,
      Math.floor(4 * clamp((flightCamera(state, parameters, heightNormalize).fov - 35) / 25)) + 1,
    ),
  );
  return frame;
}

/** Project a native world point to the 320x180 presentation viewport. */
export function projectFlightPoint(point, camera) {
  const pitch = radians(camera.pitch),
    cs = Math.cos(pitch),
    sn = Math.sin(pitch),
    angle = radians(camera.rotation),
    ca = Math.cos(angle),
    sa = Math.sin(angle),
    x = point.x * ca + point.z * sa,
    z = -point.x * sa + point.z * ca,
    y = (point.y || 0) - camera.upDown,
    depth = -y * sn + z * cs + camera.distance,
    focal = 90 / Math.tan(radians(camera.fov) / 2);
  return {
    x: 160 + (x * focal) / depth,
    y: 90 - ((y * cs + z * sn) * focal) / depth,
    scale: focal / depth,
    depth,
    visible: depth > 0.3,
  };
}
