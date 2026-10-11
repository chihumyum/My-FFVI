// Controlled Canvas draw contracts using the unchanged production Renderer and
// real FieldGame/camera owners. No browser state, raster pixels or native oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist"),
  load = (file) => import(pathToFileURL(resolve(compiled, file)).href),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  output = resolve(root, "build/reports/field-camera-ui-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(output, { force: true });

// Resolve the browser's module URL prefix to the selected compiled runtime.
// This is a loader adapter only; production renderer source is not rewritten.
const hook = registerHooks({
  resolve(specifier, context, next) {
    return next(
      specifier.startsWith("/runtime/")
        ? pathToFileURL(resolve(compiled, "src", specifier.slice(9))).href
        : specifier,
      context,
    );
  },
});
let Renderer;
try {
  ({ Renderer } = await import("../apps/game/renderer.js"));
} finally {
  hook.deregister();
}
const [{ FieldGame }, { EventState }, { decodeFieldOp }] = await Promise.all([
  load("src/core/field.js"),
  load("src/core/event-state.js"),
  load("src/compiler/field.js"),
]);

const source = { file: "synthetic", assetPath: "camera-canvas-contract" },
  sourceHash = "1".repeat(64),
  at = (op, index = 0) => ({ ...op, script: "main", index, source }),
  exit = { kind: "exit" },
  raw = (mnemonic, ints, reals = []) => ({
    type: 2,
    mnemonic,
    operands: {
      iValues: [...ints, ...Array(8 - ints.length).fill(0)],
      rValues: [...reals, ...Array(8 - reals.length).fill(0)],
      sValues: Array(8).fill(""),
    },
  }),
  position = (x, y) => decodeFieldOp(raw("SetPos", [x, y]), at({}), {}),
  lerp = (x, y, seconds) =>
    decodeFieldOp(raw("Lerp", [x, y], [seconds]), at({}), {});
const character = {
  source,
  sprites: {
    pose: {
      file: "synthetic-player.png",
      width: 16,
      height: 16,
      pivot: [0.5, 0],
      sha256: sourceHash,
      source,
    },
  },
  animations: Object.fromEntries(
    ["Default", "WalkB", "WalkL", "WalkR"].map((key) => [
      key,
      {
        frames: [{ sprite: "pose", x: 0, y: 0, flip: false, alpha: 1 }],
        duration: 1,
        mode: 0,
        flip: false,
        next: "",
      },
    ]),
  ),
};
function content(ops, options = {}) {
  const width = options.width ?? 40,
    height = options.height ?? 40,
    range = options.range ?? { x: 0, y: 0, width, height };
  return {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    contentHash: "synthetic",
    ...(options.legacy
      ? {}
      : {
          cameraHost: {
            kind: "source-field-camera-host-v1",
            mapRange: range,
            loop: { horizontal: false, vertical: false },
            playerVisualOffset: { x: 0, y: -6 },
            callbacks: "fresh-normal-field-v1",
            sources: [
              { file: "synthetic-native", sha256: sourceHash },
              { file: "synthetic-prefab", sha256: "2".repeat(64) },
            ],
          },
        }),
    characters: { player: structuredClone(character) },
    limitations: [],
    map: {
      id: "synthetic-camera-canvas",
      identity: { mapId: 1, areaId: 1 },
      width,
      height,
      tileSize: 16,
      collisions: { 1: Array(width * height).fill(0) },
      // Unique source rectangles make every tile identifiable in real draws.
      layers: [
        {
          name: "GroundLayer",
          width,
          height,
          opacity: 1,
          data: Array.from({ length: width * height }, (_, index) => index + 1),
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          image: "synthetic-atlas",
          columns: width,
          tilewidth: 16,
          tileheight: 16,
          tilecount: width * height,
        },
      ],
      textures: { "synthetic-atlas": "synthetic-map.png" },
      entities: [],
      source,
    },
    scripts: { main: ops.map(at) },
    entry: {
      player: {
        x: options.player?.x ?? 10,
        y: options.player?.y ?? 10,
        layer: 1,
        direction: "down",
        asset: "player",
        mount: "",
      },
      ...(options.offset ? { cameraOffset: options.offset } : {}),
      evidence: [source],
      description: "Redistributable synthetic Canvas camera fixture",
    },
  };
}
function puppet(ops) {
  return [
    { kind: "puppet", slot: 0, actor: "0", target: 4 },
    { kind: "exec-puppets", asynchronous: false },
    { kind: "wait", seconds: 0 },
    exit,
    ...ops,
    exit,
  ];
}

function canvas(width = 160, height = 160) {
  let state = { matrix: [1, 0, 0, 1, 0, 0], alpha: 1 };
  const stack = [],
    draws = [];
  function transform(a, b, c, d, e, f) {
    const [aa, ab, ac, ad, ae, af] = state.matrix;
    state.matrix = [
      aa * a + ac * b,
      ab * a + ad * b,
      aa * c + ac * d,
      ab * c + ad * d,
      aa * e + ac * f + ae,
      ab * e + ad * f + af,
    ];
  }
  const ctx = {
    get globalAlpha() {
      return state.alpha;
    },
    set globalAlpha(alpha) {
      state.alpha = alpha;
    },
    save() {
      stack.push(structuredClone(state));
    },
    restore() {
      assert.ok(stack.length);
      state = stack.pop();
    },
    translate(x, y) {
      transform(1, 0, 0, 1, x, y);
    },
    scale(x, y) {
      transform(x, 0, 0, y, 0, 0);
    },
    transform,
    fillRect() {},
    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
      assert.ok([sx, sy, sw, sh, dx, dy, dw, dh].every(Number.isFinite));
      const [a, b, c, d, e, f] = state.matrix,
        corners = [
          [dx, dy],
          [dx + dw, dy],
          [dx, dy + dh],
          [dx + dw, dy + dh],
        ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]),
        xs = corners.map(([x]) => x),
        ys = corners.map(([, y]) => y);
      draws.push({
        file: image.file,
        source: [sx, sy, sw, sh],
        rect: [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ],
        alpha: state.alpha,
      });
    },
  };
  return {
    element: {
      width,
      height,
      getContext: (kind) => {
        assert.equal(kind, "2d");
        return ctx;
      },
    },
    reset() {
      assert.equal(stack.length, 0);
      draws.length = 0;
    },
    snapshot() {
      assert.equal(stack.length, 0);
      return structuredClone(draws);
    },
  };
}
function scene(definition, width = 160, height = 160) {
  const game = new FieldGame(definition, EventState.initialized()),
    target = canvas(width, height),
    images = new Map(
      ["synthetic-map.png", "synthetic-player.png"].map((file) => [
        file,
        { file },
      ]),
    ),
    renderer = new Renderer(target.element, definition, images);
  return {
    game,
    renderer,
    draw() {
      target.reset();
      renderer.draw(game);
      return target.snapshot();
    },
  };
}
const tile = (draws, x, y) => {
    const matches = draws.filter(
      (draw) =>
        draw.file === "synthetic-map.png" &&
        draw.source[0] === x * 16 &&
        draw.source[1] === y * 16,
    );
    assert.equal(
      matches.length,
      1,
      `Expected one visible source tile ${x},${y}`,
    );
    return matches[0].rect;
  },
  player = (draws) => {
    const matches = draws.filter(
      (draw) => draw.file === "synthetic-player.png",
    );
    assert.equal(
      matches.length,
      1,
      "Only the actual player is rendered, never a dummy actor clone",
    );
    return matches[0].rect;
  };
const checks = [];
function check(name, run) {
  const observed = run();
  checks.push({ name, passed: true, observed });
}
const moving = scene(content(puppet([position(12, 10), lerp(12, 14, 1)])));
check(
  "initialized player tracking draws map and actor at independent source rectangles",
  () => {
    moving.game.initializeMapCamera();
    assert.equal(moving.game.cameraSnapshot.target, "player");
    const draws = moving.draw();
    assert.deepEqual(tile(draws, 12, 10), [104, 72, 16, 16]);
    assert.deepEqual(player(draws), [72, 70, 16, 16]);
    return { landmark: tile(draws, 12, 10), player: player(draws) };
  },
);
check(
  "dummy SetPos shifts real map and actor draws without moving or duplicating the player",
  () => {
    assert.equal(moving.game.startEvent("main"), true);
    assert.equal(moving.game.stop, null);
    assert.equal(moving.game.cameraSnapshot.target, "dummy");
    const draws = moving.draw();
    assert.deepEqual(tile(draws, 12, 10), [72, 72, 16, 16]);
    assert.deepEqual(player(draws), [40, 70, 16, 16]);
    assert.deepEqual([moving.game.player.x, moving.game.player.y], [10, 10]);
    assert.deepEqual(Object.keys(moving.game.actors), ["-1001"]);
    return { landmark: tile(draws, 12, 10), player: player(draws) };
  },
);
check(
  "halfway Lerp moves draw projection while player coordinates stay fixed; drawing advances no clock",
  () => {
    moving.game.advance(500);
    assert.equal(moving.game.stop, null);
    const before = moving.game.cameraSnapshot,
      time = moving.game.time,
      draws = moving.draw();
    assert.deepEqual(tile(draws, 12, 10), [72, 40, 16, 16]);
    assert.deepEqual(player(draws), [40, 38, 16, 16]);
    assert.deepEqual([moving.game.player.x, moving.game.player.y], [10, 10]);
    assert.deepEqual(moving.draw(), draws);
    assert.deepEqual(moving.game.cameraSnapshot, before);
    assert.equal(moving.game.time, time);
    return { landmark: tile(draws, 12, 10), player: player(draws), time };
  },
);
check(
  "ordinary script End restores live player tracking and its original map projection",
  () => {
    moving.game.advance(530);
    assert.equal(moving.game.stop, null);
    assert.equal(moving.game.busy, false);
    assert.equal(moving.game.cameraSnapshot.target, "player");
    const draws = moving.draw();
    assert.deepEqual(tile(draws, 12, 10), [104, 72, 16, 16]);
    assert.deepEqual(player(draws), [72, 70, 16, 16]);
    return { landmark: tile(draws, 12, 10), player: player(draws) };
  },
);
check(
  "source map-range viewport clamp uses both edges of a nonzero subrange",
  () => {
    const observed = [];
    for (const [x, y, firstX, firstY, lastX, lastY] of [
      [5, 7, 5, 7, 14, 16],
      [90, 90, 15, 13, 24, 22],
    ]) {
      const s = scene(
        content(puppet([position(x, y), { kind: "wait", seconds: 1 }]), {
          range: { x: 5, y: 7, width: 20, height: 16 },
        }),
      );
      s.game.startEvent("main");
      assert.equal(s.game.stop, null);
      const draws = s.draw(),
        tiles = draws.filter((d) => d.file === "synthetic-map.png");
      assert.equal(tiles.length, 100);
      assert.deepEqual(tile(draws, firstX, firstY), [0, 0, 16, 16]);
      assert.deepEqual(tile(draws, lastX, lastY), [144, 144, 16, 16]);
      assert.ok(
        tiles.every(
          (d) =>
            d.rect[0] >= 0 &&
            d.rect[1] >= 0 &&
            d.rect[0] + d.rect[2] <= 160 &&
            d.rect[1] + d.rect[3] <= 160,
        ),
      );
      observed.push({
        target: [x, y],
        firstTile: [firstX, firstY],
        lastTile: [lastX, lastY],
      });
    }
    return observed;
  },
);
check(
  "a map smaller than the viewport remains centered by the source camera",
  () => {
    const s = scene(
      content(puppet([position(0, 90), { kind: "wait", seconds: 1 }]), {
        width: 4,
        height: 6,
        player: { x: 1, y: 2 },
      }),
    );
    s.game.startEvent("main");
    assert.equal(s.game.stop, null);
    const draws = s.draw();
    assert.equal(
      draws.filter((d) => d.file === "synthetic-map.png").length,
      24,
    );
    assert.deepEqual(tile(draws, 0, 0), [48, 32, 16, 16]);
    assert.deepEqual(tile(draws, 3, 5), [96, 112, 16, 16]);
    return { first: tile(draws, 0, 0), last: tile(draws, 3, 5) };
  },
);
check(
  "without a camera host the legacy player plus pixel-offset projection remains available",
  () => {
    const s = scene(
      content([exit], { legacy: true, offset: { x: 16, y: 32 } }),
    );
    assert.equal(s.game.cameraSnapshot, null);
    const draws = s.draw();
    assert.deepEqual(tile(draws, 12, 10), [88, 104, 16, 16]);
    assert.deepEqual(player(draws), [56, 102, 16, 16]);
    const small = scene(
      content([exit], {
        legacy: true,
        width: 4,
        height: 6,
        player: { x: 1, y: 2 },
      }),
    ).draw();
    assert.deepEqual(tile(small, 0, 0), [48, 32, 16, 16]);
    return {
      landmark: tile(draws, 12, 10),
      player: player(draws),
      smallMapFirst: tile(small, 0, 0),
    };
  },
);

const implementation = {};
for (const file of [
  "apps/game/renderer.js",
  "src/core/field.ts",
  "src/core/field-camera.ts",
  "src/core/field-camera-host.ts",
])
  implementation[file] = sha(await readFile(resolve(root, file)));
const runtimeModules = {};
for (const file of [
  "src/core/field.js",
  "src/core/field-camera.js",
  "src/core/field-camera-host.js",
  "src/core/actor-animation.js",
  "src/core/field-fade.js",
])
  runtimeModules[file] = sha(await readFile(resolve(compiled, file)));
const report = {
  formatVersion: 1,
  kind: "controlled-canvas-and-real-field-camera-runtime",
  passed: true,
  semanticsVerified: false,
  browserRasterVerified: false,
  originalGameParityVerified: false,
  fixture:
    "Redistributable synthetic map, unique tile rectangles and one player sprite; no browser injection",
  implementation,
  runtimeModules,
  checks,
  limitations: [
    "Draw coordinates and transforms only; Canvas rasterization, display timing and original-game parity are not verified.",
    "Camera motion is the admitted source SetPos/Lerp path; ordinary Move is not asserted to be supported for the dummy.",
    "No native assets, source-map reachability or fresh GameSession publication are tested here.",
  ],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    checks: checks.length,
    passed: true,
    browserRasterVerified: false,
    originalGameParityVerified: false,
  }),
);
