import test from "node:test";
import assert from "node:assert/strict";
import {
  AirshipMotion,
  flightCamera,
  flightPose,
  flightShadow,
  projectFlightPoint,
} from "./airship-motion.js";
const parameters = {
  moveSeconds: [0.24, 0.48, 0.12, 0.96, 0.06],
  movementMultiplier: 4,
  poseKeys: [
    ["LookDownL", "LookDown", "LookDownR"],
    ["LookLeft", "Forward", "LookRight"],
    ["LookUpL", "LookUp", "LookUpR"],
  ],
};
const task = (name, r, i = 0, time = 0) => ({ name, r, i: [i], time });
const almost = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
test("parallel PR rotation, altitude and up/down use independent unclamped endpoints and add-time capture", () => {
  const m = new AirshipMotion();
  m.start(
    {
      time: 0,
      tasks: [
        task("AddAirShipRotateChangeTask", [4, 180]),
        task("AddAirShipFlightAltitudeChangeTask", [2, 3, 1], 1),
        task("AddAirshipUpDownMoveTask", [1, -80]),
      ],
    },
    parameters,
  );
  const s = m.at(1);
  almost(s.rotation, 45);
  almost(s.altitude, 2);
  almost(s.upDown, -80);
  assert.equal(flightPose(s, parameters), "LookUpL");
  assert.equal(flightPose(m.at(4), parameters), "Forward");
  almost(flightCamera(m.at(2), parameters).fov, 110);
  almost(flightCamera(m.at(2), parameters).flightAltitude, 168);
  m.start({ time: 2, tasks: [task("AddAirShipRotateChangeTask", [1, -90], 0, 1)] }, parameters);
  almost(m.at(2).rotation, 45);
  almost(m.at(3).rotation, -45);
  // The old four-second rotation is still alive and writes again next frame.
  almost(m.at(3.5).rotation, 157.5);
});
test("flight move rotates with heading, keeps old tasks alive and samples without FPS dependence", () => {
  const m = new AirshipMotion();
  m.start(
    {
      time: 0,
      tasks: [
        task("AddAirShipMoveTask", [41, 0, 1], 3),
        task("AddAirShipRotateChangeTask", [1, 90]),
      ],
    },
    parameters,
  );
  const a = m.at(1),
    speed = 4 / 0.96;
  almost(a.offset.x, (-speed * 2) / Math.PI);
  almost(a.offset.y, (-speed * 2) / Math.PI);
  m.start({ time: 1, tasks: [task("AddAirShipFlightAltitudeChangeTask", [2, 1])] }, parameters);
  const b = m.at(2);
  almost(b.offset.x, a.offset.x - speed);
  almost(b.offset.y, a.offset.y);
  for (let t = 0; t < 2; t += 0.017) m.at(t);
  assert.deepEqual(m.at(2), b);
  assert.deepEqual(new AirshipMotion().at(0).offset, { x: 0, y: 0 });
});
test("zero duration does not write a native endpoint; Mathf.Sign(0) remains +1 until completion", () => {
  const m = new AirshipMotion();
  m.start(
    {
      time: 0,
      tasks: [
        task("AddAirShipRotateChangeTask", [0, 180]),
        task("AddAirShipFlightAltitudeChangeTask", [0.016, 0]),
      ],
    },
    parameters,
  );
  assert.equal(m.at(0).rotation, 0);
  assert.equal(flightPose(m.at(0), parameters), "LookUp");
  assert.equal(flightPose(m.at(0.016), parameters), "Forward");
});
test("native camera orbit and altitude are independent; read-only manual heading chooses matching bank", () => {
  const m = new AirshipMotion(),
    game = { time: 0, player: { direction: "up" } },
    before = structuredClone(game);
  m.sample(game);
  assert.deepEqual(game, before);
  const s = m.at(0),
    low = flightCamera({ ...s, altitude: 0 }, parameters),
    high = flightCamera(s, parameters);
  almost(low.pitch, high.pitch);
  almost(high.distance, 311.7691453623979);
  almost(high.pitch, 35);
  assert.equal(flightShadow({ ...s, altitude: 0 }, parameters), 1);
  assert.equal(flightShadow({ ...s, altitude: 1 }, parameters), 4);
  const p = projectFlightPoint({ x: 0, y: 0, z: 0 }, high);
  almost(p.x, 160);
  almost(p.y, 90);
  almost(flightCamera(s, parameters, 0).pitch, 82.8);
  m.sample({ ...game, time: 1, player: { direction: "right" } });
  const turn = m.sample({ ...game, time: 1.15, player: { direction: "right" } });
  almost(turn.rotation, -45);
  assert.equal(flightPose(turn, parameters), "LookRight");
  const end = m.sample({ ...game, time: 1.3, player: { direction: "right" } });
  almost(end.rotation, -90);
  assert.equal(flightPose(end, parameters), "Forward");
});

test("map replacement resets a repeated manual heading and zero-time stills safely", () => {
  const motion = new AirshipMotion(),
    game = { time: 0, player: { direction: "up" } };
  motion.sample(game);
  motion.reset();
  assert.equal(motion.sample(game).rotation, 0);
  motion.reset();
  motion.sample({ time: 0 });
  motion.reset();
  assert.doesNotThrow(() => motion.sample({ time: 0 }));
});

test("implicit automatic turns start at the current manual bearing, then return control without losing that bearing", () => {
  const m = new AirshipMotion();
  m.sample({ time: 0, player: { direction: "down" } });
  m.start({ time: 1, tasks: [task("AddAirShipRotateChangeTask", [1, 90], 0, 1)] }, parameters);
  almost(m.at(1.5).rotation, 225);
  const end = m.sample({ time: 2, player: { direction: "down" }, busy: false });
  almost(end.rotation, 270);
  almost(m.sample({ time: 3, player: { direction: "down" }, busy: false }).rotation, 270);
});
test("old flight altitude tasks cannot suppress a later takeoff camera or its shadow frame", () => {
  const state = { rotation: 0, altitude: 0, altitudeAuthored: true, upDown: 0 },
    camera = flightCamera(state, parameters, 0.5);
  almost(camera.fov, 47.5);
  almost(camera.flightAltitude, 172);
  assert.equal(flightShadow(state, parameters, 0), 4);
  assert.equal(flightShadow(state, parameters, 1), 1);
});
