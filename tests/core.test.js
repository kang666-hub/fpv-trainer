import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim, HOVER } from '../js/core.js';
import { LESSONS, lessonStart, lessonCtrl } from '../js/demos.js';

const DT = 1 / 240;
const lesson = (id) => LESSONS.find((l) => l.id === id);

// 無 DOM 跑一輪示範，回傳統計
function run(id, variantKey) {
  const L = lesson(id);
  const varr = L.variants.find((v) => v.key === variantKey);
  assert.ok(varr, `${id} 沒有版本 ${variantKey}`);
  const sim = new Sim(), mem = {};
  lessonStart(L, sim);
  const z0 = sim.p[2];
  let t = 0, minz = z0, maxDev = 0, touched = false;
  while (t < L.dur) {
    const c = lessonCtrl(L, varr, sim, t, mem);
    Object.assign(sim.st, { thr: c.thr, roll: c.roll, pitch: c.pitch, yaw: c.yaw });
    sim.step(DT); t += DT;
    minz = Math.min(minz, sim.p[2]);
    if (sim.crashed || sim.p[2] <= 0) touched = true;
    if (L.ref && t <= L.pathT[1]) {
      const r = L.ref(t).p;
      maxDev = Math.max(maxDev, Math.hypot(sim.p[0] - r[0], sim.p[1] - r[1]));
    }
    if (sim.crashed) break;
  }
  return { z0, minz, zEnd: sim.p[2], touched, crashed: sim.crashed, maxDev };
}

test('每個示範的「正確」版本全程不觸地', () => {
  for (const L of LESSONS) {
    const r = run(L.id, 'ok');
    assert.equal(r.touched, false, `${L.id} 正確版觸地（最低 ${r.minz.toFixed(2)} m）`);
  }
});

test('line、turn、orbit 的「沒補油」版本會觸地', () => {
  for (const id of ['line', 'turn', 'orbit']) {
    const r = run(id, 'thr');
    assert.equal(r.touched, true, `${id} 沒補油版沒有觸地（最低 ${r.minz.toFixed(2)} m）`);
  }
});

test('turn 只打 Yaw：水平偏離路線 > 10 m', () => {
  const r = run('turn', 'yaw');
  assert.ok(r.maxDev > 10, `偏離只有 ${r.maxDev.toFixed(1)} m`);
});

test('inv：正確版結束高度 >= 起點；錯誤版結束高度 < 正確版', () => {
  const ok = run('inv', 'ok'), bad = run('inv', 'heavy');
  assert.ok(ok.zEnd >= ok.z0, `正確版結束 ${ok.zEnd.toFixed(2)} < 起點 ${ok.z0.toFixed(2)}`);
  assert.ok(bad.zEnd < ok.zEnd, `錯誤版 ${bad.zEnd.toFixed(2)} 不低於正確版 ${ok.zEnd.toFixed(2)}`);
});

test('split：正確版最低高度 > 拉桿太慢版', () => {
  const ok = run('split', 'ok'), slow = run('split', 'slow');
  assert.ok(ok.minz > slow.minz, `正確 ${ok.minz.toFixed(2)} vs 太慢 ${slow.minz.toFixed(2)}`);
});

test('懸停油門下靜止的機體不會掉高', () => {
  const sim = new Sim();
  for (let i = 0; i < 240 * 3; i++) sim.step(DT);
  assert.ok(Math.abs(sim.p[2] - 2) < 0.01);
  assert.ok(Math.abs(HOVER - 0.4) < 0.01);
});

test('lessons.json：必填欄位齊全，demo 指向存在的示範或為 null', () => {
  const data = JSON.parse(readFileSync(new URL('../data/lessons.json', import.meta.url), 'utf8'));
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.rules) && data.rules.length > 0);
  assert.ok(Array.isArray(data.weekly) && data.weekly.length > 0);
  assert.equal(data.levels.length, 7);
  const demoIds = new Set(LESSONS.map((l) => l.id));
  const ids = new Set();
  const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
  data.levels.forEach((lv, i) => {
    assert.ok(nonEmpty(lv.id), `levels[${i}].id`);
    assert.ok(!ids.has(lv.id), `id 重複：${lv.id}`);
    ids.add(lv.id);
    assert.equal(lv.order, i + 1, `${lv.id} order 應為 ${i + 1}`);
    assert.ok(nonEmpty(lv.title), `${lv.id}.title`);
    assert.ok(lv.demo === null || demoIds.has(lv.demo), `${lv.id}.demo 指向不存在的示範：${lv.demo}`);
    for (const k of ['sim', 'real']) {
      assert.ok(lv[k] && nonEmpty(lv[k].do) && nonEmpty(lv[k].pass), `${lv.id}.${k} 缺 do/pass`);
    }
    assert.ok(Array.isArray(lv.tips) && lv.tips.length > 0 && lv.tips.every(nonEmpty), `${lv.id}.tips`);
  });
  assert.deepEqual(data.levels.map((l) => l.id), ['line', 'turn', 'orbit', 's', 'inv', 'split', 'flow']);
});
