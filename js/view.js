// 3D 繪圖、搖桿、高度圖。只畫圖，不持有模擬狀態（狀態由 app.js 傳入）。
import { HOVER, D2R, V, M } from './core.js';
import { forces } from './forces.js';

let chase = null; // 追尾／跟隨鏡頭的平滑狀態
export function resetChase() { chase = null; }

export function makeCam(c, look, W, H, fovDeg, upHint = [0, 0, 1]) {
  const f = V.norm(V.sub(look, c)); let r = V.cross(f, upHint);
  if (V.len(r) < 1e-3) r = [0, -1, 0]; r = V.norm(r);
  return { c, f, r, u: V.cross(r, f), W, H, F: (W / 2) / Math.tan(fovDeg * D2R / 2) };
}
export function camFromBody(p, R, W, H, tiltDeg, fovDeg) {
  const xb = M.col(R, 0), yb = M.col(R, 1), zb = M.col(R, 2), a = tiltDeg * D2R;
  const f = V.add(V.mul(xb, Math.cos(a)), V.mul(zb, Math.sin(a))), u = V.add(V.mul(xb, -Math.sin(a)), V.mul(zb, Math.cos(a)));
  return { c: V.add(p, V.mul(zb, 0.05)), f, r: V.mul(yb, -1), u, W, H, F: (W / 2) / Math.tan(fovDeg * D2R / 2) };
}
const NEAR = 0.15;
function proj(cam, p) { const d = V.sub(p, cam.c), z = V.dot(d, cam.f); if (z < NEAR) return null; return [cam.W / 2 + V.dot(d, cam.r) / z * cam.F, cam.H / 2 - V.dot(d, cam.u) / z * cam.F, z]; }
function seg(ctx, cam, a, b) {
  const da = V.dot(V.sub(a, cam.c), cam.f), db = V.dot(V.sub(b, cam.c), cam.f);
  if (da < NEAR && db < NEAR) return false;
  if (da < NEAR) a = V.add(a, V.mul(V.sub(b, a), (NEAR - da) / (db - da)));
  else if (db < NEAR) b = V.add(b, V.mul(V.sub(a, b), (NEAR - db) / (da - db)));
  const A = proj(cam, a), B = proj(cam, b); if (!A || !B) return false;
  ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); return true;
}
function line(ctx, cam, a, b, color, w) { ctx.beginPath(); if (seg(ctx, cam, a, b)) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); } }

// 天空與地面（低解析度逐像素，倒飛時自然翻轉）
const skyBuf = new Map();
function drawSky(ctx, cam) {
  const bw = 120, bh = Math.round(120 * cam.H / cam.W);
  let b = skyBuf.get(ctx); if (!b || b.h !== bh) { const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh; b = { cv, cx: cv.getContext('2d'), h: bh, img: null }; b.img = b.cx.createImageData(bw, bh); skyBuf.set(ctx, b); }
  const d = b.img.data, sx = cam.W / bw, camZ = cam.c[2];
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const X = ((i + 0.5) * sx - cam.W / 2) / cam.F, Y = -((j + 0.5) * sx - cam.H / 2) / cam.F;
    const rz = cam.f[2] + X * cam.r[2] + Y * cam.u[2], rl = Math.hypot(cam.f[0] + X * cam.r[0] + Y * cam.u[0], cam.f[1] + X * cam.r[1] + Y * cam.u[1], rz);
    const s = rz / rl, o = (j * bw + i) * 4;
    if (s < 0 && camZ > 0) { const k = Math.min(1, -s * 3); d[o] = 30 - 8 * k; d[o + 1] = 34 - 8 * k; d[o + 2] = 30 - 8 * k; }
    else { const k = Math.min(1, Math.max(0, s) * 1.6); d[o] = 74 - 52 * k; d[o + 1] = 92 - 62 * k; d[o + 2] = 112 - 70 * k; }
    d[o + 3] = 255;
  }
  b.cx.putImageData(b.img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(b.cv, 0, 0, cam.W, cam.H);
}
function drawGrid(ctx, cam) {
  const S = 2, N = 22, cx = Math.round(cam.c[0] / S) * S, cy = Math.round(cam.c[1] / S) * S;
  ctx.lineWidth = 1;
  for (let k = -N; k <= N; k++) for (let m = -N; m < N; m += 2) {
    for (const dir of [0, 1]) {
      const a = dir ? [cx + k * S, cy + m * S, 0] : [cx + m * S, cy + k * S, 0];
      const bb = dir ? [cx + k * S, cy + (m + 2) * S, 0] : [cx + (m + 2) * S, cy + k * S, 0];
      const dist = Math.hypot(a[0] - cam.c[0], a[1] - cam.c[1]); const al = 0.2 * (1 - dist / (N * S));
      if (al <= 0) continue;
      ctx.beginPath(); if (seg(ctx, cam, a, bb)) { ctx.strokeStyle = `rgba(200,210,220,${al.toFixed(3)})`; ctx.stroke(); }
    }
  }
}
function drawPole(ctx, cam, pp) {
  const h = pp[2] || 6, a = [pp[0], pp[1], 0], b = [pp[0], pp[1], h];
  const z = V.dot(V.sub([pp[0], pp[1], h / 2], cam.c), cam.f); if (z < NEAR) return;
  const w = Math.max(1.5, 0.22 * cam.F / z);
  line(ctx, cam, a, b, '#8f98a2', w);
  line(ctx, cam, [pp[0], pp[1], h / 2 - 0.1], [pp[0], pp[1], h / 2 + 0.1], '#ff6a1f', w * 1.05);
  const top = proj(cam, b); if (top) { ctx.beginPath(); ctx.arc(top[0], top[1], Math.max(2, 0.25 * cam.F / top[2]), 0, 7); ctx.fillStyle = '#ffe2b8'; ctx.fill(); }
}
function poly(ctx, cam, pts, color, w, dash) {
  ctx.beginPath(); for (let i = 1; i < pts.length; i++) seg(ctx, cam, pts[i - 1], pts[i]);
  ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]);
}
function drawDrone(ctx, cam, sim, layers) {
  const R = sim.R, p = sim.p, xb = M.col(R, 0), yb = M.col(R, 1), zb = M.col(R, 2);
  const at = (x, y, z) => V.add(p, V.mul(xb, x), V.mul(yb, y), V.mul(zb, z));
  // 地面影子＋高度線
  const g = [p[0], p[1], 0];
  line(ctx, cam, g, p, 'rgba(255,255,255,0.25)', 1);
  const sh = proj(cam, g); if (sh) { ctx.beginPath(); ctx.ellipse(sh[0], sh[1], Math.max(2, 0.45 * cam.F / sh[2]), Math.max(1, 0.18 * cam.F / sh[2]), 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(); }
  const A = 0.34, PR = 0.17;
  const motors = [[A, -A, 1], [A, A, 1], [-A, -A, 0], [-A, A, 0]];
  for (const [x, y] of motors) line(ctx, cam, at(0, 0, 0), at(x, y, 0), '#d7dbe0', Math.max(1.5, 0.05 * cam.F / Math.max(1, V.dot(V.sub(p, cam.c), cam.f))));
  for (const [x, y, front] of motors) {
    const pts = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; pts.push(at(x + Math.cos(a) * PR, y + Math.sin(a) * PR, 0.03)); }
    poly(ctx, cam, pts, front ? '#ff6a1f' : '#aab2bb', 2);
  }
  line(ctx, cam, at(0.05, 0, 0.04), at(0.55, 0, 0.12), '#ff6a1f', 2.5); // 鏡頭方向
  // 機身上方：固定長度的半透明細線，油門歸零（推力箭頭消失）或倒置時也看得出機身朝向
  line(ctx, cam, p, V.add(p, V.mul(zb, 0.6)), 'rgba(255,214,170,0.5)', 2);
  // 力的箭頭：全部用 forces.js 的數字（單位 g），1g = 懸停推力的長度 L0
  const Fz = forces(sim), L0 = 1.3, small = cam.W < 600, lay = layers || { thrust: true, comps: true, net: true };
  const at0 = (v) => V.add(p, V.mul(v, L0)), used = [];
  arrow(ctx, cam, p, V.add(p, [0, 0, -L0]), '#ffffff', 2);                                   // 重力 1g，往下
  if (lay.comps) {
    const vt = at0(Fz.vertical), ht = at0(Fz.horizontal), tip = at0(Fz.thrust);
    poly(ctx, cam, [tip, vt], 'rgba(255,255,255,0.3)', 1, [3, 3]);
    poly(ctx, cam, [tip, ht], 'rgba(255,255,255,0.3)', 1, [3, 3]);
    if (Fz.verticalMag > 0.05) arrow(ctx, cam, p, vt, '#3fd0e0', 3, small ? '' : fmtG(Fz.verticalMag), '#3fd0e0', used);
    if (Fz.horizontalMag > 0.05) arrow(ctx, cam, p, ht, '#b78cff', 3, small ? '' : fmtG(Fz.horizontalMag), '#b78cff', used);
  }
  if (lay.thrust && Fz.thrustMag > 0.05) arrow(ctx, cam, p, at0(Fz.thrust), '#ff6a1f', 3, fmtG(Fz.thrustMag), '#ff9a5c', used);
  if (lay.net && Fz.netMag >= 0.05) arrow(ctx, cam, p, at0(Fz.net), '#ffd23f', 4, fmtG(Fz.netMag), '#ffd23f', used);
}
const fmtG = (g) => g.toFixed(1) + 'g';
// 箭頭（線＋跟著方向的三角箭頭頭）＋尖端旁的數值標籤（暗色描邊）；used 記錄已放的標籤位置，太近就往下錯開
function arrow(ctx, cam, a, b, color, w, label, labelColor, used) {
  line(ctx, cam, a, b, color, w);
  const A = proj(cam, a), B = proj(cam, b); if (!A || !B) return;
  const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy); if (len < 5) return;
  const ux = dx / len, uy = dy / len, hs = Math.min(len * 0.6, 5 + w * 2.2);
  ctx.beginPath(); ctx.moveTo(B[0] + ux * hs * 0.4, B[1] + uy * hs * 0.4);
  ctx.lineTo(B[0] - ux * hs * 0.8 - uy * hs * 0.5, B[1] - uy * hs * 0.8 + ux * hs * 0.5);
  ctx.lineTo(B[0] - ux * hs * 0.8 + uy * hs * 0.5, B[1] - uy * hs * 0.8 - ux * hs * 0.5);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  if (!label) return;
  const fs = Math.max(10, Math.min(13, cam.W / 55));
  let x = B[0] + ux * 12, y = B[1] + uy * 12;
  for (let i = 0; i < 4 && used.some((o) => Math.abs(o[0] - x) < 30 && Math.abs(o[1] - y) < fs + 2); i++) y += fs + 3;
  used.push([x, y]);
  ctx.save(); ctx.font = `600 ${fs}px "JetBrains Mono",ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,13,0.9)'; ctx.strokeText(label, x, y);
  ctx.fillStyle = labelColor || color; ctx.fillText(label, x, y); ctx.restore();
}
// 示範的參照物：水平虛線（進場／改出高度）、兩線之間的 Δh、同高的參照塔。座標都在 y=0 的飛行面上
function drawMarks(ctx, cam, M) {
  const fs = Math.max(11, Math.min(14, cam.W / 48));
  ctx.save(); ctx.font = `600 ${fs}px "JetBrains Mono",ui-monospace,monospace`; ctx.textBaseline = 'middle';
  for (const t of M.towers || []) drawPole(ctx, cam, [t.pos[0], t.pos[1], t.h]);
  for (const l of M.lines || []) {
    poly(ctx, cam, [[l.x0, 0, l.z], [l.x1, 0, l.z]], l.color, 1.5, [7, 5]);
    const P = proj(cam, [l.x0, 0, l.z]); if (P) { ctx.textAlign = 'left'; ctx.fillStyle = l.color; ctx.fillText(l.label, P[0] + 4, P[1] - fs * 0.8); }
  }
  const d = M.delta;
  if (d) {
    poly(ctx, cam, [[d.x, 0, d.z0], [d.x, 0, d.z1]], 'rgba(255,255,255,0.85)', 1.5);
    const P = proj(cam, [d.x, 0, (d.z0 + d.z1) / 2]); if (P) { ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('Δh ' + d.text, P[0] + 6, P[1]); }
  }
  ctx.restore();
}
export function sizeCanvas(cv, ratio) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = w / ratio;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, W: w, H: h };
}
export function scene(ctx, cam, S, withDrone) {
  const sim = S.sim;
  drawSky(ctx, cam); drawGrid(ctx, cam);
  const poles = (S.poles || []).map((pp) => ({ pp, z: V.dot(V.sub([pp[0], pp[1], 3], cam.c), cam.f) }));
  const dz = V.dot(V.sub(sim.p, cam.c), cam.f);
  poles.filter((o) => o.z >= dz).sort((a, b) => b.z - a.z).forEach((o) => drawPole(ctx, cam, o.pp));
  if (S.ghost.length) poly(ctx, cam, S.ghost, 'rgba(255,255,255,0.4)', 1.5, [6, 6]);
  if (S.trail.length > 1) poly(ctx, cam, S.trail, 'rgba(255,106,31,0.55)', 2);
  if (S.marks) drawMarks(ctx, cam, S.marks);
  if (withDrone) drawDrone(ctx, cam, sim, S.layers);
  poles.filter((o) => o.z < dz).sort((a, b) => b.z - a.z).forEach((o) => drawPole(ctx, cam, o.pp));
}
// 旁觀鏡頭設定在各示範的 side 欄位（{follow:[...]} 跟隨 或 {pos, look} 固定）；自由練習只用追尾
export function viewCam(W, H, sim, mode, side) {
  if (mode === 'chase') {
    const v = [sim.v[0], sim.v[1], 0], sp = V.len(v); const xb = M.col(sim.R, 0);
    let h = sp > 1.5 ? V.norm(v) : V.norm([xb[0], xb[1], 0.0001]);
    if (!chase) chase = { h, c: V.add(sim.p, V.mul(h, -6), [0, 0, 2.4]) };
    chase.h = V.norm(V.add(V.mul(chase.h, 0.94), V.mul(h, 0.06)));
    const target = V.add(sim.p, V.mul(chase.h, -6), [0, 0, 2.4]);
    chase.c = V.add(V.mul(chase.c, 0.88), V.mul(target, 0.12));
    return makeCam(chase.c, V.add(sim.p, V.mul(chase.h, 1.5)), W, H, 62);
  }
  const s = side || { follow: [-3, -12, 5] };
  if (s.follow) { if (!chase) chase = { c: V.add(sim.p, s.follow) }; chase.c = V.add(V.mul(chase.c, 0.9), V.mul(V.add(sim.p, s.follow), 0.1)); return makeCam(chase.c, V.add(chase.c, V.mul(s.follow, -1)), W, H, 58); }
  return makeCam(s.pos, s.look, W, H, 58);
}


export function drawStick(cv, x, y, tr, isL) {
  const S = cv.clientWidth, dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(S * dpr)) { cv.width = cv.height = Math.round(S * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, S, S);
  const pad = S * 0.12, w = S - 2 * pad, toX = (v) => pad + (v + 1) / 2 * w, toY = (v) => pad + (1 - v) / 2 * w;
  c.fillStyle = '#1c2027'; c.strokeStyle = '#2a2f37'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(pad, pad, w, w, 10); c.fill(); c.stroke();
  c.strokeStyle = '#323843'; c.beginPath(); c.moveTo(toX(0), pad); c.lineTo(toX(0), pad + w); c.moveTo(pad, toY(0)); c.lineTo(pad + w, toY(0)); c.stroke();
  if (isL) { c.strokeStyle = '#3fd0e0'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(pad, toY(HOVER * 2 - 1)); c.lineTo(pad + w, toY(HOVER * 2 - 1)); c.stroke(); c.setLineDash([]); c.fillStyle = '#3fd0e0'; c.font = '10px "JetBrains Mono",monospace'; c.textAlign = 'right'; c.fillText('懸停', pad + w - 4, toY(HOVER * 2 - 1) - 4); }
  c.font = '10px "JetBrains Mono",monospace'; c.fillStyle = '#8d949e'; c.textAlign = 'center';
  c.fillText(isL ? '油門' : 'Pitch 推', S / 2, pad - 4); c.fillText(isL ? '0' : '拉', S / 2, pad + w + 11);
  c.save(); c.translate(pad - 5, S / 2); c.rotate(-Math.PI / 2); c.fillText(isL ? 'Yaw 左' : 'Roll 左', 0, 0); c.restore();
  c.save(); c.translate(pad + w + 5, S / 2); c.rotate(Math.PI / 2); c.fillText(isL ? 'Yaw 右' : 'Roll 右', 0, 0); c.restore();
  c.beginPath(); tr.forEach(([a, b], i) => i ? c.lineTo(toX(a), toY(b)) : c.moveTo(toX(a), toY(b))); c.strokeStyle = 'rgba(255,106,31,0.35)'; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.moveTo(toX(0), toY(isL ? x * 0 : 0)); c.strokeStyle = 'rgba(255,106,31,0.6)';
  const cxp = toX(x), cyp = toY(y);
  c.beginPath(); c.moveTo(isL ? cxp : toX(0), isL ? toY(HOVER * 2 - 1) : toY(0)); c.lineTo(cxp, cyp); c.lineWidth = 2; c.stroke();
  c.beginPath(); c.arc(cxp, cyp, S * 0.075, 0, 7); c.fillStyle = '#ff6a1f'; c.fill(); c.strokeStyle = '#14100c'; c.lineWidth = 2; c.stroke();
}
export function drawAlt(cv, hist, z0) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = 96;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  if (hist.length < 2) return;
  const t1 = hist[hist.length - 1].t, t0 = Math.max(0, t1 - 8);
  let lo = 0, hi = 4; hist.forEach((h) => { if (h.t >= t0) hi = Math.max(hi, h.z + 1); });
  hi = Math.ceil(hi);
  const padL = 30, X = (tt) => padL + (tt - t0) / 8 * (W - padL - 6), Y = (z) => 8 + (1 - (z - lo) / (hi - lo)) * (H - 22);
  c.font = '10px "JetBrains Mono",monospace'; c.fillStyle = '#8d949e'; c.textAlign = 'right'; c.strokeStyle = '#2a2f37'; c.lineWidth = 1;
  const stepz = hi > 16 ? 10 : hi > 8 ? 4 : 2;
  for (let z = 0; z <= hi; z += stepz) { c.beginPath(); c.moveTo(padL, Y(z)); c.lineTo(W - 6, Y(z)); c.stroke(); c.fillText(z + 'm', padL - 4, Y(z) + 3); }
  c.fillText('高度（近 8 秒）', W - 6, H - 2);
  c.beginPath(); c.moveTo(X(t0), Y(z0)); c.lineTo(X(t1), Y(z0)); c.setLineDash([4, 4]); c.strokeStyle = 'rgba(255,255,255,0.4)'; c.stroke(); c.setLineDash([]);
  const pts = hist.filter((h) => h.t >= t0);
  c.beginPath(); pts.forEach((h, i) => i ? c.lineTo(X(h.t), Y(h.z)) : c.moveTo(X(h.t), Y(h.z)));
  c.lineTo(X(t1), Y(0)); c.lineTo(X(pts[0].t), Y(0)); c.closePath(); c.fillStyle = 'rgba(63,208,224,0.10)'; c.fill();
  c.beginPath(); pts.forEach((h, i) => i ? c.lineTo(X(h.t), Y(h.z)) : c.moveTo(X(h.t), Y(h.z))); c.strokeStyle = '#3fd0e0'; c.lineWidth = 2; c.stroke();
  const e = pts[pts.length - 1]; c.beginPath(); c.arc(X(e.t), Y(e.z), 3, 0, 7); c.fillStyle = '#3fd0e0'; c.fill();
}

// FPV 主視角的最小 OSD，直接畫在 canvas 上：中央準星、左下 高度／速度、右下 油門
export function drawOSD(ctx, W, H, { alt, spd, thr }) {
  const fs = Math.max(11, Math.min(16, W / 45)), pad = Math.max(8, W / 60), cx = W / 2, cy = H / 2, g = 5, l = 10;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - g - l, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + l, cy);
  ctx.moveTo(cx, cy - g - l); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + l);
  ctx.stroke();
  ctx.font = `600 ${fs}px "JetBrains Mono",ui-monospace,monospace`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(`ALT ${alt.toFixed(1)} m`, pad, H - pad - fs * 1.3);
  ctx.fillText(`SPD ${spd.toFixed(1)} m/s`, pad, H - pad);
  ctx.textAlign = 'right';
  ctx.fillText(`THR ${(thr * 100).toFixed(0)}%`, W - pad, H - pad);
  ctx.restore();
}
