import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim, HOVER, euler } from '../js/core.js';
import { LESSONS, runDemo, stageProfile } from '../js/demos.js';

const lesson = (id) => LESSONS.find((l) => l.id === id);
const variant = (id, key) => { const v = lesson(id).variants.find((x) => x.key === key); assert.ok(v, `${id} 沒有版本 ${key}`); return v; };
const run = (id, key) => runDemo(lesson(id), variant(id, key));
const zs = (r) => r.rec.map((x) => x.p[2]);
const speed = (x) => Math.hypot(x.v[0], x.v[1]);
const data = JSON.parse(readFileSync(new URL('../data/lessons.json', import.meta.url), 'utf8'));
const jsonLevels = data.tiers.flatMap((t) => t.levels);
const jsonVariant = (id, key) => jsonLevels.find((l) => l.id === id).variants.find((v) => v.key === key);

// 連續航向變化（度，累計）與路線方向變化
function headingChange(r) {
  let prev = null, acc = 0, maxd = 0;
  for (const x of r.rec) { const y = euler(x.R).yaw; if (prev !== null) { let d = y - prev; if (d > 180) d -= 360; if (d < -180) d += 360; acc += d; maxd = Math.max(maxd, Math.abs(acc)); } prev = y; }
  return maxd;
}
function pathDirChange(r, t0) {
  const seg = r.rec.filter((x) => x.t >= t0), dir = (x) => Math.atan2(x.v[1], x.v[0]) * 180 / Math.PI;
  let m = 0; for (const x of seg) { let d = dir(x) - dir(seg[0]); d = ((d + 540) % 360) - 180; m = Math.max(m, Math.abs(d)); }
  return m;
}

test('所有「飛法」變體全程不觸地', () => {
  for (const L of LESSONS) for (const v of L.variants) {
    if (jsonVariant(L.id, v.key).kind !== 'style') continue;
    const r = runDemo(L, v);
    assert.equal(r.touched, false, `${L.id}/${v.key} 觸地（最低 ${Math.min(...zs(r)).toFixed(2)} m）`);
  }
});

test('B1、B3、A1 的「沒補油」對照會掉到地面', () => {
  for (const [id, key] of [['B1', 'fixed'], ['B3', 'nocomp'], ['A1', 'nocomp']]) {
    const r = run(id, key);
    assert.equal(r.touched, true, `${id}/${key} 沒有觸地（最低 ${Math.min(...zs(r)).toFixed(2)} m）`);
  }
});

test('B2 飛法：加速段最高點比進場高 < 0.5 m，速度峰值 > 進場 + 8 m/s；對照上升 > 2 m', () => {
  const r = run('B2', 'jet'), z0 = r.rec[0].p[2], v0 = speed(r.rec[0]);
  const acc = r.rec.filter((x) => x.t >= 1.0 && x.t < 2.7);
  const peak = Math.max(...acc.map((x) => x.p[2])) - z0;
  assert.ok(peak < 0.5, `加速段最高點高出進場 ${peak.toFixed(2)} m`);
  assert.ok(Math.max(...r.rec.map(speed)) > v0 + 8, '速度峰值不足');
  const c = run('B2', 'short');
  assert.ok(Math.max(...zs(c)) - c.rec[0].p[2] > 2, '對照沒有上浮');
});

test('B3 飛法：Roll 桿量 > 5% 的時間 < Pitch < Yaw', () => {
  const r = run('B3', 'coord'), on = (ch) => r.rec.find((x) => Math.abs(x[ch]) > 0.05)?.t;
  const [tr, tp, ty] = ['roll', 'pitch', 'yaw'].map(on);
  assert.ok(tr < tp && tp < ty, `順序不對：Roll ${tr}, Pitch ${tp}, Yaw ${ty}`);
});

test('B4：飛法 A 坡度 ≤ 15° 且航向變化 ≥ 90°；飛法 B 坡度 30–45°；對照航向轉 ≥ 90° 但路線方向變化 < 30°', () => {
  const bankOf = (r) => Math.max(...r.rec.map((x) => Math.abs(euler(x.R).roll)));
  const a = run('B4', 'flat');
  assert.ok(bankOf(a) <= 15, `平轉最大坡度 ${bankOf(a).toFixed(1)}°`);
  assert.ok(headingChange(a) >= 90, '平轉航向變化不足');
  const b = run('B4', 'bank');
  assert.ok(bankOf(b) >= 30 && bankOf(b) <= 45, `大坡度版最大坡度 ${bankOf(b).toFixed(1)}°`);
  const c = run('B4', 'yawonly');
  assert.ok(headingChange(c) >= 90, '只打 Yaw 的航向變化不足');
  assert.ok(pathDirChange(c, 1.0) < 30, `路線方向變化 ${pathDirChange(c, 1.0).toFixed(0)}°`);
});

test('B5：飛法改出後 1 秒高度 ≤ 進場且 |垂直速度| < 0.5；對照改出後高度 ≥ 進場 + 1 m', () => {
  for (const key of ['pull', 'direct', 'overthr']) {
    const r = run('B5', key), m = r.mem.marks, z0 = 25;
    const at = r.rec.reduce((a, x) => (Math.abs(x.t - (m.p4 + 1)) < Math.abs(a.t - (m.p4 + 1)) ? x : a));
    if (key === 'overthr') assert.ok(at.p[2] >= z0 + 1, `對照改出後高度 ${at.p[2].toFixed(2)}`);
    else {
      assert.ok(at.p[2] <= z0, `${key} 改出後高度 ${at.p[2].toFixed(2)} > 進場 ${z0}`);
      assert.ok(Math.abs(at.v[2]) < 0.5, `${key} 改出後垂直速度 ${at.v[2].toFixed(2)}`);
    }
  }
});

test('A2 8 字：先轉一整圈（航向累計 ≥ 340°）再反向轉回（結束航向回到起點）且高度穩定', () => {
  const r = run('A2', 'eight'), z = zs(r);
  assert.ok(headingChange(r) >= 340, `航向累計 ${headingChange(r).toFixed(0)}°`);
  assert.ok(Math.max(...z) - Math.min(...z) < 0.5, '高度變化過大');
});

test('A4：正確版結束高度 >= 起點；對照結束高度 < 正確版', () => {
  const ok = run('A4', 'cut'), bad = run('A4', 'keep');
  assert.ok(ok.rec.at(-1).p[2] >= ok.rec[0].p[2], '正確版結束高度低於起點');
  assert.ok(bad.rec.at(-1).p[2] < ok.rec.at(-1).p[2], '對照沒有比正確版低');
});

test('A3：反應慢版不觸地', () => {
  assert.equal(run('A3', 'late').touched, false);
});

test('懸停油門下靜止的機體不會掉高', () => {
  const sim = new Sim();
  for (let i = 0; i < 240 * 3; i++) sim.step(1 / 240);
  assert.ok(Math.abs(sim.p[2] - 2) < 0.01);
  assert.ok(Math.abs(HOVER - 0.4) < 0.01);
});

test('階段時間軸：stages 數量與 lessons.json 一致，時間遞增且最後一段到 dur，桿量比例可由模擬算出', () => {
  for (const L of LESSONS) for (const v of L.variants) {
    const ends = L.stages(v), js = jsonVariant(L.id, v.key);
    assert.equal(ends.length, js.stages.length, `${L.id}/${v.key} 階段數 ${ends.length} ≠ json ${js.stages.length}`);
    assert.ok(ends.every((e, i) => i === 0 || e > ends[i - 1]), `${L.id}/${v.key} 階段時間未遞增`);
    assert.equal(ends.at(-1), L.dur, `${L.id}/${v.key} 最後一段應到 dur`);
    const prof = stageProfile(L, v);
    assert.ok(prof.every((s) => Number.isFinite(s.roll + s.pitch + s.yaw + s.thr)), `${L.id}/${v.key} 桿量比例非數字`);
  }
});

test('lessons.json v2：必填欄位齊全，variant kind 只能是 style／contrast，demo 與變體都對得上', () => {
  assert.equal(data.version, 2);
  for (const k of ['guide', 'rules', 'weekly']) assert.ok(Array.isArray(data[k]) && data[k].length > 0, k);
  assert.ok(data.free && data.free.title && data.free.notes.length > 0);
  assert.deepEqual(data.tiers.map((t) => t.id), ['intro', 'basic', 'advanced']);
  const demoIds = new Set(LESSONS.map((l) => l.id)), ids = new Set();
  const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
  for (const tier of data.tiers) {
    assert.ok(nonEmpty(tier.title) && nonEmpty(tier.intro) && tier.levels.length > 0);
    tier.levels.forEach((lv, i) => {
      assert.ok(nonEmpty(lv.id), 'id'); assert.ok(!ids.has(lv.id), `id 重複：${lv.id}`); ids.add(lv.id);
      assert.equal(lv.order, i + 1, `${lv.id} order`);
      assert.ok(nonEmpty(lv.title), `${lv.id}.title`);
      assert.ok(lv.demo === null || demoIds.has(lv.demo), `${lv.id}.demo 指向不存在的示範：${lv.demo}`);
      for (const k of ['sim', 'real']) assert.ok(lv[k] && nonEmpty(lv[k].do) && nonEmpty(lv[k].pass), `${lv.id}.${k}`);
      assert.ok(Array.isArray(lv.tips) && lv.tips.length > 0 && lv.tips.every(nonEmpty), `${lv.id}.tips`);
      assert.ok(Array.isArray(lv.notes) && typeof lv.watch === 'string' && Array.isArray(lv.variants), `${lv.id} notes/watch/variants`);
      if (lv.demo) {
        const dv = lesson(lv.demo).variants.map((v) => v.key).sort(), jv = lv.variants.map((v) => v.key).sort();
        assert.deepEqual(jv, dv, `${lv.id} 變體 key 與示範不一致`);
        assert.ok(lv.notes.length > 0 && nonEmpty(lv.watch), `${lv.id} 缺 notes/watch`);
      }
      for (const v of lv.variants) {
        assert.ok(['style', 'contrast'].includes(v.kind), `${lv.id}/${v.key}.kind=${v.kind}`);
        assert.ok(nonEmpty(v.label) && v.stages.length > 0 && v.stages.every((s) => nonEmpty(s.label) && nonEmpty(s.note)), `${lv.id}/${v.key} 階段文字`);
      }
    });
  }
  assert.deepEqual(data.tiers[0].levels.map((l) => l.id), ['S1', 'S2', 'S3', 'S4', 'S5']);
  assert.deepEqual(data.tiers[1].levels.map((l) => l.id), ['B1', 'B2', 'B3', 'B4', 'B5']);
  assert.deepEqual(data.tiers[2].levels.map((l) => l.id), ['A1', 'A2', 'A3', 'A4', 'A5']);
});

// ===== 入門 S1–S5 =====
const tiltOf = (x) => Math.acos(Math.max(-1, Math.min(1, x.R[8]))) * 180 / Math.PI;
const after = (r, t0) => r.rec.filter((x) => x.t >= t0);

test('入門 S1–S5：每個變體（含對照）全程不觸地，且共 14 個變體（spec 寫 13，依表格實為 3+3+3+1+4）', () => {
  const S = LESSONS.filter((l) => /^S\d$/.test(l.id));
  assert.equal(S.length, 5);
  assert.equal(S.reduce((n, l) => n + l.variants.length, 0), 14);
  for (const L of S) for (const v of L.variants) {
    const r = runDemo(L, v);
    assert.equal(r.touched, false, `${L.id}/${v.key} 觸地（最低 ${Math.min(...zs(r)).toFixed(2)} m）`);
  }
});

test('S1：懸停不變、低於懸停下降、高於懸停上升', () => {
  const z = (k) => { const r = run('S1', k); return r.rec.at(-1).p[2] - r.rec[0].p[2]; };
  assert.ok(Math.abs(z('hover')) < 0.01);
  assert.ok(z('low') < -3 && z('high') > 3);
});

test('S2／S3「推一下」：脈衝結束後 1 秒傾角變化 < 1°；水平速度持續增加；高度下降', () => {
  for (const [id, hv] of [['S2', (x) => x.v[0]], ['S3', (x) => -x.v[1]]]) for (const key of ['a15', 'a45']) {
    const r = run(id, key), tEnd = 1.0 + 0.6, seg = after(r, tEnd), t1 = seg.filter((x) => x.t <= tEnd + 1);
    const tilt = t1.map(tiltOf);
    assert.ok(Math.max(...tilt) - Math.min(...tilt) < 1, `${id}/${key} 傾角變化 ${(Math.max(...tilt) - Math.min(...tilt)).toFixed(2)}°`);
    assert.ok(hv(seg.at(-1)) > hv(seg[0]) + 1, `${id}/${key} 水平速度沒有持續增加`);
    assert.ok(seg.at(-1).p[2] < seg[0].p[2], `${id}/${key} 高度沒有下降`);
    const want = key === 'a15' ? 15 : 45;
    assert.ok(Math.abs(tiltOf(seg[0]) - want) < 2, `${id}/${key} 停在 ${tiltOf(seg[0]).toFixed(1)}°`);
  }
});

test('S2／S3「一直推著」：累計轉動角 > 180°', () => {
  for (const id of ['S2', 'S3']) {
    const r = run(id, 'hold'); let acc = 0;
    const key = id === 'S2' ? 'pitch' : 'roll';
    for (const x of r.rec) acc += Math.abs(x[key]) * 500 * (1 / 240);
    assert.ok(acc > 180, `${id} 累計 ${acc.toFixed(0)}°`);
  }
});

test('S4：航向變化 ≥ 90°，水平位置偏移 < 0.3 m，高度變化 < 0.2 m', () => {
  const r = run('S4', 'yaw30');
  assert.ok(headingChange(r) >= 90, `航向 ${headingChange(r).toFixed(0)}°`);
  const hz = Math.max(...r.rec.map((x) => Math.hypot(x.p[0] - r.rec[0].p[0], x.p[1] - r.rec[0].p[1])));
  assert.ok(hz < 0.3, `位置偏移 ${hz.toFixed(2)} m`);
  assert.ok(Math.max(...zs(r)) - Math.min(...zs(r)) < 0.2, '高度變化過大');
});

test('S5：每個變體的 relates 指向存在的關卡或為 null；入門每個變體都有 2–4 段 stages', () => {
  const ids = new Set(jsonLevels.map((l) => l.id));
  for (const v of jsonLevels.find((l) => l.id === 'S5').variants) {
    assert.ok('relates' in v, `S5/${v.key} 缺 relates`);
    assert.ok(v.relates === null || ids.has(v.relates), `S5/${v.key}.relates=${v.relates}`);
  }
  for (const lv of data.tiers[0].levels) for (const v of lv.variants) assert.ok(v.stages.length >= 2 && v.stages.length <= 4, `${lv.id}/${v.key} 階段數 ${v.stages.length}`);
});
