// 追尾／機尾後方鏡頭的計算（純函式，無 DOM，Node 可測）。view.js 拿結果去 makeCam。
// dt 是兩次呼叫之間的真實秒數；prev 是上一次回傳的 state（第一次傳 null）。
import { D2R, V, M, clamp } from './core.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur, goal, dt, tau) => V.add(cur, V.mul(V.sub(goal, cur), 1 - Math.exp(-dt / tau)));

// 追尾：鏡頭在飛行方向（速度太慢時用機頭方向）的後方 back、高 up。只有「方向」做平滑：
// 時間常數 tauDir、轉速上限 maxRate，翻 180° 時鏡頭是「繞」過去而不是跳過去；位置照舊快速跟上。
export const CHASE = { back: 6, up: 2.4, look: 1.5, tauDir: 0.4, maxRate: 360 * D2R, tauPos: 0.13 };
export function chaseCam(sim, prev, dt, cfg = CHASE) {
  const sp = Math.hypot(sim.v[0], sim.v[1]), xb = M.col(sim.R, 0);
  const target = sp > 1.5 ? Math.atan2(sim.v[1], sim.v[0]) : Math.atan2(xb[1], xb[0]);
  let psi = prev ? prev.psi : target;
  if (prev) { const step = wrap(target - psi) * (1 - Math.exp(-dt / cfg.tauDir)), lim = cfg.maxRate * dt; psi += clamp(step, -lim, lim); }
  const h = [Math.cos(psi), Math.sin(psi), 0], goal = V.add(sim.p, V.mul(h, -cfg.back), [0, 0, cfg.up]);
  const c = prev ? approach(prev.c, goal, dt, cfg.tauPos) : goal;
  return { psi, c, pos: c, look: V.add(sim.p, V.mul(h, cfg.look)) };
}

// 機尾後方：鏡頭「剛性跟隨」飛機位置（不做位置平滑：平滑會讓鏡頭落後飛機數公尺，箭頭就出鏡），方向固定＝示範開始時機頭正後方
// 往側邊偏 az、俯角 pitchDown。飛機翻轉、回頭飛都不會讓鏡頭轉；往前飛＝遠離觀看者。
// 距離 back 由各示範設定（要讓飛機與所有力的箭頭端點都在畫面內、四邊留 ≥ 8%）。飛機撞地停住（sim.crashed）時鏡頭凍結，不再移動。
export const REAR = { back: 10.8, az: 18 * D2R, pitchDown: 18 * D2R };
export function startHeading(sim) { const xb = M.col(sim.R, 0); return Math.hypot(xb[0], xb[1]) < 0.2 ? 0 : Math.atan2(xb[1], xb[0]); }
export function rearCam(sim, heading, prev, dt, cfg) {
  if (prev && sim.crashed) return prev;
  const k = { ...REAR, ...(cfg || {}) }, a = heading + k.az, c = Math.cos(k.pitchDown);
  const dir = [Math.cos(a) * c, Math.sin(a) * c, -Math.sin(k.pitchDown)];
  const pos = V.sub(sim.p, V.mul(dir, k.back));
  return { pos, look: V.add(pos, V.mul(dir, 20)) };
}
