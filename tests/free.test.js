import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, HOVER } from '../js/core.js';
import { normChannels, applyChannels, freeStart } from '../js/free.js';

const inp = { thr: 0.7, yaw: 0.3, pitch: 0.5, roll: -0.4 };

test('通道開關：全開時輸入原樣通過（與 v2.0 行為相同）', () => {
  const ch = normChannels(null);
  assert.deepEqual(ch, { thr: true, yaw: true, pitch: true, roll: true });
  assert.deepEqual(applyChannels(inp, ch), inp);
  assert.deepEqual(freeStart(ch), { p: [-14, -9, 0], thr: 0 });
});

test('關掉 Pitch：送進物理的 pitch = 0，其他通道不受影響', () => {
  const sim = new Sim(), o = applyChannels(inp, normChannels({ pitch: false }));
  Object.assign(sim.st, o); sim.step(1 / 240);
  assert.equal(sim.st.pitch, 0);
  assert.equal(sim.st.roll, -0.4); assert.equal(sim.st.yaw, 0.3); assert.equal(sim.st.thr, 0.7);
});

test('關掉 Yaw／Roll 同理送 0', () => {
  const o = applyChannels(inp, normChannels({ yaw: false, roll: false }));
  assert.equal(o.yaw, 0); assert.equal(o.roll, 0); assert.equal(o.pitch, 0.5);
});

test('關掉油門：起始高度 5m、油門固定懸停；輸入的油門被忽略', () => {
  const ch = normChannels({ thr: false }), s = freeStart(ch);
  assert.equal(s.p[2], 5); assert.equal(s.thr, HOVER);
  assert.equal(applyChannels(inp, ch).thr, HOVER);
  const sim = new Sim(); sim.reset(s.p, [0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]); Object.assign(sim.st, applyChannels({ thr: 0, yaw: 0, pitch: 0, roll: 0 }, ch));
  for (let i = 0; i < 240 * 3; i++) sim.step(1 / 240);
  assert.ok(Math.abs(sim.p[2] - 5) < 0.01, '懸停油門下 3 秒後高度應維持 5m');
});

test('設定檔讀回：缺的、壞的、非 false 的值都當作「開」', () => {
  assert.deepEqual(normChannels({ thr: false, yaw: 'x', pitch: 0 }), { thr: false, yaw: true, pitch: true, roll: true });
  assert.deepEqual(normChannels('壞掉'), { thr: true, yaw: true, pitch: true, roll: true });
});
