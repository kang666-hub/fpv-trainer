// 示範腳本與軌跡。無 DOM。文字（標題、說明、階段說明）一律在 data/lessons.json，這裡只放動作本身。
// 新增動作：在 LESSONS 加一筆（id 要和 lessons.json 的 demo 欄位一致），再到 lessons.json 補文字。
import { HOVER, D2R, G, TMAX, DRAG, V, clamp, euler, track, attFor, yawOnly, Sim } from './core.js';

const DT = 1 / 240;
const wrapDeg = (a) => ((a + 540) % 360) - 180;
const ramp = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };      // 0→1 平滑
const dramp = (u) => (u <= 0 || u >= 1 ? 0 : 6 * u * (1 - u));                 // ramp 的導數（對 u）

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
// 直線進場 → 圓弧（逆時針，圓心在原點）→ 直線出彎。delta：機頭相對路線切線「朝圓心」偏多少（弧度），進出彎各用 0.5 秒平滑過渡
function refTurn(t, P) {
  const { T0, R, V: Vs, z, ang } = P, delta = P.delta || 0, w = Vs / R, Tc = ang / w, th0 = -Math.PI / 2;
  const rt = P.rt || 0.5; // 機頭偏向（delta）進出彎的過渡時間；softA 時向心加速度也跟著慢慢加上去
  const dl = delta * (ramp((t - T0) / rt) - ramp((t - T0 - Tc) / rt));
  const dld = delta * ((dramp((t - T0) / rt) - dramp((t - T0 - Tc) / rt)) / rt);
  if (t < T0) return { p: [-Vs * (T0 - t), -R, z], v: [Vs, 0, 0], a: [0, 0, 0], psi: dl, psid: dld };
  if (t < T0 + Tc) {
    const th = th0 + w * (t - T0), c = Math.cos(th), s = Math.sin(th);
    const as = P.softA ? ramp((t - T0) / rt) : 1;
    return { p: [R * c, R * s, z], v: [-R * w * s, R * w * c, 0], a: [-R * w * w * c * as, -R * w * w * s * as, 0], psi: th + Math.PI / 2 + dl, psid: w + dld };
  }
  const the = th0 + ang, ce = Math.cos(the), se = Math.sin(the), tt = t - T0 - Tc, ve = [-Vs * se, Vs * ce, 0];
  return { p: [R * ce + ve[0] * tt, R * se + ve[1] * tt, z], v: ve, a: [0, 0, 0], psi: the + Math.PI / 2 + dl, psid: dld };
}
// 8 字：兩個相切圓，原點是切點，兩圈都以 +x 方向通過切點（先逆時針、再順時針）
const EIGHT = { R: 6, V: 6, z: 3 };
function refEight(t) {
  const { R, V: Vs, z } = EIGHT, w = Vs / R, T1 = 2 * Math.PI / w;
  if (t < T1) { const th = -Math.PI / 2 + w * t, c = Math.cos(th), s = Math.sin(th); return { p: [R * c, R + R * s, z], v: [-R * w * s, R * w * c, 0], a: [-R * w * w * c, -R * w * w * s, 0], psi: th + Math.PI / 2, psid: w }; }
  if (t < 2 * T1) { const ph = Math.PI / 2 - w * (t - T1), c = Math.cos(ph), s = Math.sin(ph); return { p: [R * c, -R + R * s, z], v: [R * w * s, -R * w * c, 0], a: [R * w * w * c, R * w * w * s, 0], psi: ph - Math.PI / 2, psid: -w }; }
  return { p: [Vs * (t - 2 * T1), 0, z], v: [Vs, 0, 0], a: [0, 0, 0], psi: 0, psid: 0 };
}
const S_SP = 6, S_A = 2, S_V = 4, S_K = Math.PI / S_SP;
function refS(t) {
  const x = S_V * t - 3, on = x >= 0 ? 1 : 0; // 進場前 3m 直線
  const y = on * S_A * Math.sin(S_K * x), vy = on * S_A * S_K * S_V * Math.cos(S_K * x), ay = -on * S_A * S_K * S_K * S_V * S_V * Math.sin(S_K * x);
  const vx = S_V, psi = Math.atan2(vy, vx), psid = (vx * ay) / (vx * vx + vy * vy);
  return { p: [x - 12, y, 2.5], v: [vx, vy, 0], a: [0, ay, 0], psi, psid };
}
export const S_POLES = [0, 1, 2, 3].map((n) => [(n + 0.5) * S_SP - 12, 0]);

const sampleRef = (ref, t0, t1, dt = 0.08) => { const o = []; for (let s = t0; s <= t1; s += dt) o.push(ref(s).p); return o; };

// ===== 開環腳本（沿用）=====
function scriptCtrl(phases, sim, t, mem) {
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
const INV_HOVER = () => ({ p: [0, 0, 6], v: [0, 0, 0], psi: 0, psid: 0 });

// 把機身撐平的小控制器（P 控制，Acro 下用桿量反向抵消現有傾角）
const levelSticks = (sim) => { const e = euler(sim.R); return { roll: clamp(-e.roll * 8 / 500, -1, 1), pitch: clamp(-e.pitch * 8 / 500, -1, 1) }; };

// ===== 各示範 =====
// B1 直線控高
const B1 = {
  id: 'B1', dur: 10, cam: 'chase', side: { follow: [-2, -11, 4] },
  variants: [{ key: 'comp' }, { key: 'fixed' }],
  start: (sim) => startFromRef(sim, refStraight),
  ctrl: (v, sim, t) => { const c = { ...track(sim, refStraight(t)), phase: null }; if (v.key === 'fixed') c.thr = HOVER; return c; },
  ghost: () => sampleRef(refStraight, 0, 9.5),
  stages: () => [3, 7, 10],
};

// B2 直線噴射：Pitch 壓到推力垂直分量剛好 = 重力（cosθ = 1/HOVER⁻¹），全油門加速，再收油＋Pitch 回正
const B2_T = { hover: 1.0, ramp: 1.3, accEnd: 2.3, recEnd: 2.7 };
const B2 = {
  id: 'B2', dur: 6.5, cam: 'side', side: { follow: [3, -14, 3] },
  variants: [{ key: 'jet', tilt: Math.acos(HOVER) / D2R, bal: true }, { key: 'short', tilt: 30, bal: false }],
  start: (sim) => { sim.reset([-25, 0, 3], [0, 0, 0], yawOnly(0)); sim.st = { thr: HOVER, yaw: 0, pitch: 0, roll: 0 }; },
  ctrl: (v, sim, t, mem) => {
    if (mem.z0 === undefined) mem.z0 = sim.p[2];
    const e = euler(sim.R), inAcc = t >= B2_T.hover && t < B2_T.accEnd;
    const target = inAcc ? v.tilt : 0;
    const cosT = Math.max(0.3, sim.R[8]);
    const fb = v.bal || t < B2_T.hover ? 0.03 * (mem.z0 - sim.p[2]) - 0.03 * sim.v[2] : 0;
    let thr;
    if (inAcc && !v.bal) thr = 1;                 // 對照：傾角不夠還是全油門
    else thr = clamp(HOVER / cosT + fb, 0, 1);    // 油門剛好讓垂直分量 = 重力（傾角大時自然推到頂）
    const phase = t < B2_T.hover ? null : t < B2_T.accEnd ? null : null;
    return { thr, roll: clamp(-e.roll * 8 / 500, -1, 1), pitch: clamp((target - e.pitch) / 12, -1, 1), yaw: 0, phase };
  },
  ghost: () => [],
  stages: () => [B2_T.hover, B2_T.ramp, B2_T.accEnd, B2_T.recEnd, 6.5],
};

// B3 協調轉彎：Roll → Pitch → Yaw → 油門，依序出現（幾何控制器算出理想桿量，再依階段放行各通道）
const B3_P = { T0: 1.0, R: 7, V: 7, z: 3, ang: 1.5 * Math.PI };
const B3_ON = { pitch: 0.4, yaw: 0.8, thr: 1.2 }; // 相對進彎時間
const B3_TC = B3_P.ang / (B3_P.V / B3_P.R);
const B3 = {
  id: 'B3', dur: 8, cam: 'chase', side: { pos: [-15, -17, 11], look: [0, 0, 2] },
  variants: [{ key: 'coord', thrOn: B3_ON.thr }, { key: 'nocomp', thrOn: Infinity }],
  start: (sim) => startFromRef(sim, (t) => refTurn(t, B3_P)),
  ctrl: (v, sim, t, mem) => {
    const c = { ...track(sim, refTurn(t, B3_P)), phase: null }, T0 = B3_P.T0, exit = t >= T0 + B3_TC, rel = t - T0;
    if (t < T0) { mem.thr0 = c.thr; return c; }
    if (!exit) {
      if (rel < B3_ON.pitch) c.pitch = 0;
      if (rel < B3_ON.yaw) c.yaw = 0;
      if (rel < v.thrOn) c.thr = mem.thr0;
    } else if (!isFinite(v.thrOn)) c.thr = mem.thr0;
    return c;
  },
  ghost: () => sampleRef((t) => refTurn(t, B3_P), 0, 7),
  stages: () => [B3_P.T0, B3_P.T0 + B3_ON.pitch, B3_P.T0 + B3_ON.yaw, B3_P.T0 + B3_ON.thr, B3_P.T0 + B3_TC, 8],
};

// B4 Yaw 主導轉彎：機頭相對路線朝圓心偏 delta。delta 越大，Roll 越少、Yaw 越多；平轉時機頭幾乎就是推力水平分量的方向
const B4_A = { T0: 1.0, R: 8, V: 7, z: 3, ang: Math.PI, k: 1, rt: 0.9, softA: true };
const B4_B = { T0: 1.0, R: 7, V: 7, z: 3, ang: Math.PI, k: 0.5, rt: 0.7, softA: true };
const B4_Y = { T0: 1.0, level: 0.4, yawEnd: 1.2, rate: 0.7, z: 3 };
// 機頭跟著「推力水平分量」的方向：k=1 時機頭正對推力（平轉，幾乎不用 Roll），k 越小越接近一般協調轉彎（機頭朝路線）。
// 每步算出控制器想要的水平加速度方向，限制機頭轉速（≤ 300°/s）避免瞬間跳動。
function followNose(sim, ref, mem, k) {
  const ahx = ref.a[0] + DRAG * ref.v[0] + 4 * (ref.p[0] - sim.p[0]) + 3.2 * (ref.v[0] - sim.v[0]);
  const ahy = ref.a[1] + DRAG * ref.v[1] + 4 * (ref.p[1] - sim.p[1]) + 3.2 * (ref.v[1] - sim.v[1]);
  const tang = ref.psi;
  let d = Math.atan2(ahy, ahx) - tang; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  let psi = tang + k * d;
  if (mem.psi !== undefined) {
    let dd = psi - mem.psi; dd -= 2 * Math.PI * Math.round(dd / (2 * Math.PI));
    const lim = 300 * D2R * DT; dd = clamp(dd, -lim, lim); psi = mem.psi + dd;
    mem.psid = (mem.psid ?? 0) * 0.9 + (dd / DT) * 0.1;
  }
  mem.psi = psi;
  return { ...ref, psi, psid: mem.psid ?? ref.psid };
}
const tcOf = (P) => P.ang / (P.V / P.R);
const B4 = {
  id: 'B4', dur: 7, cam: 'chase', side: { pos: [-15, -17, 11], look: [0, 0, 2] },
  variants: [{ key: 'flat', P: B4_A }, { key: 'bank', P: B4_B }, { key: 'yawonly' }],
  start: (sim, v) => startFromRef(sim, (t) => refTurn(t, (v && v.P) || B4_A)),
  ctrl: (v, sim, t, mem) => {
    if (v.key !== 'yawonly') return { ...track(sim, followNose(sim, refTurn(t, v.P), mem, v.P.k)), phase: null };
    if (t < B4_Y.T0) return { ...track(sim, refTurn(t, B4_A)), phase: null };
    // 對照：推力改垂直（撐平），只打 Yaw —— 機頭轉了，路線不會轉
    const rel = t - B4_Y.T0, lv = levelSticks(sim);
    const thr = clamp((G + 4 * (B4_Y.z - sim.p[2]) - 3 * sim.v[2]) / (TMAX * Math.max(0.3, sim.R[8])), 0, 1);
    return { thr, roll: lv.roll, pitch: lv.pitch, yaw: rel >= B4_Y.level && rel < B4_Y.yawEnd ? B4_Y.rate : 0, phase: null };
  },
  ghost: (v) => (v.key === 'yawonly' ? [[-7, -8, 3], [30, -8, 3]] : sampleRef((t) => refTurn(t, v.P), 0, 6.5)),
  stages: (v) => (v.key === 'yawonly'
    ? [B4_Y.T0, B4_Y.T0 + B4_Y.level, B4_Y.T0 + B4_Y.yawEnd, 7]
    : [v.P.T0, v.P.T0 + v.P.rt, v.P.T0 + tcOf(v.P), 7]),
};

// B5 破 S：（可選）微拉高 → 收油半滾成倒置 → 半圈穿過下方 → 改出
const B5_V = 6, B5_R = 3, B5_Z = 25;
const B5_LEVEL = (t) => ({ p: [-B5_V + B5_V * t, 0, B5_Z], v: [B5_V, 0, 0], psi: 0, psid: 0 });
const B5 = {
  id: 'B5', dur: 7, cam: 'side', side: { follow: [3, -19, 4] },
  variants: [{ key: 'pull', pullUp: true }, { key: 'direct', pullUp: false }, { key: 'overthr', pullUp: false, over: true }],
  start: (sim) => startFromRef(sim, B5_LEVEL),
  ctrl: (v, sim, t, mem) => {
    const m = (mem.marks = mem.marks || {});
    if (!m.p1) m.p1 = 1.0;
    if (t < m.p1) return { ...track(sim, B5_LEVEL(t)), phase: null };
    if (v.pullUp && !m.p2) { // 微拉高：小爬升，帶著一點向上速度進半滾
      if (!mem.pu) mem.pu = t;
      const tau = t - mem.pu;
      if (tau < 0.4) { const a = 6; return { ...track(sim, { p: [B5_V * t - B5_V, 0, B5_Z + 0.5 * a * tau * tau], v: [B5_V, 0, a * tau], a: [0, 0, a], psi: 0, psid: 0 }), phase: null }; }
      m.p2 = t;
    }
    if (!m.p2) m.p2 = t;
    if (!m.p3) { // 收油＋半滾（以累計滾轉角收尾，剛好 180°）
      mem.acc = mem.acc || 0;
      const stick = clamp((180 - mem.acc) / 10, -1, 1);
      mem.acc += stick * 500 * DT;
      if (mem.acc >= 179) m.p3 = t;
      return { thr: 0.12, roll: stick, pitch: 0, yaw: 0, phase: null };
    }
    const Rr = B5_R, w = B5_V / Rr, Tl = Math.PI / w;
    if (!mem.lp) mem.lp = { x0: sim.p[0], z0: sim.p[2], t0: t };
    const { x0, z0, t0 } = mem.lp, tau = t - t0;
    if (tau < Tl) {
      const ph = w * tau, s = Math.sin(ph), c = Math.cos(ph);
      const out = { ...track(sim, { p: [x0 + Rr * s, 0, z0 - Rr + Rr * c], v: [B5_V * c, 0, -B5_V * s], a: [-B5_V * w * s, 0, -B5_V * w * c], psi: 0, xh: [c, 0, -s], w: [0, w, 0] }), phase: null };
      if (v.over && tau > 0.4 * Tl) out.thr = 1; // 對照：拉到中段就猛推油門
      return out;
    }
    if (!m.p4) m.p4 = t;
    if (v.over) { // 對照：改出時油門太大
      const lv = levelSticks(sim);
      return { thr: 1, roll: lv.roll, pitch: lv.pitch, yaw: 0, phase: null };
    }
    return { ...track(sim, { p: [x0 - B5_V * (tau - Tl), 0, z0 - 2 * Rr], v: [-B5_V, 0, 0], psi: Math.PI, xh: [-1, 0, 0] }), phase: null };
  },
  ghost: () => [],
  stages: (v) => { const m = probe(B5, v).mem.marks; return v.pullUp ? [m.p1, m.p2, m.p3, m.p4, B5.dur] : [m.p1, m.p3, m.p4, B5.dur]; },
};

// A1 繞柱刷鍋
const A1_P = { large: { R: 6, V: 5 }, small: { R: 3, V: 3.5 }, nocomp: { R: 4, V: 4 } };
const A1 = {
  id: 'A1', dur: 12.6, cam: 'side', side: { pos: [-10, -12, 7.5], look: [0, 0, 2] }, poles: [[0, 0]],
  variants: [{ key: 'large' }, { key: 'small' }, { key: 'nocomp' }],
  start: (sim) => startFromRef(sim, (t) => refCircle(t, 4, 4, 2.5, 'center')),
  ctrl: (v, sim, t) => { const q = A1_P[v.key], c = { ...track(sim, refCircle(t, q.R, q.V, 2.5, 'center')), phase: null }; if (v.key === 'nocomp') c.thr = HOVER; return c; },
  ghost: (v) => { const q = A1_P[v.key]; return sampleRef((t) => refCircle(t, q.R, q.V, 2.5, 'center'), 0, 2 * Math.PI * q.R / q.V); },
  stages: () => [1.5, 12.6],
};
// start 需要依變體半徑，但教室每次 restart 才呼叫一次；A1 用大半徑/小半徑時由 ctrl 的追蹤自行收斂（起點差 ≤ 2m），測試已涵蓋。
A1.start = (sim, v) => { const q = A1_P[(v && v.key) || 'nocomp']; startFromRef(sim, (t) => refCircle(t, q.R, q.V, 2.5, 'center')); };

// A2 8 字
const A2 = {
  id: 'A2', dur: 13.5, cam: 'side', side: { pos: [-20, -22, 14], look: [0, 0, 2] },
  variants: [{ key: 'eight' }],
  start: (sim) => startFromRef(sim, refEight),
  ctrl: (v, sim, t) => ({ ...track(sim, refEight(t)), phase: null }),
  ghost: () => sampleRef(refEight, 0, 2 * (2 * Math.PI * EIGHT.R / EIGHT.V), 0.1),
  stages: () => { const T1 = 2 * Math.PI * EIGHT.R / EIGHT.V; return [T1, T1 + 1, 13.5]; },
};

// A3 S 彎穿梭
const A3 = {
  id: 'A3', dur: 9.5, cam: 'side', side: { pos: [-2, -17, 9], look: [0, 0, 1.5] }, poles: S_POLES,
  variants: [{ key: 'early' }, { key: 'late', delay: true }],
  start: (sim) => startFromRef(sim, refS),
  ctrl: (v, sim, t, mem) => {
    let c = { ...track(sim, refS(t)), phase: null };
    if (v.delay) {
      mem.buf = mem.buf || [];
      mem.buf.push({ t, c });
      while (mem.buf.length > 1 && mem.buf[1].t <= t - 0.13) mem.buf.shift();
      const old = mem.buf[0].t <= t - 0.13 ? mem.buf[0].c : { roll: 0, yaw: 0 };
      c = { ...c, roll: old.roll, yaw: old.yaw };
    }
    return c;
  },
  ghost: () => sampleRef(refS, 0, 9.5),
  stages: () => [0.75, 6.75, 9.5],
};

// A4 倒置偏航
const A4_SCRIPT = (heavy) => [
  { t1: 0.8, track: INV_HOVER, label: '' },
  { t1: 1.5, thr: 0.95 },
  { t1: 1.86, thr: 0.05, roll: 1 },
  { t1: 2.31, thr: heavy ? 0.65 : 0.05, yaw: 1 },
  { t1: 2.67, thr: heavy ? 0.65 : 0.05, roll: 1 },
  { t1: 99, hold: true },
];
const A4 = {
  id: 'A4', dur: 6, cam: 'side', side: { follow: [0, -9, 1] },
  variants: [{ key: 'cut' }, { key: 'keep', heavy: true }],
  start: (sim) => { const r = INV_HOVER(); sim.reset(r.p, r.v, attFor(r)); },
  ctrl: (v, sim, t, mem) => scriptCtrl(A4_SCRIPT(!!v.heavy), sim, t, mem),
  ghost: () => [],
  stages: () => [0.8, 1.5, 1.86, 2.31, 2.67, 6],
};

export const LESSONS = [B1, B2, B3, B4, B5, A1, A2, A3, A4];

function startFromRef(sim, ref) { const r = ref(0); sim.reset(r.p, r.v, attFor(r)); sim.st = { thr: HOVER, yaw: 0, pitch: 0, roll: 0 }; }

export function lessonStart(L, sim, varr) { L.start(sim, varr); }
export function lessonCtrl(L, varr, sim, t, mem) { return L.ctrl(varr, sim, t, mem); }

// ===== 無畫面跑一輪（測試與教室的「桿量比例」共用）=====
export function runDemo(L, varr, dt = DT) {
  const sim = new Sim(), mem = {}, rec = [];
  lessonStart(L, sim, varr);
  let t = 0;
  while (t < L.dur) {
    const c = lessonCtrl(L, varr, sim, t, mem);
    Object.assign(sim.st, { thr: c.thr, roll: c.roll, pitch: c.pitch, yaw: c.yaw });
    sim.step(dt);
    rec.push({ t, thr: c.thr, roll: c.roll, pitch: c.pitch, yaw: c.yaw, p: sim.p.slice(), v: sim.v.slice(), R: sim.R.slice() });
    t += dt;
    if (sim.crashed) break;
  }
  return { sim, rec, mem, crashed: sim.crashed, touched: sim.crashed || rec.some((r) => r.p[2] <= 0) };
}
const probeCache = new Map();
function probe(L, varr) { const k = L.id + ':' + varr.key; if (!probeCache.has(k)) probeCache.set(k, runDemo(L, varr)); return probeCache.get(k); }

// 每個階段的平均桿量：roll／pitch／yaw 取絕對值平均（%），thr 取平均（%）
export function stageProfile(L, varr, run = null) {
  const r = run || runDemo(L, varr), ends = L.stages(varr);
  return ends.map((end, i) => {
    const t0 = i ? ends[i - 1] : 0, seg = r.rec.filter((x) => x.t >= t0 && x.t < end);
    const n = seg.length || 1, avg = (f) => seg.reduce((s, x) => s + f(x), 0) / n * 100;
    return { t0, t1: end, roll: avg((x) => Math.abs(x.roll)), pitch: avg((x) => Math.abs(x.pitch)), yaw: avg((x) => Math.abs(x.yaw)), thr: avg((x) => x.thr), n: seg.length };
  });
}

// 自由練習（沒有示範腳本）。文字在 lessons.json 的 free 欄位。
export const FREE = { id: 'free', free: true, cam: 'chase', poles: [...S_POLES, [0, -9]], variants: [{ key: 'free', kind: 'style', label: '' }], notes: [], watch: '', title: '自由練習' };
