import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, HOVER, yawOnly, euler, bodyRates, RATE, D2R } from '../js/core.js';
import { LESSONS, lessonStart, lessonCtrl } from '../js/demos.js';

const DT = 1 / 240;
// 自由練習的起始：地面、速度 0、機身水平，groundHold 開啟
function freeSim(z = 0, v = [0, 0, 0]) {
  const s = new Sim(); s.groundHold = true; s.reset([-14, -9, z], v, yawOnly(0)); return s;
}
function fly(sim, secs, st) {
  for (let i = 0; i < Math.round(secs / DT); i++) { Object.assign(sim.st, st); sim.step(DT); if (sim.crashed) break; }
}
const wrap = (d) => ((d + 540) % 360) - 180;

test('groundHold：地面、油門 0 跑 3 秒：不觸地、z 維持 0', () => {
  const s = freeSim();
  fly(s, 3, { thr: 0, yaw: 0, pitch: 0, roll: 0 });
  assert.equal(s.crashed, false); assert.equal(s.p[2], 0); assert.equal(s.onGround, true);
});

test('groundHold：地面上 Yaw 滿桿 0.5 秒，航向改變且不觸地（搖桿沒被鎖）', () => {
  const s = freeSim(); const y0 = euler(s.R).yaw;
  fly(s, 0.5, { thr: 0, yaw: 1, pitch: 0, roll: 0 });
  assert.equal(s.crashed, false);
  assert.ok(Math.abs(wrap(euler(s.R).yaw - y0)) > 30, '航向沒變');
});

test('groundHold：地面上 Roll 滿桿 0.2 秒，滾轉角改變且不觸地（即使超過 60°）', () => {
  const s = freeSim();
  fly(s, 0.2, { thr: 0, yaw: 0, pitch: 0, roll: 1 });
  assert.equal(s.crashed, false);
  assert.ok(Math.abs(euler(s.R).roll) > 30, '滾轉角沒變');
  fly(s, 1, { thr: 0, yaw: 0, pitch: 0, roll: 0 }); // 之後歪著停在地面也不判觸地
  assert.equal(s.crashed, false); assert.equal(s.p[2], 0);
});

test('groundHold：油門 60% 跑 1 秒會離地', () => {
  const s = freeSim();
  fly(s, 1, { thr: 0.6, yaw: 0, pitch: 0, roll: 0 });
  assert.ok(s.p[2] > 0.5, `z=${s.p[2]}`); assert.equal(s.crashed, false); assert.equal(s.onGround, false);
});

test('groundHold：地面水平速度快速衰減', () => {
  const s = freeSim(0, [5, 0, 0]);
  fly(s, 2, { thr: 0, yaw: 0, pitch: 0, roll: 0 });
  assert.ok(Math.hypot(s.v[0], s.v[1]) < 0.05);
});

test('groundHold：從 2m 略低於懸停油門緩降（<2.5 m/s、水平）：不觸地、留在地面', () => {
  const s = freeSim(2);
  let vmax = 0;
  for (let i = 0; i < 240 * 6; i++) { Object.assign(s.st, { thr: HOVER * 0.9, yaw: 0, pitch: 0, roll: 0 }); vmax = Math.min(vmax, s.v[2]); s.step(DT); }
  assert.ok(vmax > -2.5, `下降速度 ${vmax}`);
  assert.equal(s.crashed, false); assert.equal(s.p[2], 0); assert.equal(s.onGround, true);
});

test('groundHold：從 10m 油門 0 自由落下會觸地', () => {
  const s = freeSim(10);
  fly(s, 5, { thr: 0, yaw: 0, pitch: 0, roll: 0 });
  assert.equal(s.crashed, true);
});

test('groundHold：從空中以傾斜 > 60° 接觸地面會觸地', () => {
  const s = freeSim(1);
  fly(s, 0.2, { thr: 0, yaw: 0, pitch: 0, roll: 1 }); // 空中先滾到很斜
  fly(s, 3, { thr: 0, yaw: 0, pitch: 0, roll: 0 });
  assert.equal(s.crashed, true);
});

test('groundHold 預設關閉：新建的 Sim 不開，教室示範走原本路徑', () => {
  const s = new Sim();
  assert.equal(s.groundHold, false); assert.equal(s.rateScale, 1);
  // 關閉時從 10m 落地照舊判定觸地，且不因 onGround 旗標而放過
  s.reset([0, 0, 10], [0, 0, 0], yawOnly(0));
  fly(s, 5, { thr: 0, yaw: 0, pitch: 0, roll: 0 });
  assert.equal(s.crashed, true);
});

test('groundHold 關閉：6 個示範明確設 groundHold=false／rateScale=1 的結果與預設完全相同', () => {
  const run = (L, v, configure) => {
    const sim = new Sim(), mem = {}; configure(sim); lessonStart(L, sim); let t = 0;
    while (t < L.dur && !sim.crashed) { const c = lessonCtrl(L, v, sim, t, mem); Object.assign(sim.st, { thr: c.thr, roll: c.roll, pitch: c.pitch, yaw: c.yaw }); sim.step(DT); t += DT; }
    return JSON.stringify([sim.p, sim.v, sim.R, sim.crashed]);
  };
  for (const L of LESSONS) for (const v of L.variants) {
    assert.equal(run(L, v, () => {}), run(L, v, (s) => { s.groundHold = false; s.rateScale = 1; }), `${L.id}:${v.key}`);
  }
});

test('Rate 倍率 1.5、滿桿：送進物理的角速度為倍率 1 的 1.5 倍；搖桿值仍是 ±1', () => {
  const st = { thr: 0.5, yaw: 1, pitch: -1, roll: 1 };
  const a = bodyRates(st, 1), b = bodyRates(st, 1.5);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(b[i] - a[i] * 1.5) < 1e-12);
  assert.ok(Math.abs(a[0] - RATE.roll * D2R) < 1e-12);
  // 實際跑物理：滾轉角速度 1.5 倍 → 同樣時間轉過約 1.5 倍角度
  const roll = (scale) => { const s = freeSim(); s.rateScale = scale; fly(s, 0.05, { thr: 0, yaw: 0, pitch: 0, roll: 1 }); return euler(s.R).roll; };
  assert.ok(Math.abs(roll(1.5) / roll(1) - 1.5) < 0.01);
});
