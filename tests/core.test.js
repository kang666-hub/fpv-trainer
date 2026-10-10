import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim, HOVER, euler } from '../js/core.js';
import { thrForLevel, curveSide } from '../js/forces.js';
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

// ===== B2 噴射（Kuan 實測打法）=====
const tiltOf2 = (x) => Math.acos(Math.max(-1, Math.min(1, x.R[8]))) * 180 / Math.PI;
function b2Metrics(key) {
  const r = run('B2', key), m = r.mem.marks, rec = r.rec, z0 = rec[0].p[2];
  const t0 = 1.0, tilts = rec.map(tiltOf2);
  let ip = 0; tilts.forEach((a, i) => { if (a > tilts[ip]) ip = i; });
  const tStart = rec.find((x) => x.t >= t0 && Math.abs(x.pitch) > 0.02).t, tPeak = rec[ip].t;
  const tFlat = m.flat, near = (t) => rec.reduce((a, x) => (Math.abs(x.t - t) < Math.abs(a.t - t) ? x : a));
  const w2 = rec.filter((x) => x.t >= tFlat && x.t <= tFlat + 2).map((x) => x.p[2]);
  const pause = (() => { let n = 0; for (let i = ip; i < rec.length && Math.abs(rec[i].pitch) < 0.03; i++) n++; for (let i = ip - 1; i >= 0 && Math.abs(rec[i].pitch) < 0.03; i--) n++; return n / 240; })();
  return { r, m, rec, z0, tStart, tPeak, tFlat, rise: tPeak - tStart, pull: tFlat - tPeak, pause, maxTilt: tilts[ip],
    bounce: Math.max(...w2) - near(tFlat).p[2], vz1: near(tFlat + 1).v[2], zmin: Math.min(...rec.map((x) => x.p[2])), vpeak: Math.max(...rec.map(speed)), thrAfter: near(tFlat + 0.1).thr,
    thr98: rec.find((x) => x.t >= t0 && x.thr >= 0.98)?.t, near, tilts };
}

test('B2 dive：前傾 0.45–0.7 秒、停頓 ≤ 0.05 秒、拉回 0.25–0.35 秒、前傾 ÷ 拉回 ≥ 1.5；前傾段油門貼著懸停 ÷ cosθ；拉回前段滿油；回平後略低於懸停', () => {
  const d = b2Metrics('dive');
  assert.ok(d.rise >= 0.45 && d.rise <= 0.7, `前傾 ${d.rise.toFixed(3)} 秒`);
  assert.ok(d.pause <= 0.05, `最低點停頓 ${d.pause.toFixed(3)} 秒`);
  assert.ok(d.pull >= 0.25 && d.pull <= 0.35, `拉回 ${d.pull.toFixed(3)} 秒`);
  assert.ok(d.rise / d.pull >= 1.5, `前傾 ÷ 拉回 = ${(d.rise / d.pull).toFixed(2)}`);
  for (const x of d.rec.filter((x) => x.t >= d.tStart && x.t <= d.tPeak)) {
    const want = Math.min(1, thrForLevel(tiltOf2(x)).thr);
    assert.ok(Math.abs(x.thr - want) < 0.05 || x.t > d.tPeak - 0.06, `前傾段油門 ${x.thr.toFixed(2)} vs ${want.toFixed(2)}（t=${x.t.toFixed(2)}）`);
  }
  assert.ok(Math.abs(d.tPeak - d.thr98) < 0.1, `油門到頂與傾角最大相差 ${(d.tPeak - d.thr98).toFixed(3)} 秒`);
  const half = d.rec.filter((x) => x.t >= d.tPeak && x.t <= d.tPeak + d.pull * 0.5);
  assert.ok(half.every((x) => x.thr >= 0.95), '拉回前 50% 油門應 ≥ 95%');
  assert.ok(d.thrAfter <= HOVER + 0.05, `回平後 0.1 秒油門 ${d.thrAfter.toFixed(2)}`);
  assert.ok(d.thrAfter < HOVER, '回平後油門應略低於懸停');
});

test('B2 dive：拉平後 2 秒內最高點 ≤ 拉平點 + 0.6m、1 秒後 |垂直速度| < 0.5；最低高度 ≥ 進場 − 2m；速度峰值 ≥ 12 m/s', () => {
  const d = b2Metrics('dive');
  assert.ok(d.bounce <= 0.6, `彈升 ${d.bounce.toFixed(2)} m`);
  assert.ok(Math.abs(d.vz1) < 0.5, `1 秒後垂直速度 ${d.vz1.toFixed(2)}`);
  assert.ok(d.zmin >= d.z0 - 2, `最低高度 ${d.zmin.toFixed(2)}`);
  assert.ok(d.vpeak >= 12, `速度峰值 ${d.vpeak.toFixed(1)} m/s`);
});

test('B2 wide：油門比傾角最大早 0.15–0.3 秒到頂並維持到收油角；彈升 > dive 且 ≤ 2m；速度峰值 ≥ 12', () => {
  const w = b2Metrics('wide'), d = b2Metrics('dive');
  const lead = w.tPeak - w.thr98;
  assert.ok(lead >= 0.15 && lead <= 0.3, `提早 ${lead.toFixed(3)} 秒`);
  const hold = w.rec.filter((x) => x.t >= w.thr98 && x.t < w.m.release);
  assert.ok(hold.every((x) => x.thr >= 0.98), '到頂後到收油前油門應 ≥ 98%');
  assert.ok(w.thrAfter <= HOVER + 0.05, `回平後 0.1 秒油門 ${w.thrAfter.toFixed(2)}`);
  assert.ok(w.bounce > d.bounce && w.bounce <= 2, `wide 彈升 ${w.bounce.toFixed(2)}、dive ${d.bounce.toFixed(2)}`);
  assert.ok(w.vpeak >= 12, `速度峰值 ${w.vpeak.toFixed(1)}`);
});

function sideShare(r, t0, t1, want) {
  const seg = r.rec.filter((x) => x.t >= t0 && x.t <= t1), n = seg.filter((x) => curveSide(tiltOf2(x), x.thr) === want).length;
  return { n, total: seg.length, share: n / seg.length };
}

test('B2 油門–傾角圖：dive 前傾段 ≥ 80% 在曲線上（level）；slam 開始後 0.3 秒內有 up；balloon 回平後 1 秒 ≥ 80% 是 up', () => {
  const d = b2Metrics('dive'), lv = sideShare(d.r, d.tStart, d.tPeak, 'level');
  assert.ok(lv.share >= 0.8, `dive 前傾段 level 只有 ${(lv.share * 100).toFixed(0)}%`);
  const s = run('B2', 'slam'), up = s.rec.filter((x) => x.t >= 1.0 && x.t <= 1.3).some((x) => curveSide(tiltOf2(x), x.thr) === 'up');
  assert.ok(up, 'slam 開始後 0.3 秒內沒有 up');
  const b = b2Metrics('balloon'), bu = sideShare(b.r, b.tFlat, b.tFlat + 1, 'up');
  assert.ok(bu.share >= 0.8, `balloon 回平後 up 只有 ${(bu.share * 100).toFixed(0)}%`);
});

test('B2 pitchonly：油門全程 = 懸停 ±0.5%；最大傾角時間與 dive 相差 < 0.05；進場 10m、最低高度 ≥ 2m、掉高比 dive 多 > 1m', () => {
  const p = b2Metrics('pitchonly'), d = b2Metrics('dive');
  assert.ok(p.rec.every((x) => x.t < 1.0 || Math.abs(x.thr - HOVER) <= HOVER * 0.005), '油門應固定在懸停');
  assert.ok(Math.abs(p.tPeak - d.tPeak) < 0.05, `最大傾角時間差 ${Math.abs(p.tPeak - d.tPeak).toFixed(3)}`);
  assert.equal(p.z0, 10); assert.ok(p.zmin >= 2, `最低高度 ${p.zmin.toFixed(2)}`);
  assert.ok((p.z0 - p.zmin) - (d.z0 - d.zmin) > 1, '掉高應比 dive 多 1m 以上');
});

test('B2 slam：前 0.5 秒高度上升 > 0.5m；coupled：最大傾角 ≥ dive + 10°，掉高比 dive 多 > 1m；balloon：拉平後 2 秒比拉平點高 ≥ 3m 且前段同 dive', () => {
  const s = b2Metrics('slam'); assert.ok(s.near(1.5).p[2] - s.near(1.0).p[2] > 0.5, '甩油門沒有往上竄');
  const c = b2Metrics('coupled'), d = b2Metrics('dive');
  assert.ok(c.maxTilt >= d.maxTilt + 10, `傾角 ${c.maxTilt.toFixed(1)} vs ${d.maxTilt.toFixed(1)}`);
  assert.ok((c.z0 - c.zmin) - (d.z0 - d.zmin) > 1, `coupled 掉高 ${(c.z0 - c.zmin).toFixed(2)} vs ${(d.z0 - d.zmin).toFixed(2)}`);
  assert.equal(c.r.touched, false);
  const b = b2Metrics('balloon');
  assert.ok(b.near(b.tFlat + 2).p[2] - b.near(b.tFlat).p[2] >= 3, '上浮不足');
  assert.equal(b.m.release, d.m.release, '前段應與 dive 相同');
});

test('B3 飛法：Roll 桿量 > 5% 的時間 < Pitch < Yaw', () => {
  const r = run('B3', 'coord'), on = (ch) => r.rec.find((x) => Math.abs(x[ch]) > 0.05)?.t;
  const [tr, tp, ty] = ['roll', 'pitch', 'yaw'].map(on);
  assert.ok(tr < tp && tp < ty, `順序不對：Roll ${tr}, Pitch ${tp}, Yaw ${ty}`);
});

test('B3：示範與 lessons.json 的變體順序都是 steep, coord, nocomp, toosteep；steep 彎中最大坡度 ≥ 60°', () => {
  const want = ['steep', 'coord', 'nocomp', 'toosteep'];
  assert.deepEqual(lesson('B3').variants.map((v) => v.key), want);
  assert.deepEqual(jsonLevels.find((l) => l.id === 'B3').variants.map((v) => v.key), want);
  const r = run('B3', 'steep'), mx = Math.max(...r.rec.filter((x) => x.t >= 1.5 && x.t < 3.2).map((x) => Math.abs(euler(x.R).roll)));
  assert.ok(mx >= 60, `最大坡度 ${mx.toFixed(1)}°`);
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

// ===== B5a 原地破 S =====
function b5aMetrics(key) {
  const r = run('B5a', key), rec = r.rec, m = r.mem.marks, count = (ch) => { let n = 0, on = false; for (const x of rec) { const a = Math.abs(x[ch]) > 0.05; if (a && !on) n++; on = a; } return n; };
  const angle = (ch) => rec.reduce((s, x) => s + Math.abs(x[ch]) * 500 / 240, 0);
  const last = rec.filter((x) => x.t >= rec.at(-1).t - 1).map((x) => x.p[2]), e0 = euler(rec[0].R), e1 = euler(rec.at(-1).R);
  let dh = e1.yaw - e0.yaw; dh = ((dh + 540) % 360) - 180;
  return { r, m, rec, rollAngle: angle('roll'), pitchAngle: angle('pitch'), rollN: count('roll'), pitchN: count('pitch'), both: rec.filter((x) => Math.abs(x.roll) > 0.05 && Math.abs(x.pitch) > 0.05).length,
    lastRange: Math.max(...last) - Math.min(...last), e1, headingDiff: Math.abs(dh) };
}

test('B5a 兩個飛法：Roll／Pitch 各 180° ± 3°、各只有一次推出去再回中、不同時打；最後水平、航向相反、不觸地、最後 1 秒高度變化 < 0.2m', () => {
  for (const key of ['rollR_pull', 'rollL_push']) {
    const b = b5aMetrics(key);
    assert.ok(Math.abs(b.rollAngle - 180) <= 3, `${key} Roll 轉角 ${b.rollAngle.toFixed(1)}°`);
    assert.ok(Math.abs(b.pitchAngle - 180) <= 3, `${key} Pitch 轉角 ${b.pitchAngle.toFixed(1)}°`);
    assert.equal(b.rollN, 1, `${key} Roll 打桿次數`); assert.equal(b.pitchN, 1, `${key} Pitch 打桿次數`);
    assert.equal(b.both, 0, `${key} Roll 與 Pitch 同時 > 5%`);
    assert.ok(Math.abs(b.e1.roll) < 3 && Math.abs(b.e1.pitch) < 3, `${key} 最後姿態 roll ${b.e1.roll.toFixed(1)} pitch ${b.e1.pitch.toFixed(1)}`);
    assert.ok(Math.abs(b.headingDiff - 180) <= 5, `${key} 航向相差 ${b.headingDiff.toFixed(1)}°`);
    assert.equal(b.r.touched, false, `${key} 觸地`);
    assert.ok(b.lastRange < 0.2, `${key} 最後 1 秒高度變化 ${b.lastRange.toFixed(3)} m`);
  }
});

test('B5a messy：修正打桿次數 > 1 或最後航向偏差 > 10°', () => {
  const b = b5aMetrics('messy');
  assert.ok(b.rollN > 1 || Math.abs(b.headingDiff - 180) > 10, `Roll 打桿 ${b.rollN} 次、航向相差 ${b.headingDiff.toFixed(1)}°`);
});

test('lessons.json：B2 有 8 個變體（4 飛法＋4 對照）、B3／B4 的變體 key、B5a 在 B5 之前', () => {
  const b2 = jsonLevels.find((l) => l.id === 'B2');
  assert.deepEqual(b2.variants.map((v) => v.key), ['dive', 'wide', 'pitchonly', 'jet', 'short', 'balloon', 'slam', 'coupled']);
  assert.deepEqual(b2.variants.map((v) => v.kind), ['style', 'style', 'style', 'style', 'contrast', 'contrast', 'contrast', 'contrast']);
  assert.deepEqual(jsonLevels.find((l) => l.id === 'B3').variants.map((v) => v.key), ['steep', 'coord', 'nocomp', 'toosteep']);
  assert.deepEqual(jsonLevels.find((l) => l.id === 'B4').variants.map((v) => v.key), ['small', 'yawonly', 'smallnocomp']);
  assert.ok(jsonLevels.findIndex((l) => l.id === 'B5a') === jsonLevels.findIndex((l) => l.id === 'B5') - 1);
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
  assert.deepEqual(data.tiers[1].levels.map((l) => l.id), ['B1', 'B2', 'B3', 'B4', 'B5a', 'B5']);
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
  assert.ok(Math.abs(L.plot.f(0) - 40) < 0.01 && Math.abs(L.plot.cross - 66.4) < 0.1);
  const lv = jsonLevels.find((l) => l.id === 'S6');
  assert.ok(lv.readout.line.includes('{tilt}') && lv.readout.warn.includes('{need}') && lv.curve.x && lv.controls[0].key === 'tilt');
});
