// 示範腳本與軌跡（從 stick-lab.html 搬出，邏輯未改）。無 DOM。
import { HOVER, D2R, V, M, clamp, euler, track, attFor, DRAG, G } from './core.js';

// ===== 軌跡 =====
function sstep(u) { u = clamp(u, 0, 1); return { s: 3 * u * u - 2 * u * u * u, ds: 6 * u - 6 * u * u, P: u * u * u - u * u * u * u / 2 }; }
function refStraight(t) {
  const Vm = 8, T1 = 3, T2 = 4, T3 = 2.5, z = 3;
  let x, v, a;
  if (t < T1) { const u = t / T1, s = sstep(u); x = Vm * T1 * s.P; v = Vm * s.s; a = Vm / T1 * s.ds; }
  else if (t < T1 + T2) { x = Vm * T1 / 2 + Vm * (t - T1); v = Vm; a = 0; }
  else { const u = (t - T1 - T2) / T3, s = sstep(u); x = Vm * T1 / 2 + Vm * T2 + Vm * T3 * (u - s.P); v = Vm * (1 - s.s); a = -Vm / T3 * s.ds; }
  return { p: [x - 40, 0, z], v: [v, 0, 0], a: [a, 0, 0], psi: 0, psid: 0 };
}
function refCircle(t, R, Vs, z, facing, th0 = -Math.PI / 2) {
  const w = Vs / R, th = th0 + w * t, c = Math.cos(th), s = Math.sin(th);
  return { p: [R * c, R * s, z], v: [-R * w * s, R * w * c, 0], a: [-R * w * w * c, -R * w * w * s, 0], psi: facing === 'center' ? th + Math.PI : th + Math.PI / 2, psid: w };
}
function refTurn(t) {
  if (t < 2) return { p: [-14 + 7 * t, -7, 3], v: [7, 0, 0], a: [0, 0, 0], psi: 0, psid: 0 };
  return refCircle(t - 2, 7, 7, 3, 'path');
}
const S_SP = 6, S_A = 2, S_V = 4, S_K = Math.PI / S_SP;
function refS(t) {
  const x = S_V * t - 3, f = (xx) => xx < 0 ? 0 : 1; // 進場前 3m 直線
  const on = x >= 0 ? 1 : 0;
  const y = on * S_A * Math.sin(S_K * x), vy = on * S_A * S_K * S_V * Math.cos(S_K * x), ay = -on * S_A * S_K * S_K * S_V * S_V * Math.sin(S_K * x);
  const vx = S_V, psi = Math.atan2(vy, vx), psid = (vx * ay) / (vx * vx + vy * vy);
  return { p: [x - 12, y, 2.5], v: [vx, vy, 0], a: [0, ay, 0], psi, psid };
}
export const S_POLES = [0, 1, 2, 3].map((n) => [(n + 0.5) * S_SP - 12, 0]);

// ===== 課程 =====
function scriptCtrl(phases, sim, t, mem, hold) {
  for (const ph of phases) {
    if (t < ph.t1) {
      if (ph.track) return { ...track(sim, ph.track(t)), phase: ph.label };
      if (ph.hold) {
        if (!mem.hold) { const e = euler(sim.R); mem.hold = { p: V.add(sim.p, V.mul([sim.v[0], sim.v[1], 0], 0.8)), psi: e.yaw * D2R }; mem.hold.p[2] = Math.max(sim.p[2], 2); }
        return { ...track(sim, { p: mem.hold.p, v: [0, 0, 0], psi: mem.hold.psi }, 3, 3.5, 9), phase: ph.label };
      }
      return { thr: ph.thr, roll: ph.roll || 0, pitch: ph.pitch || 0, yaw: ph.yaw || 0, phase: ph.label };
    }
  }
  return null;
}

const SPLIT_LEVEL = (t) => ({ p: [-20 + 7 * t, 0, 25], v: [7, 0, 0], psi: 0, psid: 0 });
const INV_HOVER = () => ({ p: [0, 0, 6], v: [0, 0, 0], psi: 0, psid: 0 });

export const LESSONS = [
  {
    id: 'line', title: '直線控高', dur: 10, cam: 'chase',
    ref: refStraight, pathT: [0, 9.5],
    variants: [
      { key: 'ok', label: '正確：前傾同時補油', kind: 'ok' },
      { key: 'thr', label: '錯誤：油門不動', kind: 'bad', mod: 'fixedThr' },
    ],
    notes: [
      '推 Pitch 讓機身前傾，推力有一部分轉成往前，垂直分量就變少。',
      'Acro 模式會維持角度：Pitch 推一下建立前傾後就回中，要減速再往回拉一下。',
      '所以前傾的同時要小幅加油門，把垂直分量補回來；收 Pitch 減速時油門跟著收。',
      'Roll 只修左右偏移，Yaw 只修航向，都是很小的輕點。',
    ],
    watch: '盯青色線（推力的垂直分量）：飛得穩時它的長度幾乎不變。',
  },
  {
    id: 'turn', title: '協調轉彎', dur: 12.6, cam: 'chase',
    ref: refTurn, pathT: [0, 8.3],
    variants: [
      { key: 'ok', label: '正確：Roll 主導 + Yaw 跟隨 + 補油', kind: 'ok' },
      { key: 'yaw', label: '錯誤：只打 Yaw 甩頭', kind: 'bad', mod: 'noRoll' },
      { key: 'thr', label: '錯誤：有 Roll 沒補油', kind: 'bad', mod: 'fixedThr' },
    ],
    notes: [
      'Roll 先帶出傾斜，傾斜才是讓路線轉彎的力量（主導）。',
      'Acro 會維持坡度：Roll 打出需要的傾斜後就回中，出彎時再反打回平。',
      'Yaw 同方向跟著，讓機頭對準新的前進方向（輔助），量比 Roll 小。',
      'Pitch 維持前傾保速度；傾斜越大，油門補越多。',
      '只打 Yaw：機頭轉了，路線卻沒彎，機身側滑往外甩。',
    ],
    watch: '看右桿：進彎那一下 Roll 打出去又回中；之後是左桿 Yaw 持續輕帶、油門比直飛高。',
  },
  {
    id: 'orbit', title: '刷鍋繞柱', dur: 12.6, cam: 'side', poles: [[0, 0]],
    ref: (t) => refCircle(t, 4, 4, 2.5, 'center'), pathT: [0, 6.3],
    variants: [
      { key: 'ok', label: '正確：機頭咬住柱子', kind: 'ok' },
      { key: 'thr', label: '錯誤：沒補油', kind: 'bad', mod: 'fixedThr' },
    ],
    notes: [
      'Yaw 持續往同一方向打，速度要和繞圈速度一致，機頭才會一直對著柱子。',
      '機身同時要有前傾（往柱子拉的向心力）和側傾（維持繞行速度），先用右桿打出這個姿態。',
      '姿態建立後，主要靠左桿 Yaw 穩定帶，右桿只做小修正；油門比懸停高。半徑越小，角度和 Yaw 都越大。',
    ],
    watch: '看 FPV 小畫面：柱子要一直停在畫面中央。',
  },
  {
    id: 's', title: 'S 彎穿梭', dur: 9.5, cam: 'side', poles: S_POLES,
    ref: refS, pathT: [0, 9.5],
    variants: [
      { key: 'ok', label: '正確：提早反打', kind: 'ok' },
      { key: 'late', label: '錯誤：反應慢 0.2 秒', kind: 'bad', mod: 'delay' },
    ],
    notes: [
      '每次換邊，右桿 Roll 從一側打到另一側，Yaw 跟著換方向。',
      '預判：在通過柱子「之前」就開始反打，等到柱子旁邊才打一定晚。',
      '低速練，路線對了再加速。',
    ],
    watch: '看右桿：Roll 在柱子之間就已經回中、換邊。',
  },
  {
    id: 'split', title: '破 S', dur: 7.5, cam: 'side',
    script: (slow) => [
      { t1: 1.0, track: SPLIT_LEVEL, label: '① 平飛進場' },
      { t1: 1.36, thr: 0.12, roll: 1, label: '② 收油 + 半滾成倒飛' },
      { t1: slow ? 2.20 : 1.78, thr: 0.55, pitch: slow ? -0.45 : -0.9, label: slow ? '③ 拉桿太慢，弧線太大' : '③ 往回拉桿穿過下方' },
      { t1: 99, hold: true, label: '④ 改出，補油穩住' },
    ],
    variants: [
      { key: 'ok', label: '正確：果斷拉桿', kind: 'ok' },
      { key: 'slow', label: '錯誤：拉桿太慢', kind: 'bad', slow: true },
    ],
    notes: [
      '先收油，再半滾成倒飛，這時推力朝下，不要給油。',
      '接著往回拉 Pitch，機頭往地面方向穿過，畫出下半圈。',
      '拉到機頭回到水平時補油接住。弧線越小，掉的高度越少。',
    ],
    watch: '看高度圖：拉桿慢一半，掉的高度大約多一倍。',
  },
  {
    id: 'inv', title: '倒置偏航', dur: 6, cam: 'side',
    script: (heavy) => [
      { t1: 0.8, track: INV_HOVER, label: '① 懸停' },
      { t1: 1.5, thr: 0.95, label: '② 推油往上衝，先存高度' },
      { t1: 1.86, thr: 0.05, roll: 1, label: heavy ? '③ 翻成倒置' : '③ 收油 + 翻成倒置' },
      { t1: 2.31, thr: heavy ? 0.65 : 0.05, yaw: 1, label: heavy ? '④ 倒置還給油，推力把飛機往下推' : '④ 倒置打 Yaw（油門幾乎歸零）' },
      { t1: 2.67, thr: heavy ? 0.65 : 0.05, roll: 1, label: '⑤ 再翻 180° 回正' },
      { t1: 99, hold: true, label: '⑥ 補油接住' },
    ],
    variants: [
      { key: 'ok', label: '正確：先衝高、倒置收油', kind: 'ok' },
      { key: 'heavy', label: '錯誤：倒置還給油', kind: 'bad', heavy: true },
    ],
    notes: [
      '穿越機倒置時推力朝下，沒辦法「懸」在空中，一定會往下掉。',
      '所以「不掉高」靠的是：翻之前先推油往上衝，把高度存起來。',
      '倒置期間油門接近歸零，不然推力會把飛機往地面推。',
      '倒置時打右 Yaw，從上往下看機頭是逆時針轉，FPV 畫面裡地面在上方旋轉。',
    ],
    watch: '看高度圖：正確做法翻完回到差不多的高度。',
  },
];

export function lessonStart(L, sim) {
  if (L.ref) { const r = L.ref(0); sim.reset(r.p, r.v, attFor(r)); sim.st = { thr: HOVER, yaw: 0, pitch: 0, roll: 0 }; }
  else {
    const r = L.id === 'split' ? SPLIT_LEVEL(0) : INV_HOVER();
    sim.reset(r.p, r.v, attFor(r));
  }
}

export function lessonCtrl(L, varr, sim, t, mem) {
  let c;
  if (L.ref && varr.mod === 'noRoll') {
    const r = L.ref(t), sp = Math.hypot(r.v[0], r.v[1]);
    c = { ...track(sim, { v: [Math.cos(r.psi) * sp, Math.sin(r.psi) * sp, 0], p: [sim.p[0], sim.p[1], r.p[2]], psi: r.psi, psid: r.psid }, 4, 3.2), phase: null };
    c.roll = Math.max(-1, Math.min(1, -euler(sim.R).roll * 8 / 500)); // 不壓坡度，只維持水平
  } else if (L.ref) { c = { ...track(sim, L.ref(t)), phase: null }; }
  else { c = scriptCtrl(L.script(!!(varr.slow || varr.heavy)), sim, t, mem); }
  if (varr.mod === 'fixedThr') c.thr = HOVER;
  if (varr.mod === 'delay') {
    mem.buf = mem.buf || [];
    mem.buf.push({ t, c });
    while (mem.buf.length > 1 && mem.buf[1].t <= t - 0.13) mem.buf.shift();
    const old = mem.buf[0].t <= t - 0.13 ? mem.buf[0].c : { roll: 0, yaw: 0 };
    c = { ...c, roll: old.roll, yaw: old.yaw };
  }
  return c;
}

// 自由練習（沒有示範腳本）
export const FREE = { id: 'free', title: '自由練習', free: true, cam: 'chase', poles: [...S_POLES, [0, -9]],
  variants: [{ key: 'ok', label: '鍵盤或拖曳搖桿', kind: 'ok' }],
  notes: ['Acro 模式不會自動回平：右桿放開，飛機維持當下角度。', '先練懸停：找出油門剛好不升不降的位置（約 40%）。', '再練直線前飛，邊推 Pitch 邊補油，看青色線有沒有碰到白線。'],
  watch: '觸控螢幕可以兩指同時拖兩支搖桿；電腦用鍵盤比較好控。' };
