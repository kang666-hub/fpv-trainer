import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim, HOVER, euler } from '../js/core.js';
import { LESSONS, runDemo, stageProfile, controlDefaults, controlValues } from '../js/demos.js';

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
    // S1 從地面起步，停在地面不算觸地：以 crashed 判定；其他示範維持「z ≤ 0 即觸地」
    assert.equal(L.id === 'S1' ? r.crashed : r.touched, false, `${L.id}/${v.key} 觸地（最低 ${Math.min(...zs(r)).toFixed(2)} m）`);
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

test('B2 dive：最低高度 ≥ 1.0m、速度峰值 ≥ 18 m/s、改出後 1 秒 |垂直速度| < 0.3、改出後 2 秒內不上浮（≤ 改出點 + 0.3m）', () => {
  const r = run('B2', 'dive'), m = r.mem.marks;
  assert.ok(m.exit, 'dive 沒有改出');
  assert.equal(r.rec[0].p[2], 3); assert.ok(Math.abs(speed(r.rec[0]) - 5) < 0.01, '進場應為 3m、5 m/s');
  assert.ok(Math.min(...zs(r)) >= 1.0, `最低高度 ${Math.min(...zs(r)).toFixed(2)} m`);
  assert.ok(Math.max(...r.rec.map(speed)) >= 18, `速度峰值 ${Math.max(...r.rec.map(speed)).toFixed(1)} m/s`);
  const near = (t) => r.rec.reduce((a, x) => (Math.abs(x.t - t) < Math.abs(a.t - t) ? x : a)), ex = near(m.exit);
  assert.ok(Math.abs(near(m.exit + 1).v[2]) < 0.3, `改出後 1 秒垂直速度 ${near(m.exit + 1).v[2].toFixed(2)}`);
  const top = Math.max(...r.rec.filter((x) => x.t >= m.exit && x.t <= m.exit + 2).map((x) => x.p[2]));
  assert.ok(top <= ex.p[2] + 0.3, `改出後 2 秒內上浮 ${(top - ex.p[2]).toFixed(2)} m`);
});

test('B2 balloon：前段同 dive，改出後 2 秒比改出點高 ≥ 3m', () => {
  const r = run('B2', 'balloon'), m = r.mem.marks, near = (t) => r.rec.reduce((a, x) => (Math.abs(x.t - t) < Math.abs(a.t - t) ? x : a));
  assert.ok(near(m.exit + 2).p[2] - near(m.exit).p[2] >= 3, `只比改出點高 ${(near(m.exit + 2).p[2] - near(m.exit).p[2]).toFixed(2)} m`);
  const d = run('B2', 'dive');
  assert.equal(m.exit, d.mem.marks.exit, '前 4 步應與 dive 相同');
});

test('B3 飛法：Roll 桿量 > 5% 的時間 < Pitch < Yaw', () => {
  const r = run('B3', 'coord'), on = (ch) => r.rec.find((x) => Math.abs(x[ch]) > 0.05)?.t;
  const [tr, tp, ty] = ['roll', 'pitch', 'yaw'].map(on);
  assert.ok(tr < tp && tp < ty, `順序不對：Roll ${tr}, Pitch ${tp}, Yaw ${ty}`);
});

test('B3 steep：Roll＋油門同時 → Pitch → Yaw（各晚 ≥ 0.25 秒）；最低高度 ≥ 進場 − 0.5m、最後高度差 < 0.5m；彎中平均坡度 60–68°、|Pitch| > |Yaw|；toosteep 1.5 秒內掉高 ≥ 2m', () => {
  const r = run('B3', 'steep'), on = (ch) => r.rec.find((x) => Math.abs(x[ch]) > 0.05)?.t, T0 = 1.0;
  const thr0 = r.rec.find((x) => x.t >= T0 - 0.01).thr, tThr = r.rec.find((x) => x.t >= T0 && x.thr > thr0 + 0.05)?.t; // 油門「補上去」＝比進彎前高 5% 以上
  const [tr, tp, ty] = ['roll', 'pitch', 'yaw'].map(on);
  assert.ok(Math.abs(tr - tThr) <= 0.05, `Roll ${tr} 與油門 ${tThr} 相差 ${Math.abs(tr - tThr).toFixed(3)} 秒`);
  assert.ok(tp - tr >= 0.25, `Pitch 只比 Roll 晚 ${(tp - tr).toFixed(3)} 秒`);
  assert.ok(ty - tp >= 0.25, `Yaw 只比 Pitch 晚 ${(ty - tp).toFixed(3)} 秒`);
  const z = zs(r), z0 = z[0];
  assert.ok(Math.min(...z) >= z0 - 0.5, `最低高度 ${Math.min(...z).toFixed(2)} m（進場 ${z0}）`);
  assert.ok(Math.abs(z.at(-1) - z0) < 0.5, `最後高度 ${z.at(-1).toFixed(2)} m`);
  const Tc = 1.5 * Math.PI / (10 / 4.8), turn = r.rec.filter((x) => x.t >= T0 + 0.5 && x.t < T0 + Tc);
  const avg = (f) => turn.reduce((s, x) => s + f(x), 0) / turn.length;
  const bank = avg((x) => Math.abs(euler(x.R).roll));
  assert.ok(bank >= 60 && bank <= 68, `彎中平均坡度 ${bank.toFixed(1)}°`);
  assert.ok(avg((x) => Math.abs(x.pitch)) > avg((x) => Math.abs(x.yaw)), 'Pitch 應大於 Yaw');
  const c = run('B3', 'toosteep'), zc0 = c.rec.find((x) => x.t >= 1.0).p[2], zc15 = c.rec.find((x) => x.t >= 2.5).p[2];
  assert.ok(zc0 - zc15 >= 2, `1.5 秒只掉 ${(zc0 - zc15).toFixed(2)} m`);
});

test('B4 small（微傾角過彎）：Roll 比 Yaw 早 ≥ 0.15 秒；彎中坡度 15–25°、|Pitch| < 3%、|Yaw| > |Roll|；高度變化 < 0.5m；航向變化 ≥ 90°', () => {
  const r = run('B4', 'small'), on = (ch) => r.rec.find((x) => x.t >= 0.99 && Math.abs(x[ch]) > 0.05)?.t;
  const tr = on('roll'), ty = on('yaw');
  assert.ok(ty - tr >= 0.15, `Yaw 只比 Roll 晚 ${(ty - tr).toFixed(3)} 秒`);
  const P = { T0: 1.0, R: 16.5, V: 8, ang: 0.8 * Math.PI }, Tc = P.ang / (P.V / P.R), turn = r.rec.filter((x) => x.t >= P.T0 + 0.7 && x.t < P.T0 + Tc);
  const avg = (f) => turn.reduce((s, x) => s + f(x), 0) / turn.length;
  const bank = avg((x) => Math.abs(euler(x.R).roll));
  assert.ok(bank >= 15 && bank <= 25, `彎中平均坡度 ${bank.toFixed(1)}°`);
  assert.ok(avg((x) => Math.abs(x.pitch)) < 0.03, `|Pitch| ${(avg((x) => Math.abs(x.pitch)) * 100).toFixed(1)}%`);
  assert.ok(avg((x) => Math.abs(x.yaw)) > avg((x) => Math.abs(x.roll)), 'Yaw 應大於 Roll');
  assert.ok(Math.max(...zs(r)) - Math.min(...zs(r)) < 0.5, `高度變化 ${(Math.max(...zs(r)) - Math.min(...zs(r))).toFixed(2)} m`);
  assert.ok(headingChange(r) >= 90, `航向變化 ${headingChange(r).toFixed(0)}°`);
  assert.equal(r.touched, false);
});

test('B4 smallnocomp：3 秒內掉高 > 0.5m；yawonly：航向轉 ≥ 90° 但路線方向變化 < 30°', () => {
  const r = run('B4', 'smallnocomp'), z0 = r.rec[0].p[2], z3 = r.rec.find((x) => x.t >= 1.0 + 3).p[2];
  assert.ok(z0 - z3 > 0.5, `3 秒只掉 ${(z0 - z3).toFixed(2)} m`);
  const c = run('B4', 'yawonly');
  assert.ok(headingChange(c) >= 90, '只打 Yaw 的航向變化不足');
  assert.ok(pathDirChange(c, 1.0) < 30, `路線方向變化 ${pathDirChange(c, 1.0).toFixed(0)}°`);
});

test('B5：飛法改出後 1 秒高度 ≤ 進場且 |垂直速度| < 0.5；對照改出後高度 ≥ 進場 + 1 m', () => {
  for (const key of ['pull', 'direct', 'overthr']) {
    const r = run('B5', key), m = r.mem.marks, z0 = 12;
    const at = r.rec.reduce((a, x) => (Math.abs(x.t - (m.p4 + 1)) < Math.abs(a.t - (m.p4 + 1)) ? x : a));
    if (key === 'overthr') assert.ok(at.p[2] >= z0 + 1, `對照改出後高度 ${at.p[2].toFixed(2)}`);
    else {
      assert.ok(at.p[2] <= z0, `${key} 改出後高度 ${at.p[2].toFixed(2)} > 進場 ${z0}`);
      assert.ok(Math.abs(at.v[2]) < 0.5, `${key} 改出後垂直速度 ${at.v[2].toFixed(2)}`);
    }
  }
});

test('B5 拉桿穿過下半圈：Pitch 為主（平均 |Pitch| > 10%，|Roll|、|Yaw| < 5%），半滾收在 180° ± 2°', () => {
  for (const v of lesson('B5').variants) {
    const r = runDemo(lesson('B5'), v), prof = stageProfile(lesson('B5'), v, r);
    const i = jsonVariant('B5', v.key).stages.findIndex((s) => s.label === '拉桿穿過下半圈');
    assert.ok(i >= 0, `B5/${v.key} 找不到下半圈階段`);
    const s = prof[i];
    assert.ok(s.roll < 5 && s.yaw < 5 && s.pitch > 10, `B5/${v.key} 下半圈 Roll ${s.roll.toFixed(1)}% Pitch ${s.pitch.toFixed(1)}% Yaw ${s.yaw.toFixed(1)}%`);
    const e = euler(r.rec.find((x) => x.t >= r.mem.marks.p3).R);
    assert.ok(Math.abs(Math.abs(e.roll) - 180) <= 2, `B5/${v.key} 半滾結束滾轉角 ${e.roll.toFixed(1)}°`);
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
  assert.deepEqual(data.tiers[0].levels.map((l) => l.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.deepEqual(data.tiers[1].levels.map((l) => l.id), ['B1', 'B2', 'B3', 'B4', 'B5']);
  assert.deepEqual(data.tiers[2].levels.map((l) => l.id), ['A1', 'A2', 'A3', 'A4', 'A5']);
});

// ===== 入門 S1–S5 =====
const tiltOf = (x) => Math.acos(Math.max(-1, Math.min(1, x.R[8]))) * 180 / Math.PI;
const after = (r, t0) => r.rec.filter((x) => x.t >= t0);

test('入門 S1–S6：每個變體（含對照）全程不觸地，且共 16 個變體（3+3+3+1+4+2）', () => {
  const S = LESSONS.filter((l) => /^S\d$/.test(l.id));
  assert.equal(S.length, 6);
  assert.equal(S.reduce((n, l) => n + l.variants.length, 0), 16);
  for (const L of S) for (const v of L.variants) {
    const r = runDemo(L, v);
    assert.equal(L.id === 'S1' ? r.crashed : r.touched, false, `${L.id}/${v.key} 觸地（最低 ${Math.min(...zs(r)).toFixed(2)} m）`);
  }
});

test('S1 takeoff：從地面起飛，最高點 2–3.5m，最後 1 秒高度變化 < 0.1m，不觸地；under 一直停在地面；over 一路上升', () => {
  const t = run('S1', 'takeoff'), z = zs(t), tail = t.rec.filter((x) => x.t >= t.rec.at(-1).t - 1).map((x) => x.p[2]);
  assert.equal(t.rec[0].p[2], 0); assert.equal(t.crashed, false);
  assert.ok(Math.max(...z) >= 2 && Math.max(...z) <= 3.5, `最高點 ${Math.max(...z).toFixed(2)} m`);
  assert.ok(Math.max(...tail) - Math.min(...tail) < 0.1, '最後 1 秒高度變化過大');
  const u = run('S1', 'under');
  assert.equal(u.crashed, false); assert.ok(zs(u).every((x) => x === 0), 'under 應全程停在地面');
  const o = run('S1', 'over');
  assert.ok(o.rec.at(-1).p[2] > t.rec.at(-1).p[2] + 2, 'over 沒有比 takeoff 高 2m 以上');
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
  assert.equal(jsonVariant('S5', 'rt').relates, 'B3');
  for (const lv of data.tiers[0].levels) for (const v of lv.variants) assert.ok(v.stages.length >= 2 && v.stages.length <= 4, `${lv.id}/${v.key} 階段數 ${v.stages.length}`);
});

// ===== S6 P ↔ T 互動單元 =====
const runS6 = (key, tilt) => runDemo(lesson('S6'), variant('S6', key), 1 / 240, { tilt });
const range = (r) => Math.max(...zs(r)) - Math.min(...zs(r));
const zAt = (r, t) => r.rec.find((x) => x.t >= t).p[2];

test('S6 hold：傾角 30°、45°、60° 全程高度變化 < 0.3m；75° 時 2 秒內掉高 > 1m', () => {
  for (const th of [30, 45, 60]) assert.ok(range(runS6('hold', th)) < 0.3, `${th}° 高度變化 ${range(runS6('hold', th)).toFixed(2)} m`);
  const r = runS6('hold', 75);
  assert.ok(15 - zAt(r, 2) > 1, `75° 2 秒只掉 ${(15 - zAt(r, 2)).toFixed(2)} m`);
});

test('S6 fixed：傾角 45° 時 2 秒內掉高 > 2m', () => {
  const r = runS6('fixed', 45);
  assert.ok(15 - zAt(r, 2) > 2, `2 秒只掉 ${(15 - zAt(r, 2)).toFixed(2)} m`);
});

test('S6：兩個變體在 0–80° 任何傾角都不觸地（掉到 5m 以下就結束該輪）', () => {
  for (const key of ['hold', 'fixed']) for (let th = 0; th <= 80; th += 5) {
    const r = runS6(key, th);
    assert.equal(r.touched, false, `${key} ${th}° 觸地`);
    assert.ok(r.rec.at(-1).t <= 6 + 1e-9);
  }
});

test('示範 controls：預設值、夾範圍，且滑桿的值真的傳進 ctrl（傾角 0° 與 45° 的結果不同）', () => {
  const L = lesson('S6');
  assert.deepEqual(controlDefaults(L), { tilt: 30 });
  assert.deepEqual(controlValues(L, { tilt: 999 }), { tilt: 80 });
  assert.deepEqual(controlValues(L, { tilt: -5 }), { tilt: 0 });
  assert.deepEqual(controlValues(L, {}), { tilt: 30 });
  assert.deepEqual(controlValues(lesson('B1'), { tilt: 10 }), {}); // 沒宣告 controls 的示範：不帶任何值
  const a = runS6('hold', 0), b = runS6('hold', 45);
  assert.ok(Math.abs(euler(b.rec.at(-1).R).pitch - 45) < 2 && Math.abs(euler(a.rec.at(-1).R).pitch) < 2, '滑桿值沒有傳進 ctrl');
});

test('S6 readout／curve：66.4° 為臨界，超過 over = true；曲線在 0° 為 40%', () => {
  const L = lesson('S6'), v = variant('S6', 'hold'), sim = new Sim();
  assert.equal(L.readout(v, sim, { tilt: 60 }).over, false);
  assert.equal(L.readout(v, sim, { tilt: 70 }).over, true);
  assert.ok(Math.abs(L.curve.f(0) - 40) < 0.01 && Math.abs(L.curve.cross - 66.4) < 0.1);
  const lv = jsonLevels.find((l) => l.id === 'S6');
  assert.ok(lv.readout.line.includes('{tilt}') && lv.readout.warn.includes('{need}') && lv.curve.x && lv.controls[0].key === 'tilt');
});
