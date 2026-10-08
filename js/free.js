// 自由練習的通道開關（純函式，Node 可測）。無 DOM、無 localStorage。
import { HOVER } from './core.js';

export const CHANNELS = [['thr', '油門'], ['yaw', 'Yaw'], ['pitch', 'Pitch'], ['roll', 'Roll']];

// 設定檔讀出來的值轉成 { thr, yaw, pitch, roll } 四個布林；缺的、壞的一律當作「開」
export function normChannels(c) {
  const o = {};
  for (const [k] of CHANNELS) o[k] = !(c && typeof c === 'object' && c[k] === false);
  return o;
}

// 把輸入（搖桿／鍵盤／觸控）套上開關：關掉的 Yaw／Pitch／Roll 送 0（Acro 下角度維持），關掉的油門固定在懸停
export function applyChannels(inp, ch) {
  return {
    thr: ch.thr ? inp.thr : HOVER,
    yaw: ch.yaw ? inp.yaw : 0,
    pitch: ch.pitch ? inp.pitch : 0,
    roll: ch.roll ? inp.roll : 0,
  };
}

// 起始點：油門開著就從地面起飛（v1.2）；油門關掉就從空中 5m、懸停油門開始，不然在地面起不來
export function freeStart(ch) {
  return ch.thr ? { p: [-14, -9, 0], thr: 0 } : { p: [-14, -9, 5], thr: HOVER };
}
