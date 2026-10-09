import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, HOVER, D2R, M, yawOnly } from '../js/core.js';
import { forces, thrForLevel } from '../js/forces.js';

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
