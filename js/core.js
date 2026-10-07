// ===== 飛行物理核心（Acro 角速度模式）=====
// 世界座標：x 前、y 左、z 上。機身座標同（x 機頭、y 左、z 機身上方）。
const G = 9.81, TMAX = 2.5 * G, DRAG = 0.45;
const RATE = { roll: 500, pitch: 500, yaw: 400 }; // 滿桿 °/s
const D2R = Math.PI / 180;
const HOVER = G / TMAX; // 懸停油門 0.40

const V = {
  add: (...a) => a.reduce((s, b) => [s[0] + b[0], s[1] + b[1], s[2] + b[2]], [0, 0, 0]),
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
// 3x3 矩陣（列優先陣列），欄 = 機身軸在世界座標的方向
const M = {
  cols: (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]],
  col: (R, i) => [R[i], R[3 + i], R[6 + i]],
  mul: (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; },
  T: (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]],
  vec: (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]],
  exp: (w) => { // Rodrigues
    const th = Math.hypot(w[0], w[1], w[2]);
    if (th < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const [x, y, z] = [w[0] / th, w[1] / th, w[2] / th], c = Math.cos(th), s = Math.sin(th), C = 1 - c;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  },
  ortho: (R) => { const x = V.norm(M.col(R, 0)); const z = V.norm(V.cross(x, M.col(R, 1))); const y = V.cross(z, x); return M.cols(x, y, z); },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const yawOnly = (psi) => { const c = Math.cos(psi), s = Math.sin(psi); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

function euler(R) { // 前傾+、右滾+、航向（逆時針+）
  return { roll: Math.atan2(R[7], R[8]) / D2R, pitch: Math.asin(clamp(-R[6], -1, 1)) / D2R, yaw: Math.atan2(R[3], R[0]) / D2R };
}

class Sim {
  constructor() { this.reset([0, 0, 2], [0, 0, 0], yawOnly(0)); }
  reset(p, v, R) { this.p = p.slice(); this.v = v.slice(); this.R = R.slice(); this.st = { thr: HOVER, yaw: 0, pitch: 0, roll: 0 }; this.crashed = false; this.t = 0; }
  step(dt) {
    if (this.crashed) return;
    const s = this.st;
    const w = [s.roll * RATE.roll * D2R, s.pitch * RATE.pitch * D2R, -s.yaw * RATE.yaw * D2R];
    this.R = M.ortho(M.mul(this.R, M.exp(V.mul(w, dt))));
    const thrust = V.mul(M.col(this.R, 2), clamp(s.thr, 0, 1) * TMAX);
    const a = V.add(thrust, [0, 0, -G], V.mul(this.v, -DRAG));
    this.v = V.add(this.v, V.mul(a, dt));
    this.p = V.add(this.p, V.mul(this.v, dt));
    this.t += dt;
    if (this.p[2] <= 0) {
      if (this.v[2] < -2.5 || this.R[8] < 0.5) { this.crashed = true; this.p[2] = 0; }
      else { this.p[2] = 0; this.v = [this.v[0] * 0.5, this.v[1] * 0.5, 0]; }
    }
  }
}

// 幾何追蹤控制器：輸入目標軌跡 → 算出「好飛手會打的桿」
function desiredAtt(ad, psi) {
  const zb = V.norm(ad), xc = [Math.cos(psi), Math.sin(psi), 0];
  const yb = V.norm(V.cross(zb, xc)), xb = V.cross(yb, zb);
  return M.cols(xb, yb, zb);
}
function track(sim, ref, kp = 4, kd = 3.2, kr = 9) {
  const ad = V.add(ref.a || [0, 0, 0], V.mul(V.sub(ref.p, sim.p), kp), V.mul(V.sub(ref.v, sim.v), kd), V.mul(ref.v, DRAG), [0, 0, G]);
  const Rd = desiredAtt(ad, ref.psi);
  const A = M.mul(M.T(Rd), sim.R), B = M.mul(M.T(sim.R), Rd);
  const S = A.map((v, i) => v - B[i]);
  const eR = [0.5 * S[7], 0.5 * S[2], 0.5 * S[3]];
  const wff = M.vec(M.T(sim.R), [0, 0, ref.psid || 0]);
  const w = V.add(V.mul(eR, -kr), wff);
  return {
    thr: clamp(V.dot(ad, M.col(sim.R, 2)) / TMAX, 0, 1),
    roll: clamp(w[0] / (RATE.roll * D2R), -1, 1),
    pitch: clamp(w[1] / (RATE.pitch * D2R), -1, 1),
    yaw: clamp(-w[2] / (RATE.yaw * D2R), -1, 1),
    Rd,
  };
}
function attFor(ref) { return desiredAtt(V.add(ref.a || [0, 0, 0], V.mul(ref.v, DRAG), [0, 0, G]), ref.psi); }

export { G, TMAX, DRAG, RATE, D2R, HOVER, V, M, clamp, yawOnly, euler, Sim, desiredAtt, track, attFor };
