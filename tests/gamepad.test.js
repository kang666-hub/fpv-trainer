import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeadzone, applyExpo, mapAxes, shapeSticks, detectAxis, finalizeCalibration, DEFAULT_GAMEPAD } from '../js/gamepad.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('applyDeadzone：死區內歸零、端點不變、邊界連續', () => {
  assert.equal(applyDeadzone(0.02, 0.03), 0);
  assert.equal(applyDeadzone(-0.02, 0.03), 0);
  near(applyDeadzone(1, 0.03), 1);
  near(applyDeadzone(-1, 0.03), -1);
  near(applyDeadzone(0.03 + 1e-9, 0.03), 0, 1e-6); // 邊界外側從 0 起算
  near(applyDeadzone(0.5, 0), 0.5);
  assert.ok(applyDeadzone(0.6, 0.1) > applyDeadzone(0.5, 0.1)); // 單調
});

test('applyExpo：expo 0 恆等；任何 expo 下 0→0、±1→±1', () => {
  for (const v of [-1, -0.37, 0, 0.5, 1]) near(applyExpo(v, 0), v);
  for (const e of [0, 0.2, 0.5, 0.8, 1]) {
    near(applyExpo(0, e), 0); near(applyExpo(1, e), 1); near(applyExpo(-1, e), -1);
  }
  assert.ok(applyExpo(0.5, 0.8) < 0.5); // expo 讓中心變鈍
});

const M = DEFAULT_GAMEPAD.axes;

test('mapAxes：油門 -1→0、+1→1，中間 0.5', () => {
  assert.equal(mapAxes([0, 0, -1, 0], M).thr, 0);
  assert.equal(mapAxes([0, 0, 1, 0], M).thr, 1);
  near(mapAxes([0, 0, 0, 0], M).thr, 0.5);
});

test('mapAxes：invert 生效', () => {
  const m = { ...M, thr: { ...M.thr, invert: true }, roll: { ...M.roll, invert: true } };
  assert.equal(mapAxes([0, 0, -1, 0], m).thr, 1);
  assert.equal(mapAxes([0, 0, 1, 0], m).thr, 0);
  assert.equal(mapAxes([0.5, 0, 0, 0], m).roll, -0.5);
});

test('mapAxes：超出 min／max 會夾限', () => {
  const m = { ...M, thr: { index: 2, invert: false, min: -0.8, max: 0.8 }, roll: { index: 0, invert: false, min: -0.9, max: 0.9, center: 0 } };
  assert.equal(mapAxes([0, 0, -1, 0], m).thr, 0);
  assert.equal(mapAxes([0, 0, 1, 0], m).thr, 1);
  assert.equal(mapAxes([1, 0, 0, 0], m).roll, 1);
  assert.equal(mapAxes([-1, 0, 0, 0], m).roll, -1);
});

test('mapAxes：center 偏移後中點輸出 0，兩側各自拉滿', () => {
  const m = { ...M, yaw: { index: 3, invert: false, min: -1, max: 0.8, center: -0.1 } };
  assert.equal(mapAxes([0, 0, 0, -0.1], m).yaw, 0);
  near(mapAxes([0, 0, 0, 0.8], m).yaw, 1);
  near(mapAxes([0, 0, 0, -1], m).yaw, -1);
});

test('mapAxes：缺軸或 min=max 不產生 NaN', () => {
  const m = { ...M, thr: { index: 9, invert: false, min: 0, max: 0 } };
  const r = mapAxes([0, 0, 0, 0], m);
  for (const v of Object.values(r)) assert.ok(Number.isFinite(v));
});

test('shapeSticks：死區＋expo，結果維持 ±1，油門不受影響；不再處理 Rate 倍率', () => {
  const r = shapeSticks({ thr: 0.4, yaw: 0.01, pitch: 1, roll: -1 }, { deadzone: 0.03, expo: 0 });
  assert.equal(r.thr, 0.4); assert.equal(r.yaw, 0); assert.equal(r.pitch, 1); assert.equal(r.roll, -1);
  // rateScale 即使傳進來也不影響搖桿值（v1.2：倍率改乘在物理角速度上）
  near(shapeSticks({ thr: 0, yaw: 0.5, pitch: 0, roll: 0 }, { deadzone: 0, expo: 0, rateScale: 1.5 }).yaw, 0.5);
});

test('detectAxis：找出位移最大的軸與正負方向', () => {
  const base = [0, 0, -1, 0, 0.1];
  let r = detectAxis(base, [0.1, 0, 1, 0.2, 0.1]);
  assert.equal(r.index, 2); assert.equal(r.direction, 1); near(r.delta, 2);
  r = detectAxis(base, [0.05, -0.9, -1, 0.1, 0.1]);
  assert.equal(r.index, 1); assert.equal(r.direction, -1); near(r.delta, 0.9);
  r = detectAxis(base, base);
  assert.equal(r.direction, 0); assert.equal(r.delta, 0);
  assert.equal(detectAxis([], []).index, -1);
});

test('finalizeCalibration：方向、min/max、center 換成 axes 設定，且 mapAxes 能還原兩端', () => {
  const axes = finalizeCalibration({
    assign: { thr: { index: 1, direction: -1 }, yaw: { index: 0, direction: 1 }, pitch: { index: 3, direction: -1 }, roll: { index: 2, direction: 1 } },
    range: { 0: { min: -0.9, max: 0.9 }, 1: { min: -1, max: 1 }, 2: { min: -0.8, max: 1 }, 3: { min: -1, max: 1 } },
    center: [0.02, 0, -0.05, 0],
  });
  assert.equal(axes.thr.invert, true); assert.equal(axes.pitch.invert, true); assert.equal(axes.yaw.invert, false);
  assert.equal(axes.thr.center, undefined); assert.equal(axes.roll.center, -0.05);
  // thr 反向：原始 -1（推到最高）→ 1
  assert.equal(mapAxes([0, -1, 0, 0], axes).thr, 1);
  assert.equal(mapAxes([0, 1, 0, 0], axes).thr, 0);
  near(mapAxes([0.02, 0, -0.05, 0], axes).yaw, 0);
  near(mapAxes([0, 0, 1, 0], axes).roll, 1);
});
