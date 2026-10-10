import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, HOVER, D2R, M, yawOnly } from '../js/core.js';
import { forces, thrForLevel, throttleSplit, curveSide } from '../js/forces.js';
import { LESSONS } from '../js/demos.js';

const tilted = (deg, thr) => { const sim = new Sim(); sim.R = M.mul(yawOnly(0), M.exp([0, deg * D2R, 0])); sim.st.thr = thr; return sim; };

test('forces：懸停（機身水平、油門 40%）時合力 < 0.01g，推力 = 1g', () => {
  const f = forces(tilted(0, HOVER));
  assert.ok(f.netMag < 0.01, `|net| = ${f.netMag}`);
  assert.ok(Math.abs(f.thrustMag - 1) < 0.01);
  assert.deepEqual(f.gravity, [0, 0, -1]);
});

test('forces：傾斜 θ、油門 = thrForLevel(θ) 時合力的垂直分量 ≈ 0（高度不變），水平分量 > 0', () => {
  for (const th of [15, 30, 45, 60]) {
    const f = forces(tilted(th, thrForLevel(th).thr));
    assert.ok(Math.abs(f.net[2]) < 0.01, `${th}°：net.z = ${f.net[2]}`);
    assert.ok(f.horizontalMag > 0.2 * Math.sin(th * D2R));
  }
});

test('forces：任何狀態 thrust + gravity = net，垂直分量 + 水平分量 = 推力', () => {
  for (const [deg, thr] of [[0, 0], [20, 0.3], [90, 1], [135, 0.7], [180, 0.5]]) {
    const f = forces(tilted(deg, thr));
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(f.thrust[i] + f.gravity[i] - f.net[i]) < 1e-9);
      assert.ok(Math.abs(f.vertical[i] + f.horizontal[i] - f.thrust[i]) < 1e-9);
    }
  }
});

test('thrForLevel：0° → 0.40；60° → 0.80；66.4° → 1.00 且 ok；70° → 不 ok；90° 以上不 ok', () => {
  assert.ok(Math.abs(thrForLevel(0).thr - 0.40) < 0.01);
  assert.ok(Math.abs(thrForLevel(60).thr - 0.80) < 0.01);
  const e = thrForLevel(66.4); assert.ok(Math.abs(e.thr - 1.0) < 0.01); assert.equal(e.ok, true);
  assert.equal(thrForLevel(70).ok, false); assert.ok(thrForLevel(70).thr > 1);
  assert.equal(thrForLevel(90).ok, false); assert.equal(thrForLevel(120).ok, false);
});

test('throttleSplit：5% 油門變化在 20°／60°／0° 下的往上與往側分力', () => {
  const a = throttleSplit(20, 0.05), b = throttleSplit(60, 0.05), c = throttleSplit(0, 0.05);
  assert.ok(Math.abs(a.up - 0.117) < 0.002 && Math.abs(a.side - 0.043) < 0.002, JSON.stringify(a));
  assert.ok(Math.abs(b.up - 0.0625) < 0.002 && Math.abs(b.side - 0.108) < 0.002, JSON.stringify(b));
  assert.ok(Math.abs(c.side) < 1e-12 && Math.abs(c.up - 0.125) < 1e-9);
});

test('油門分力讀數旗標：只有 B3、B4 的示範設 sens: true', () => {
  assert.deepEqual(LESSONS.filter((l) => l.sens).map((l) => l.id), ['B3', 'B4']);
});

test('curveSide：(0°, 懸停) level；(30°, 100%) up；(60°, 懸停) down；(70°, 100%) down；±2% 內算 level', () => {
  assert.equal(curveSide(0, HOVER), 'level');
  assert.equal(curveSide(30, 1), 'up');
  assert.equal(curveSide(60, HOVER), 'down');
  assert.equal(curveSide(70, 1), 'down');
  assert.equal(curveSide(66.4, 1), 'level');
  assert.equal(curveSide(45, thrForLevel(45).thr + 0.015), 'level');
  assert.equal(curveSide(45, thrForLevel(45).thr + 0.03), 'up');
});

test('curve 旗標：只有 B2 的示範設 curve: true', () => {
  assert.deepEqual(LESSONS.filter((l) => l.curve === true).map((l) => l.id), ['B2']);
  assert.ok(LESSONS.filter((l) => l.id !== 'B2').every((l) => !l.curve));
});
