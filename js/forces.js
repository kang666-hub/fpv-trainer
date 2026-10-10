// 力的計算（純函式，無 DOM）。單位一律是「重力倍數 g」：1g = 機體重量。
// 阻力不算進來——合力 = 推力 + 重力，指向哪裡，飛機就往哪裡加速、路線就往哪裡彎（忽略空氣阻力）。
import { G, TMAX, HOVER, D2R, V, M, clamp } from './core.js';

const GRAVITY = [0, 0, -1];

// 目前姿態與油門下的力。thrust＝推力向量；vertical／horizontal＝推力的垂直／水平分量（向量）；net＝推力＋重力
export function forces(sim) {
  const g = clamp(sim.st.thr, 0, 1) * TMAX / G;              // 推力大小（g）
  const thrust = V.mul(M.col(sim.R, 2), g);
  const vertical = [0, 0, thrust[2]], horizontal = [thrust[0], thrust[1], 0];
  const net = V.add(thrust, GRAVITY);
  return {
    thrust, vertical, horizontal, gravity: GRAVITY.slice(), net,
    thrustMag: g, verticalMag: Math.abs(thrust[2]), horizontalMag: Math.hypot(thrust[0], thrust[1]), netMag: V.len(net),
  };
}

// 傾角 θ（度）下維持高度需要的油門 = 懸停 ÷ cosθ。thr 不夾在 1：> 1 代表油門推滿也撐不住（ok = false）
export function thrForLevel(tiltDeg) {
  const c = Math.cos(tiltDeg * D2R);
  if (c <= 1e-6) return { thr: Infinity, ok: false };
  const thr = HOVER / c;
  return { thr, ok: thr <= 1 + 1e-9 };
}

// 油門變化 dThr（0–1）造成的推力變化，在傾角 tiltDeg 下拆成「往上」與「往側」，單位 g：dT = dThr × 推重比；up = dT × cosθ；side = dT × sinθ
export function throttleSplit(tiltDeg, dThr) {
  const dT = dThr * TMAX / G;
  return { up: dT * Math.cos(tiltDeg * D2R), side: dT * Math.sin(tiltDeg * D2R) };
}
