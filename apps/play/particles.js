import { Container, Sprite, Texture, Rectangle, extensions, SubtractBlend } from "pixi.js";
import { PRMaterialCache } from "./pr-filters.js";

// Pixi exports advanced blend classes without registering them by default.
// Register only the built-in mode used by PR materials, without a plugin.
extensions.add(SubtractBlend);

const TAU = Math.PI * 2;
const clamp = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const mix = (a, b, t) => a + (b - a) * t;
const colorProduct = (a, b) => a.map((value, n) => value * b[n]);
const WHITE = [1, 1, 1, 1];

function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** Unity AnimationCurve: Hermite keys, including weighted Bezier handles. */
export function evaluateKeys(keys, time, fallback = 0) {
  if (!keys?.length) return fallback;
  if (time <= keys[0][0]) return keys[0][1];
  for (let n = 1; n < keys.length; n++) {
    const a = keys[n - 1],
      b = keys[n];
    if (time > b[0]) continue;
    const duration = b[0] - a[0];
    if (!(duration > 0)) return b[1];
    if (a[8] || b[7]) return a[1];
    const t = (time - a[0]) / duration;
    if (a[4] & 2 || b[4] & 1) {
      const outWeight = a[4] & 2 ? a[6] : 1 / 3;
      const inWeight = b[4] & 1 ? b[5] : 1 / 3;
      let lo = 0,
        hi = 1,
        at = t;
      for (let iteration = 0; iteration < 18; iteration++) {
        at = (lo + hi) / 2;
        if (cubic(0, outWeight, 1 - inWeight, 1, at) < t) lo = at;
        else hi = at;
      }
      return cubic(
        a[1],
        a[1] + a[3] * duration * outWeight,
        b[1] - b[2] * duration * inWeight,
        b[1],
        at,
      );
    }
    const t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * a[1] +
      (t3 - 2 * t2 + t) * duration * a[3] +
      (-2 * t3 + 3 * t2) * b[1] +
      (t3 - t2) * duration * b[2]
    );
  }
  return keys.at(-1)[1];
}

export function evaluateCurve(curve, time = 0, random = 0.5, fallback = 0) {
  if (!curve) return fallback;
  if (curve.mode === 1) return evaluateKeys(curve.keys, time, 1) * curve.max;
  if (curve.mode === 2)
    return (
      mix(evaluateKeys(curve.minKeys, time, 1), evaluateKeys(curve.keys, time, 1), random) *
      curve.max
    );
  if (curve.mode === 3) return mix(curve.min, curve.max, random);
  return curve.max ?? fallback;
}

function gradientSample(keys, time) {
  function sample(rows, channels, fallback) {
    if (!rows?.length) return fallback;
    if (keys.fixed) return (rows.findLast((row) => row[0] <= time) || rows[0]).slice(1);
    let a = rows[0],
      b = a;
    for (const row of rows) {
      b = row;
      if (time <= row[0]) break;
      a = row;
    }
    const t = keys.fixed || a[0] === b[0] ? 0 : clamp((time - a[0]) / (b[0] - a[0]));
    return Array.from({ length: channels }, (_, n) => mix(a[n + 1], b[n + 1], t));
  }
  return [...sample(keys?.colors, 3, WHITE.slice(0, 3)), ...sample(keys?.alpha, 1, [1])];
}

export function evaluateGradient(gradient, time = 0, random = 0.5) {
  if (!gradient) return WHITE;
  if (gradient.mode === 1) return gradientSample(gradient.keys, time);
  if (gradient.mode === 2) return gradient.min.map((c, n) => mix(c, gradient.max[n], random));
  if (gradient.mode === 3) {
    const lo = gradientSample(gradient.minKeys, time),
      hi = gradientSample(gradient.keys, time);
    return lo.map((c, n) => mix(c, hi[n], random));
  }
  if (gradient.mode === 4) return gradientSample(gradient.keys, random);
  return gradient.max || WHITE;
}

function randomGenerator(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function fraction(seed, offset = 0) {
  let value = (seed + Math.imul(offset + 1, 0x9e3779b9)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
function matrix(node) {
  const [x, y, z, w] = node.rotation,
    [sx, sy, sz] = node.scale,
    [px, py, pz] = node.position;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y - z * w) * sy,
    2 * (x * z + y * w) * sz,
    px,
    2 * (x * y + z * w) * sx,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z - x * w) * sz,
    py,
    2 * (x * z - y * w) * sx,
    2 * (y * z + x * w) * sy,
    (1 - 2 * (x * x + y * y)) * sz,
    pz,
  ];
}
function multiply(a, b) {
  const out = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++)
      out[row * 4 + col] =
        a[row * 4] * b[col] + a[row * 4 + 1] * b[col + 4] + a[row * 4 + 2] * b[col + 8];
    out[row * 4 + 3] =
      a[row * 4] * b[3] + a[row * 4 + 1] * b[7] + a[row * 4 + 2] * b[11] + a[row * 4 + 3];
  }
  return out;
}
function transform(m, v, translation = true) {
  return [0, 1, 2].map(
    (row) =>
      m[row * 4] * v[0] +
      m[row * 4 + 1] * v[1] +
      m[row * 4 + 2] * v[2] +
      (translation ? m[row * 4 + 3] : 0),
  );
}
function inverseTransform(m, v) {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const [x, y, z] = v.map((value, axis) => value - m[axis * 4 + 3]);
  if (Math.abs(determinant) < 1e-10) {
    const xy = a * e - b * d;
    return Math.abs(xy) < 1e-10 ? [0, 0, 0] : [(e * x - b * y) / xy, (a * y - d * x) / xy, 0];
  }
  return [
    ((e * i - f * h) * x + (c * h - b * i) * y + (b * f - c * e) * z) / determinant,
    ((f * g - d * i) * x + (a * i - c * g) * y + (c * d - a * f) * z) / determinant,
    ((d * h - e * g) * x + (b * g - a * h) * y + (a * e - b * d) * z) / determinant,
  ];
}
function rotate(v, angles) {
  let [x, y, z] = v;
  for (let n = 0; n < 3; n++) {
    const c = Math.cos(angles[n]),
      s = Math.sin(angles[n]);
    if (n === 0) [y, z] = [y * c - z * s, y * s + z * c];
    if (n === 1) [x, z] = [x * c + z * s, -x * s + z * c];
    if (n === 2) [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}
function direction(v, fallback = [0, 0, 1]) {
  const length = Math.hypot(...v);
  return length ? v.map((x) => x / length) : fallback;
}
function shapeSample(shape, random) {
  if (!shape) return { position: [0, 0, 0], direction: [0, 0, 1] };
  const angle = (random() * (shape.arc?.value ?? 360) * Math.PI) / 180;
  const thickness = shape.radiusThickness ?? 1;
  const radius = (shape.radius?.value ?? 1) * Math.sqrt(mix((1 - thickness) ** 2, 1, random()));
  let position = [0, 0, 0],
    vector = [0, 0, 1];
  if ([0, 1, 2, 3, 6, 13, 14, 19, 20].includes(shape.type)) {
    const z = [2, 3].includes(shape.type) ? random() : random() * 2 - 1,
      ring = Math.sqrt(1 - z * z);
    vector = [Math.cos(angle) * ring, Math.sin(angle) * ring, z];
    position = vector.map((v) => v * radius);
  } else if ([4, 7, 8, 9].includes(shape.type)) {
    const tilt = (((shape.angle || 0) * Math.PI) / 180) * Math.sqrt(random());
    vector = [Math.cos(angle) * Math.sin(tilt), Math.sin(angle) * Math.sin(tilt), Math.cos(tilt)];
    position = [
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      [8, 9].includes(shape.type) ? random() * shape.length : 0,
    ];
  } else if ([5, 15, 16, 18].includes(shape.type)) {
    position = [random() - 0.5, random() - 0.5, shape.type === 18 ? 0 : random() - 0.5];
    if ([15, 16].includes(shape.type))
      position[Math.floor(random() * 3)] = random() < 0.5 ? -0.5 : 0.5;
  } else if ([10, 11].includes(shape.type)) {
    position = [Math.cos(angle) * radius, Math.sin(angle) * radius, 0];
    vector = direction(position);
  } else if (shape.type === 12) position = [mix(-radius, radius, random()), 0, 0];
  else if (shape.type === 17) {
    const ring = random() * TAU,
      tube = shape.donutRadius || 0;
    position = [
      Math.cos(angle) * (radius + tube * Math.cos(ring)),
      Math.sin(angle) * (radius + tube * Math.cos(ring)),
      tube * Math.sin(ring),
    ];
    vector = direction([
      Math.cos(angle) * Math.cos(ring),
      Math.sin(angle) * Math.cos(ring),
      Math.sin(ring),
    ]);
  }
  const scale = [shape.m_Scale?.x ?? 1, shape.m_Scale?.y ?? 1, shape.m_Scale?.z ?? 1];
  const angles = [shape.m_Rotation?.x || 0, shape.m_Rotation?.y || 0, shape.m_Rotation?.z || 0].map(
    (v) => (v * Math.PI) / 180,
  );
  position = rotate(
    position.map((v, n) => v * scale[n]),
    angles,
  ).map(
    (v, n) => v + [shape.m_Position?.x || 0, shape.m_Position?.y || 0, shape.m_Position?.z || 0][n],
  );
  vector = rotate(vector, angles);
  if (shape.randomDirectionAmount)
    vector = direction(vector.map((v) => mix(v, random() * 2 - 1, shape.randomDirectionAmount)));
  if (shape.sphericalDirectionAmount)
    vector = direction(
      vector.map((v, n) => mix(v, direction(position)[n], shape.sphericalDirectionAmount)),
    );
  return { position, direction: vector };
}

/** Pure presentation: local RNG, pooled Sprites, no game-state or VM access. */
export class PRParticles {
  constructor({
    container,
    getTexture,
    maxParticles = 4096,
    warn = console.warn,
    renderer = null,
    materials = null,
    diagnostics = null,
  } = {}) {
    if (!container || !getTexture) throw Error("PRParticles requires container and getTexture");
    this.parent = container;
    this.getTexture = getTexture;
    this.maxParticles = maxParticles;
    this.warn = warn;
    this.diagnostics = diagnostics;
    this.catalog = { effects: {}, effectIds: {} };
    this.instances = [];
    this.pool = [];
    this._warned = new Set();
    this._crops = new Map();
    this._created = 0;
    this._live = 0;
    this._serial = 0;
    this._spawned = 0;
    this._particleCount = 0;
    this._time = 0;
    this._frames = 0;
    this._materials =
      materials || (renderer ? new PRMaterialCache({ renderer, getTexture, warn }) : null);
    this._ownsMaterials = !materials;
  }
  setCatalog(catalog) {
    this.catalog = {
      ...this.catalog,
      ...catalog,
      effects: { ...this.catalog.effects, ...catalog.effects },
      effectIds: { ...this.catalog.effectIds, ...catalog.effectIds },
    };
    return this;
  }
  setRenderer(renderer) {
    if (this._materials?.renderer === renderer) return this;
    // Replacing a GPU context must not leave active Sprite/UV views pointing
    // at a destroyed material RenderTexture. Simulation state is preserved.
    for (const instance of this.instances)
      for (const state of instance.systems)
        for (const p of state.particles) {
          if (p.sprite) {
            p.sprite.texture = Texture.EMPTY;
            p.sprite.visible = false;
          }
          for (const trail of p.trail) this._release(trail.sprite);
          p.trail.length = 0;
        }
    this._clearCrops();
    if (this._ownsMaterials) this._materials?.destroy();
    this._materials = renderer
      ? new PRMaterialCache({ renderer, getTexture: this.getTexture, warn: this.warn })
      : null;
    this._ownsMaterials = true;
    return this;
  }
  _warning(key, text) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.warn(`[PR particles] ${text}`);
  }
  play(
    effectId,
    { x = 160, y = 90, mirror = false, scale = 1, duration = null, seed = null } = {},
  ) {
    const mapping = this.catalog.effectIds[String(effectId)];
    const asset = mapping?.asset || effectId,
      fx = this.catalog.effects[asset];
    if (!fx) {
      this.diagnostics?.record("effect-pack-missing", {
        entityId: "effect",
        resource: asset,
        effectId,
      });
      this._warning(
        `missing:${asset}`,
        `Effect ${asset} is not loaded; presentation skipped without touching battle.`,
      );
      return null;
    }
    for (const row of this.catalog.warnings || [])
      if (row.effect === asset && !(this._materials && row.module === "shader"))
        this._warning(
          `${asset}:${row.module}:${row.reason}`,
          `${asset}/${row.system || "root"}: ${row.reason}`,
        );
    const root = new Container({ label: `particles:${asset}`, sortableChildren: true });
    root.position.set(x, y);
    root.scale.set(mirror ? -scale : scale, scale);
    this.parent.addChild(root);
    const transforms = [],
      active = [],
      delays = [];
    for (const node of fx.nodes) {
      const local = matrix(node);
      transforms.push(node.parent === null ? local : multiply(transforms[node.parent], local));
      active.push(node.active && (node.parent === null || active[node.parent]));
      delays.push(
        (node.placement?.delayViewTime || 0) + (node.parent === null ? 0 : delays[node.parent]),
      );
    }
    const random = randomGenerator(seed ?? ++this._serial),
      subTargets = new Set();
    for (const system of fx.systems)
      for (const sub of system.modules.SubModule?.subEmitters || [])
        if (sub.system !== null) subTargets.add(sub.system);
    const systems = fx.systems.map((definition, index) => ({
      definition,
      index,
      particles: [],
      accumulator: 0,
      time: -(delays[definition.node] + evaluateCurve(definition.startDelay, 0, random())),
      automatic: definition.playOnAwake && !subTargets.has(index),
      matrix: transforms[definition.node],
      active: active[definition.node],
      random,
    }));
    let natural = 1.5,
      looping = false;
    for (const s of systems) {
      const d = s.definition;
      natural = Math.max(
        natural,
        Math.max(0, -s.time) +
          (d.duration + Math.max(d.initial.lifetime?.max || 0, d.initial.lifetime?.min || 0)) /
            Math.max(0.01, d.speed || 1),
      );
      looping ||= d.looping;
    }
    if (duration === null && looping)
      this._warning(
        `loop:${asset}`,
        `${asset}: looping presentation is bounded to 10 seconds unless an explicit duration is supplied.`,
      );
    const instance = {
      asset,
      fx,
      root,
      systems,
      transforms,
      active,
      delays,
      random,
      age: 0,
      duration: duration ?? (looping ? 10 : natural),
      staticSprites: [],
      stopped: false,
      origin: [x, y],
      originVelocity: [0, 0, 0],
      originDistance: 0,
    };
    for (const row of fx.sprites || [])
      if (row.enabled && active[row.node]) {
        const sprite = this._take(root);
        sprite.zIndex = row.sortingOrder;
        instance.staticSprites.push({ definition: row, sprite });
      }
    this.instances.push(instance);
    // Prewarm only looped systems, bounded by the source duration rather than
    // creating an unbounded hidden simulation on the rendering thread.
    for (const system of systems)
      if (system.definition.prewarm && system.definition.looping) {
        const steps = Math.min(300, Math.ceil(system.definition.duration * 30));
        for (let n = 0; n < steps; n++) this._stepSystem(instance, system, 1 / 30);
      }
    this._step(instance, 0);
    return instance;
  }
  event(event) {
    if (event.kind !== "battle-effect") return null;
    return this.play(event.effectId ?? event.asset, event);
  }
  _take(parent) {
    const sprite =
      this.pool.pop() ||
      (() => {
        this._created++;
        return new Sprite({ texture: Texture.EMPTY, roundPixels: true });
      })();
    sprite.visible = true;
    sprite.alpha = 1;
    sprite.tint = 0xffffff;
    sprite.rotation = 0;
    sprite.anchor.set(0.5);
    sprite.scale.set(1);
    sprite.blendMode = "normal";
    parent.addChild(sprite);
    this._live++;
    return sprite;
  }
  _release(sprite) {
    sprite.removeFromParent();
    sprite.texture = Texture.EMPTY;
    sprite.visible = false;
    this.pool.push(sprite);
    this._live--;
  }
  _spawn(instance, state, count, inherited = null, depth = 0) {
    const d = state.definition;
    if (!state.active) return;
    if (depth > 4) {
      this._warning(
        `sub-depth:${instance.asset}`,
        `${instance.asset}: recursive sub-emitter depth exceeds four; further visual children skipped.`,
      );
      return;
    }
    count = Math.max(0, Math.floor(count));
    const available = Math.min(
      (d.initial.maxParticles ?? 1000) - state.particles.length,
      this.maxParticles - this._live,
      this.maxParticles - this._particleCount,
    );
    if (count > available)
      this._warning(
        `budget:${instance.asset}`,
        `${instance.asset}: particle budget reached (${this.maxParticles} global, ${d.initial.maxParticles} for ${d.name}); additional visual particles skipped.`,
      );
    for (let n = 0; n < Math.min(count, available); n++) {
      const random = state.random,
        seed = Math.floor(random() * 4294967296),
        initial = d.initial;
      const sample = shapeSample(d.modules.ShapeModule, random);
      let position = sample.position,
        velocity = sample.direction.map((v) => v * evaluateCurve(initial.speed, 0, random()));
      if (!d.space) {
        position = transform(state.matrix, position);
        velocity = transform(state.matrix, velocity, false);
      }
      if (inherited?.worldPosition)
        position = d.space
          ? inverseTransform(state.matrix, inherited.worldPosition)
          : inherited.worldPosition.slice();
      const inheritVelocity = d.modules.InheritVelocityModule;
      if (inheritVelocity?.m_Mode === 0) {
        const amount = evaluateCurve(inheritVelocity.m_Curve, 0, random());
        velocity = velocity.map((v, axis) => v + instance.originVelocity[axis] * amount);
      }
      const size = evaluateCurve(initial.size, 0, random(), 1);
      const particle = {
        seed,
        position,
        velocity,
        age: 0,
        lifetime: Math.max(0.001, evaluateCurve(initial.lifetime, 0, random(), 5)),
        size: [size, initial.size3D ? evaluateCurve(initial.sizeY, 0, random(), size) : size],
        rotation:
          evaluateCurve(initial.rotation, 0, random()) * (random() < initial.rotationFlip ? -1 : 1),
        color: evaluateGradient(initial.color, 0, random()),
        sprite: null,
        trail: [],
        distance: 0,
        previousPosition: position.slice(),
      };
      if (inherited?.properties & 1) particle.color = colorProduct(particle.color, inherited.color);
      if (inherited?.properties & 2)
        particle.size = particle.size.map((v, axis) => v * inherited.size[axis]);
      if (inherited?.properties & 4) particle.rotation += inherited.rotation;
      if (inherited?.properties & 8) particle.lifetime *= inherited.lifetime;
      if (d.renderer.enabled && (d.renderer.mode !== 5 || d.modules.TrailModule)) {
        particle.sprite = this._take(instance.root);
        particle.sprite.zIndex = d.renderer.sortingOrder;
        particle.sprite.anchor.set(0.5 - d.renderer.pivot[0], 0.5 + d.renderer.pivot[1]);
      }
      state.particles.push(particle);
      this._particleCount++;
      this._spawned++;
      this._sub(instance, state, particle, 0, depth + 1);
    }
  }
  _sub(instance, state, particle, type, depth = 0) {
    for (const sub of state.definition.modules.SubModule?.subEmitters || []) {
      if (sub.type !== type || sub.system === null || state.random() > sub.probability) continue;
      const child = instance.systems[sub.system];
      if (!child) continue;
      const burst = child.definition.modules.EmissionModule?.m_Bursts?.[0];
      const count = burst ? evaluateCurve(burst.countCurve, 0, state.random(), 1) : 1;
      this._spawn(
        instance,
        child,
        count,
        {
          ...particle,
          worldPosition: state.definition.space
            ? transform(state.matrix, particle.position)
            : particle.position,
          properties: sub.properties,
        },
        depth,
      );
    }
  }
  _emit(instance, state, previous, now) {
    const d = state.definition,
      emission = d.modules.EmissionModule;
    if (!state.automatic || !emission || now < 0 || (!d.looping && previous >= d.duration)) return;
    const start = Math.max(0, previous),
      stop = d.looping ? now : Math.min(now, d.duration);
    const life = Math.max(0.001, d.duration),
      normalized = (now % life) / life;
    state.accumulator +=
      Math.max(0, stop - start) *
      Math.max(0, evaluateCurve(emission.rateOverTime, normalized, 0.5));
    state.accumulator +=
      instance.originDistance *
      Math.max(0, evaluateCurve(emission.rateOverDistance, normalized, 0.5));
    const count = Math.floor(state.accumulator);
    state.accumulator -= count;
    this._spawn(instance, state, count);
    for (let cycle = Math.floor(start / life); cycle <= Math.floor(stop / life); cycle++) {
      if (!d.looping && cycle > 0) break;
      for (const burst of emission.m_Bursts || []) {
        const repeats =
          burst.cycleCount || Math.max(1, Math.ceil(life / Math.max(0.01, burst.repeatInterval)));
        for (let n = 0; n < repeats; n++) {
          const at = cycle * life + burst.time + n * burst.repeatInterval;
          if (at >= cycle * life + life || at > stop) break;
          if (
            at >= 0 &&
            (at > previous || (previous === 0 && at === 0 && !state.started)) &&
            state.random() <= burst.probability
          )
            this._spawn(
              instance,
              state,
              evaluateCurve(burst.countCurve, normalized, state.random()),
            );
        }
      }
    }
    state.started = true;
  }
  _stepSystem(instance, state, dt) {
    const d = state.definition,
      modules = d.modules,
      step = dt * (d.speed ?? 1),
      previous = state.time;
    state.time += step;
    if (state.active) this._emit(instance, state, previous, state.time);
    for (let n = state.particles.length - 1; n >= 0; n--) {
      const p = state.particles[n];
      p.age += step;
      if (p.age >= p.lifetime) {
        this._sub(instance, state, p, 2);
        if (p.sprite) this._release(p.sprite);
        for (const trail of p.trail) this._release(trail.sprite);
        state.particles.splice(n, 1);
        this._particleCount--;
        continue;
      }
      const t = clamp(p.age / p.lifetime),
        sample = (curve, offset = 0, fallback = 0) =>
          evaluateCurve(curve, t, fraction(p.seed, offset), fallback);
      const force = modules.ForceModule;
      const gravity = evaluateCurve(d.initial.gravity, t, fraction(p.seed, 11));
      p.velocity[1] -= gravity * 9.81 * step;
      if (force) {
        let f = [sample(force.x, 1), sample(force.y, 2), sample(force.z, 3)];
        if (!force.inWorldSpace && !d.space) f = transform(state.matrix, f, false);
        p.velocity = p.velocity.map((v, axis) => v + f[axis] * step);
      }
      let velocity = p.velocity.slice();
      const inheritVelocity = modules.InheritVelocityModule;
      if (inheritVelocity?.m_Mode === 1) {
        const amount = sample(inheritVelocity.m_Curve, 16);
        velocity = velocity.map((v, axis) => v + instance.originVelocity[axis] * amount);
      }
      const vm = modules.VelocityModule;
      if (vm) {
        let extra = [sample(vm.x, 4), sample(vm.y, 5), sample(vm.z, 6)];
        if (!vm.inWorldSpace && !d.space) extra = transform(state.matrix, extra, false);
        const radial = direction(p.position),
          radialSpeed = sample(vm.radial, 7);
        velocity = velocity.map(
          (v, axis) =>
            (v + extra[axis] + radial[axis] * radialSpeed) * sample(vm.speedModifier, 8, 1),
        );
        const orbital = [sample(vm.orbitalX), sample(vm.orbitalY), sample(vm.orbitalZ)].map(
          (v) => v * step,
        );
        if (orbital.some(Boolean)) p.position = rotate(p.position, orbital);
      }
      const limit = modules.ClampVelocityModule;
      if (limit) {
        const speed = Math.hypot(...velocity),
          cap = Math.max(0, sample(limit.magnitude, 8, Infinity)),
          damp = 1 - (1 - clamp(limit.dampen)) ** (step * 60);
        if (limit.separateAxis)
          velocity = velocity.map((v, axis) =>
            mix(
              v,
              clamp(
                v,
                -Math.abs(sample(limit[["x", "y", "z"][axis]], axis)),
                Math.abs(sample(limit[["x", "y", "z"][axis]], axis)),
              ),
              damp,
            ),
          );
        else if (speed > cap && speed > 0)
          velocity = velocity.map((v) => v * mix(1, cap / speed, damp));
        const drag = Math.exp(-Math.max(0, sample(limit.drag)) * step);
        velocity = velocity.map((v) => v * drag);
      }
      const noise = modules.NoiseModule;
      if (noise) {
        const phase = fraction(p.seed, 31) * TAU + p.age * (noise.frequency || 0.5) * TAU;
        velocity[0] += Math.sin(phase) * sample(noise.strength, 19);
        velocity[1] +=
          Math.cos(phase * 1.173) *
          sample(noise.separateAxes ? noise.strengthY : noise.strength, 20);
      }
      p.position = p.position.map((v, axis) => v + velocity[axis] * step);
      const rotation = modules.RotationModule;
      if (rotation) p.rotation += sample(rotation.curve, 9) * step;
      if (modules.RotationBySpeedModule) {
        const r = modules.RotationBySpeedModule,
          range = r.range || { x: 0, y: 1 },
          speedT = clamp((Math.hypot(...velocity) - range.x) / Math.max(0.001, range.y - range.x));
        p.rotation += evaluateCurve(r.curve, speedT, fraction(p.seed, 9)) * step;
      }
      this._draw(instance, state, p, velocity);
    }
  }
  _texture(image, uv, particle, state, materialTexture = undefined, details = {}) {
    const t = clamp(particle.age / particle.lifetime);
    if (uv?.mode === 1 && uv.sprites?.length) {
      const count = uv.sprites.length;
      let animation;
      if (uv.timeMode === 2) animation = (particle.age * uv.fps) / count;
      else if (uv.timeMode === 1) {
        const range = uv.speedRange || { x: 0, y: 1 };
        animation = clamp(
          (Math.hypot(...particle.velocity) - range.x) / Math.max(0.001, range.y - range.x),
        );
      } else
        animation =
          evaluateCurve(uv.frameOverTime, t, fraction(particle.seed, 5)) * (uv.cycles ?? 1);
      const at = Math.floor(
        (evaluateCurve(uv.startFrame, 0, fraction(particle.seed, 4)) + animation) * count,
      );
      return this.getTexture(uv.sprites[((at % count) + count) % count]?.url, {
        ...details,
        required: true,
      });
    }
    if (materialTexture === null) return null;
    if (!image && materialTexture === undefined) {
      this.diagnostics?.record("effect-texture-fallback", {
        ...details,
        resource: "Unity/white",
        reason: "No _MainTex assigned; rendering an untextured particle with Texture.WHITE",
      });
      return Texture.WHITE;
    }
    // Calling the shared texture accessor each frame also pins atlas pages in
    // the renderer LRU. Null is a pending load, never a shared texture mutation.
    const texture =
      materialTexture === undefined
        ? this.getTexture(image.url, { ...details, required: true })
        : materialTexture;
    if (!texture) return null;
    if (!uv) return texture;
    const cols = Math.max(1, uv.tilesX || 1),
      rows = Math.max(1, uv.tilesY || 1),
      singleRow = uv.animationType === 1,
      frames = singleRow ? cols : cols * rows;
    const base = evaluateCurve(uv.startFrame, 0, fraction(particle.seed, 4));
    let animation;
    if (uv.timeMode === 2) animation = (particle.age * uv.fps) / frames;
    else if (uv.timeMode === 1) {
      const range = uv.speedRange || { x: 0, y: 1 };
      animation = clamp(
        (Math.hypot(...particle.velocity) - range.x) / Math.max(0.001, range.y - range.x),
      );
    } else
      animation = evaluateCurve(uv.frameOverTime, t, fraction(particle.seed, 5)) * (uv.cycles || 1);
    let frame = ((Math.floor((base + animation) * frames) % frames) + frames) % frames;
    if (singleRow)
      frame +=
        (uv.rowMode === 1 ? Math.floor(fraction(particle.seed, 6) * rows) : uv.rowIndex || 0) *
        cols;
    const width = texture.frame.width / cols,
      height = texture.frame.height / rows;
    const x = texture.frame.x + (frame % cols) * width,
      y = texture.frame.y + Math.floor(frame / cols) * height;
    let cache = this._crops.get(texture);
    if (!cache) {
      cache = new Map();
      this._crops.set(texture, cache);
    }
    cache.lastUsed = this._time;
    const key = `${cols}:${rows}:${frame}`;
    if (!cache.has(key))
      cache.set(
        key,
        new Texture({ source: texture.source, frame: new Rectangle(x, y, width, height) }),
      );
    return cache.get(key);
  }
  _draw(instance, state, p, velocity) {
    const d = state.definition,
      t = clamp(p.age / p.lifetime),
      material =
        instance.fx.materials[
          d.renderer.mode === 5
            ? d.renderer.trailMaterial || d.renderer.material
            : d.renderer.material
        ],
      uv = d.modules.UVModule;
    const processed = Boolean(
      this._materials && uv?.mode !== 1 && this._materials.handles(material),
    );
    const materialTexture = processed ? this._materials.get(material, this._time) : undefined;
    if (
      !this._materials &&
      material &&
      ["_UseMask", "_Dissolve", "_UseGradient"].some((key) => material.floats?.[key])
    )
      this._warning(
        "material-renderer",
        "Pixi renderer was not supplied; mask/dissolve/gradient preprocessing is unavailable, using explicit Sprite approximation.",
      );
    if (this._materials && uv?.mode === 1 && this._materials.handles(material))
      this._warning(
        `sprite-material:${instance.asset}`,
        `${instance.asset}: Sprite-list animation uses direct frames and Sprite tint; material preprocessing is not applied to these frames.`,
      );
    const texture = this._texture(material?.textures._MainTex, uv, p, state, materialTexture, {
      entityId: `effect:${instance.asset}:system:${state.index}`,
      asset: instance.asset,
      animation: d.name || String(state.index),
    });
    const position = d.space ? transform(state.matrix, p.position) : p.position;
    if (!p.sprite) return;
    p.sprite.visible = Boolean(texture) && d.renderer.mode !== 5;
    if (!texture) return;
    p.sprite.texture = texture;
    const sizeModule = d.modules.SizeModule,
      colorModule = d.modules.ColorModule;
    const sx = evaluateCurve(sizeModule?.curve, t, fraction(p.seed, 12), 1),
      sy = sizeModule?.separateAxes ? evaluateCurve(sizeModule.y, t, fraction(p.seed, 13), 1) : sx;
    const m = state.matrix,
      scaleX = Math.hypot(m[0], m[4], m[8]),
      scaleY = Math.hypot(m[1], m[5], m[9]);
    const color = colorProduct(
      colorProduct(p.color, evaluateGradient(colorModule?.gradient, t, fraction(p.seed, 14))),
      processed ? WHITE : material?.color || WHITE,
    );
    if (!processed && material?.floats._UseGradient && material.colors._GradientWhiteColor)
      for (let n = 0; n < 3; n++) color[n] *= material.colors._GradientWhiteColor[n];
    p.sprite.tint =
      (Math.round(clamp(color[0]) * 255) << 16) |
      (Math.round(clamp(color[1]) * 255) << 8) |
      Math.round(clamp(color[2]) * 255);
    p.sprite.alpha = clamp(color[3]);
    p.sprite.blendMode = material?.blendMode || "normal";
    p.sprite.position.set(position[0], -position[1]);
    let width = Math.abs(p.size[0] * sx * scaleX),
      height = Math.abs(p.size[1] * sy * scaleY);
    if (d.renderer.mode === 1) {
      height = Math.max(
        height,
        height * (d.renderer.lengthScale || 1) +
          Math.hypot(...velocity) * (d.renderer.velocityScale || 0),
      );
      p.sprite.rotation = Math.atan2(-velocity[1], velocity[0]) + Math.PI / 2 - p.rotation;
    } else p.sprite.rotation = -p.rotation - Math.atan2(m[4], m[0]);
    p.sprite.scale.set(Math.abs(p.sprite.scale.x), Math.abs(p.sprite.scale.y));
    p.sprite.width = width;
    p.sprite.height = height;
    if (d.renderer.flip[0] > fraction(p.seed, 1)) p.sprite.scale.x *= -1;
    if (d.renderer.flip[1] > fraction(p.seed, 2)) p.sprite.scale.y *= -1;
    const trail = d.modules.TrailModule;
    if (trail && this._live < this.maxParticles && fraction(p.seed, 25) <= trail.ratio) {
      p.distance += Math.hypot(...p.position.map((v, n) => v - p.previousPosition[n]));
      if (p.distance >= Math.max(1, trail.minVertexDistance)) {
        const ghost = this._take(instance.root);
        ghost.texture = texture;
        ghost.position.copyFrom(p.sprite.position);
        ghost.rotation = p.sprite.rotation;
        ghost.width = width;
        ghost.height = height;
        ghost.tint = p.sprite.tint;
        ghost.blendMode = p.sprite.blendMode;
        ghost.zIndex = p.sprite.zIndex - 1;
        p.trail.push({
          sprite: ghost,
          age: 0,
          lifetime: Math.max(0.01, evaluateCurve(trail.lifetime, t, fraction(p.seed, 26))),
          alpha: p.sprite.alpha,
        });
        p.distance = 0;
      }
    }
    p.previousPosition = p.position.slice();
  }
  _step(instance, dt) {
    instance.age += dt;
    const position = [instance.root.x, instance.root.y];
    instance.originVelocity = dt
      ? [(position[0] - instance.origin[0]) / dt, -(position[1] - instance.origin[1]) / dt, 0]
      : [0, 0, 0];
    instance.originDistance = Math.hypot(
      position[0] - instance.origin[0],
      position[1] - instance.origin[1],
    );
    instance.origin = position;
    for (const state of instance.systems) {
      this._stepSystem(instance, state, dt);
      for (const p of state.particles)
        for (let n = p.trail.length - 1; n >= 0; n--) {
          const trail = p.trail[n];
          trail.age += dt;
          if (trail.age >= trail.lifetime) {
            this._release(trail.sprite);
            p.trail.splice(n, 1);
          } else trail.sprite.alpha = trail.alpha * (1 - trail.age / trail.lifetime);
        }
    }
    for (const { definition: row, sprite } of instance.staticSprites) {
      const texture = this.getTexture(row.texture?.url, {
        required: true,
        entityId: `effect:${instance.asset}:node:${row.node}`,
        asset: instance.asset,
        animation: "static-sprite",
      });
      sprite.visible = Boolean(texture) && instance.age >= instance.delays[row.node];
      if (!texture) continue;
      const m = instance.transforms[row.node],
        position = transform(m, [0, 0, 0]);
      sprite.texture = texture;
      sprite.position.set(position[0], -position[1]);
      sprite.rotation = -Math.atan2(m[4], m[0]);
      sprite.scale.set(Math.abs(sprite.scale.x), Math.abs(sprite.scale.y));
      sprite.width = row.texture.width * Math.hypot(m[0], m[4], m[8]);
      sprite.height = row.texture.height * Math.hypot(m[1], m[5], m[9]);
      sprite.tint =
        (Math.round(clamp(row.color[0]) * 255) << 16) |
        (Math.round(clamp(row.color[1]) * 255) << 8) |
        Math.round(clamp(row.color[2]) * 255);
      sprite.alpha = clamp(row.color[3]);
      if (row.flipX) sprite.scale.x *= -1;
      if (row.flipY) sprite.scale.y *= -1;
    }
  }
  update(dtSeconds) {
    if (!(dtSeconds >= 0) || !Number.isFinite(dtSeconds)) return;
    if (dtSeconds > 1)
      this._warning(
        "time-step",
        "Long presentation frame is limited to one second of particle simulation.",
      );
    const dt = Math.min(dtSeconds, 1),
      steps = Math.max(1, Math.ceil(dt * 30));
    this._time += dt;
    this._frames++;
    this._materials?.beginFrame?.(this._time);
    for (let n = 0; n < steps; n++)
      for (let i = this.instances.length - 1; i >= 0; i--) {
        const instance = this.instances[i];
        this._step(instance, dt / steps);
        if (instance.stopped || instance.age >= instance.duration) this.stop(instance);
      }
    if (!this.instances.length) this._clearCrops();
    else if (this._frames % 120 === 0)
      for (const [base, cache] of this._crops) {
        if (cache.lastUsed >= this._time - 3) continue;
        for (const texture of cache.values()) texture.destroy(false);
        this._crops.delete(base);
      }
    this._materials?.prune(this._time);
  }
  stop(instance) {
    const index = this.instances.indexOf(instance);
    if (index === -1) return;
    for (const state of instance.systems)
      for (const p of state.particles) {
        this._particleCount--;
        if (p.sprite) this._release(p.sprite);
        for (const trail of p.trail) this._release(trail.sprite);
      }
    for (const row of instance.staticSprites) this._release(row.sprite);
    instance.root.destroy({ children: false });
    this.instances.splice(index, 1);
  }
  _clearCrops() {
    for (const cache of this._crops.values())
      for (const texture of cache.values()) texture.destroy(false);
    this._crops.clear();
  }
  clear() {
    for (const instance of [...this.instances]) this.stop(instance);
    this._clearCrops();
    if (this._ownsMaterials) this._materials?.clear();
  }
  destroy() {
    this.clear();
    for (const sprite of this.pool) sprite.destroy();
    if (this._ownsMaterials) this._materials?.destroy();
    this.pool.length = 0;
  }
  metrics() {
    return {
      effects: this.instances.length,
      liveSprites: this._live,
      pooledSprites: this.pool.length,
      createdSprites: this._created,
      spawnedParticles: this._spawned,
      liveParticles: this._particleCount,
      warnings: this._warned.size,
      croppedTextures: [...this._crops.values()].reduce((n, cache) => n + cache.size, 0),
      materials: this._materials?.metrics() || null,
    };
  }
}
