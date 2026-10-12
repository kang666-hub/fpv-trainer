// 3D 繪圖、搖桿、高度圖。只畫圖，不持有模擬狀態（狀態由 app.js 傳入）。
import { HOVER, D2R, V, M } from './core.js';
import { forces, thrForLevel, arrowTips } from './forces.js';
import { chaseCam, rearCam, startHeading } from './cams.js';
import { parseModel, visibleTris, lodSelect } from './model.js';

let chase = null; // 追尾／跟隨鏡頭的平滑狀態
// 機尾後方距離：桌機用 back，手機（寬 < 600px）用 backM（畫面窄，要拉遠才放得下所有箭頭）
export const rearCfg = (cfg, W) => (cfg ? { ...cfg, back: W < 600 && cfg.backM ? cfg.backM : cfg.back } : undefined);
let chaseSt = null, rearSt = null; // 追尾／機尾後方鏡頭的平滑狀態（cams.js 的 state）
export function resetChase() { chase = null; chaseSt = null; rearSt = null; }

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

// 天空與地面：漸層用低解析度逐像素（漸層平滑，放大看不出來）；天地交界是一條直線，用裁切路徑精確分開，傾斜時不會出現階梯
const skyBuf = new Map();
function skyLayer(cam, L, ground) {
  const { cv, cx, img, bw, bh } = L, d = img.data, sx = cam.W / bw;
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const X = ((i + 0.5) * sx - cam.W / 2) / cam.F, Y = -((j + 0.5) * sx - cam.H / 2) / cam.F;
    const rz = cam.f[2] + X * cam.r[2] + Y * cam.u[2], rl = Math.hypot(cam.f[0] + X * cam.r[0] + Y * cam.u[0], cam.f[1] + X * cam.r[1] + Y * cam.u[1], rz);
    const s = rz / rl, o = (j * bw + i) * 4;
    if (ground) { const k = Math.min(1, Math.abs(s) * 3); d[o] = 30 - 8 * k; d[o + 1] = 34 - 8 * k; d[o + 2] = 30 - 8 * k; }
    else { const k = Math.min(1, Math.max(0, s) * 1.6); d[o] = 74 - 52 * k; d[o + 1] = 92 - 62 * k; d[o + 2] = 112 - 70 * k; }
    d[o + 3] = 255;
  }
  cx.putImageData(img, 0, 0); return cv;
}
const mkLayer = (bw, bh) => { const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh; const cx = cv.getContext('2d'); return { cv, cx, img: cx.createImageData(bw, bh), bw, bh }; };
// 畫面矩形被半平面 g(x,y) = g0 + gx·x + gy·y < 0 切出的多邊形（Sutherland–Hodgman，4 個角）
export function groundPoly(W, H, g0, gx, gy) {
  const pts = [[0, 0], [W, 0], [W, H], [0, H]], g = (p) => g0 + gx * p[0] + gy * p[1], out = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], ga = g(a), gb = g(b);
    if (ga < 0) out.push(a);
    if ((ga < 0) !== (gb < 0)) { const k = ga / (ga - gb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}
export function horizonGround(cam) {
  const gx = cam.r[2] / cam.F, gy = -cam.u[2] / cam.F, g0 = cam.f[2] - gx * cam.W / 2 - gy * cam.H / 2;
  return groundPoly(cam.W, cam.H, g0, gx, gy);
}
function drawSky(ctx, cam) {
  const bw = 120, bh = Math.round(120 * cam.H / cam.W);
  let b = skyBuf.get(ctx);
  if (!b || b.h !== bh) { b = { h: bh, sky: mkLayer(bw, bh), gnd: mkLayer(bw, bh) }; skyBuf.set(ctx, b); }
  const sky = skyLayer(cam, b.sky, false), gnd = cam.c[2] > 0 ? skyLayer(cam, b.gnd, true) : null;
  ctx.imageSmoothingEnabled = true; ctx.drawImage(sky, 0, 0, cam.W, cam.H);
  if (!gnd) return;
  // 射線 z 分量 = 0 的直線：fz + X·rz + Y·uz = 0，X = (x−W/2)/F，Y = −(y−H/2)/F；地面在 < 0 那側
  const poly = horizonGround(cam); if (poly.length < 3) return;
  ctx.save(); ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip();
  ctx.drawImage(gnd, 0, 0, cam.W, cam.H); ctx.restore();
}
// 地面網格：固定格距 2m（和 A2 一樣），範圍半徑 GRID.R；遠處淡出。同一透明度的線段合併成一筆畫，範圍加大也不吃效能
export const GRID = { S: 2, R: 100 };
export const gridSpacing = () => GRID.S;
function drawGrid(ctx, cam, fpv) {
  const { S, R } = GRID, cx = Math.round(cam.c[0] / S) * S, cy = Math.round(cam.c[1] / S) * S, n = Math.ceil(R / S), B = 8, paths = Array.from({ length: B }, () => []);
  for (let k = -n; k <= n; k++) for (let dir = 0; dir < 2; dir++) {
    for (let m = -n; m < n;) {
      const step = Math.abs(m * S) < 40 ? 2 : 6, e = Math.min(n, m + step);                // 近處每 4m 一段、遠處每 12m 一段
      const a = dir ? [cx + k * S, cy + m * S, 0] : [cx + m * S, cy + k * S, 0], bb = dir ? [cx + k * S, cy + e * S, 0] : [cx + e * S, cy + k * S, 0];
      // 第三人稱：水平距離線性淡出；FPV：用鏡頭到線段的 3D 距離，30m 內維持最亮再淡出
      const dh = Math.hypot((a[0] + bb[0]) / 2 - cam.c[0], (a[1] + bb[1]) / 2 - cam.c[1]), d3 = Math.hypot(dh, cam.c[2]);
      const f = fpv ? (d3 <= 30 ? 1 : 1 - (d3 - 30) / (R - 30)) : 1 - dh / R;
      m = e; if (f <= 0) continue;
      paths[Math.min(B - 1, Math.floor(f * B))].push(a, bb);
    }
  }
  ctx.lineWidth = 1;
  paths.forEach((ps, i) => {
    if (!ps.length) return;
    ctx.beginPath(); let any = false; for (let j = 0; j < ps.length; j += 2) any = seg(ctx, cam, ps[j], ps[j + 1]) || any;
    if (any) { ctx.strokeStyle = `rgba(200,210,220,${((fpv ? 0.373 : 0.2) * (i + 0.5) / B).toFixed(3)})`; ctx.stroke(); }
  });
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
// ===== 飛機模型：機身板、四支機臂、四個槳盤、機頭鏡頭。頂面亮、底面暗（看到哪一面就畫哪一種顏色），倒飛一眼可辨 =====
const BODY = { A: 0.34, PR: 0.17 };
// Kodō 機架模型：低多邊形（lowpoly）與精緻版（v2）各自第一次需要時才載入；載入中或失敗都退回舊畫法（不丟錯）
const MODELS = { low: { file: 'kodo_lowpoly.json', state: 'idle', m: null }, hi: { file: 'kodo_v2.json', state: 'idle', m: null } };
let lodPrev = 'low';
export const modelStats = { calls: 0, ms: 0, seam: true, lod: 'low', force: null };
function ensureModel(k) {
  const e = MODELS[k];
  if (e.state !== 'idle' || typeof fetch !== 'function' || typeof location === 'undefined') return;
  e.state = 'loading';
  fetch(new URL('../assets/models/' + e.file, import.meta.url)).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j) => { e.m = parseModel(j, 2 * Math.SQRT2 * BODY.A); e.state = 'ready'; })
    .catch(() => { e.state = 'failed'; });
}
// 槳葉多邊形：沿 +x 的外形，反轉的槳 y 取負；每片槳葉加上相位 a，回傳在機身座標（含縮放）的點
function bladePts(m, pad, spinDir, a, at) {
  const c = Math.cos(a), s = Math.sin(a), out = [];
  for (const [bx, by0] of m.blade) { const by = by0 * spinDir; out.push(at(pad[0] + bx * c - by * s, pad[1] + bx * s + by * c, pad[2])); }
  return out;
}
// 繪製清單：槳只有實心葉（含油門高時的殘影副本），沒有槳盤；回傳給測試用
export function propDrawList(m, thr, t) {
  const spin = t * (6 + 50 * thr), list = [];
  m.pads.forEach((pad, pi) => {
    const front = pad[0] > 0, dir = m.spin[pi];
    const trails = thr > 0.4 ? [[8, 0.25], [16, 0.12]] : [];
    for (let k = 0; k < m.blades; k++) {
      const a = dir * spin + k * Math.PI * 2 / m.blades;
      for (const [deg, al] of trails) list.push({ type: 'blade', pad: pi, front, dir, a: a - dir * deg * Math.PI / 180, alpha: al * Math.min(1, thr / 0.6) });
      list.push({ type: 'blade', pad: pi, front, dir, a, alpha: 0.85 });
    }
  });
  return list;
}
function drawProp(ctx, cam, m, pi, at, items) {
  for (const it of items) {
    if (it.pad !== pi) continue;
    fillPoly(ctx, cam, bladePts(m, m.pads[pi], it.dir, it.a, at), it.front ? `rgba(255,110,40,${it.alpha})` : `rgba(200,205,215,${it.alpha})`, null);
  }
}
function drawModel(ctx, cam, sim, at, sc, m) {
  const t0 = performance.now(), R = sim.R;
  const vt = visibleTris(m, sim.p, R, cam, sc);
  const { order, sx, shade, tri, depth } = vt, seam = modelStats.seam;
  if (!m.pal) m.pal = m.colors.map((c) => Array.from({ length: 16 }, (_, k) => { const b = k / 15; return `rgb(${(c[0] * b) | 0},${(c[1] * b) | 0},${(c[2] * b) | 0})`; }));
  ctx.lineJoin = 'round'; ctx.lineWidth = 0.8;
  // 槳依整顆槳的深度插進三角形排序（遠的先畫）
  const items = propDrawList(m, sim.st.thr, performance.now() / 1000);
  const pd = m.pads.map((pad) => { const q = at(pad[0], pad[1], pad[2]); return V.dot(V.sub(q, cam.c), cam.f); });
  const props = pd.map((d, i) => i).sort((a, b) => pd[b] - pd[a]);
  let pk = 0, last = null;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    while (pk < props.length && pd[props[pk]] >= depth[i]) drawProp(ctx, cam, m, props[pk++], at, items);
    const o = i * 6, x0 = sx[o], y0 = sx[o + 1], x1 = sx[o + 2], y1 = sx[o + 3], x2 = sx[o + 4], y2 = sx[o + 5];
    if (Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) < 1.2) continue;   // 小於約 0.6 px² 的三角形不畫（遠處簡化）
    const col = m.pal[m.cid[tri[i]]][shade[i]];
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
    if (col !== last) { ctx.fillStyle = col; ctx.strokeStyle = col; last = col; }
    ctx.fill();
    if (seam) ctx.stroke();
  }
  while (pk < props.length) drawProp(ctx, cam, m, props[pk++], at, items);
  // FPV 鏡頭方向：從鏡頭位置沿上仰方向的短線
  const zb = M.col(R, 2), cd = V.add(V.mul(M.col(R, 0), Math.cos(m.cam.tilt * D2R)), V.mul(zb, Math.sin(m.cam.tilt * D2R))), q = at(...m.cam.pos);
  line(ctx, cam, q, V.add(q, V.mul(cd, 0.4)), '#ffb078', 2);
  modelStats.calls++; modelStats.ms += performance.now() - t0; modelStats.tris = order.length; modelStats.total = m.n;
}
function fillPoly(ctx, cam, pts, fill, stroke, sw) {
  const P = pts.map((q) => proj(cam, q)); if (P.some((q) => !q)) return;
  ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw || 1; ctx.stroke(); }
}
function drawBody(ctx, cam, sim, at0) {
  const sc = cam.W < 600 ? Math.max(1, Math.min(2.2, 880 / cam.W)) : 1; // 手機寬度：飛機模型隨螢幕寬度放大（400px 約 2.2 倍，機身寬 ≥ 畫面寬 12%）
  const at = (x, y, z) => at0(x * sc, y * sc, z * sc);
  const p = sim.p, zb = M.col(sim.R, 2), dist = Math.max(0.5, V.dot(V.sub(p, cam.c), cam.f));
  const px = 2 * BODY.A * sc * cam.F / dist;                         // 機體在螢幕上的寬度（像素）
  const top = V.dot(zb, V.sub(cam.c, p)) > 0;                    // 鏡頭看到的是頂面還是底面
  const motors = [[BODY.A, -BODY.A, 1], [BODY.A, BODY.A, 1], [-BODY.A, -BODY.A, 0], [-BODY.A, BODY.A, 0]];
  const plate = top ? '#eef1f5' : '#2c3037', armC = top ? '#d7dbe0' : '#5a616b';
  if (px < 26) { // 太遠：簡化成十字機臂＋兩個前槳橘點＋機身點，不要糊成一團
    const c = proj(cam, p); if (!c) return;
    for (const [x, y, front] of motors) { const q = proj(cam, at(x, y, 0)); if (!q) continue; ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = armC; ctx.lineWidth = 1.5; ctx.stroke(); ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1.5, px * 0.09), 0, 7); ctx.fillStyle = front ? '#ff6a1f' : '#aab2bb'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(2, px * 0.12), 0, 7); ctx.fillStyle = plate; ctx.fill(); return;
  }
  lodPrev = modelStats.force || lodSelect(px, lodPrev);               // 遠近分級（hi 與 low 之間有遲滯）
  modelStats.lod = lodPrev;
  if (lodPrev === 'hi') ensureModel('hi');
  ensureModel('low');
  const use = lodPrev === 'hi' && MODELS.hi.m ? MODELS.hi.m : MODELS.low.m;
  if (use) { drawModel(ctx, cam, sim, at, sc, use); return; }
  const spin = performance.now() / 1000 * (6 + 50 * sim.st.thr);   // 槳葉轉動：油門越大轉越快
  const armW = Math.max(1.5, 0.05 * sc * cam.F / dist);
  for (const [x, y] of motors) line(ctx, cam, at(0, 0, 0), at(x, y, 0), armC, armW);
  for (const [x, y, front] of motors) { // 載入前的備用畫法：裸槳（兩片旋轉的槳葉線，沒有槳盤）
    for (let k = 0; k < 2; k++) { const a = spin + k * Math.PI; line(ctx, cam, at(x - Math.cos(a) * BODY.PR, y - Math.sin(a) * BODY.PR, 0.03), at(x + Math.cos(a) * BODY.PR, y + Math.sin(a) * BODY.PR, 0.03), front ? 'rgba(255,170,120,0.9)' : 'rgba(210,216,222,0.8)', 2); }
  }
  // 中心機身板（實心）：頂面亮、底面暗，加一道頂面前後的中線
  fillPoly(ctx, cam, [at(0.22, -0.08, 0), at(0.22, 0.08, 0), at(-0.18, 0.11, 0), at(-0.18, -0.11, 0)], plate, top ? '#9aa3ad' : '#12151a', 1);
  if (top) line(ctx, cam, at(0.18, 0, 0.005), at(-0.14, 0, 0.005), '#ff6a1f', 1.5);
  // 機頭鏡頭：小方塊＋ 25° 朝向的短線
  fillPoly(ctx, cam, [at(0.2, -0.045, 0.01), at(0.27, -0.045, 0.01), at(0.27, 0.045, 0.01), at(0.2, 0.045, 0.01)], '#ff6a1f', '#14100c', 1);
  const cd = V.add(V.mul(M.col(sim.R, 0), Math.cos(25 * D2R)), V.mul(zb, Math.sin(25 * D2R)));
  line(ctx, cam, at(0.27, 0, 0.03), V.add(at(0.27, 0, 0.03), V.mul(cd, 0.4)), '#ffb078', 2);
}
function drawDrone(ctx, cam, sim, layers) {
  const R = sim.R, p = sim.p, xb = M.col(R, 0), yb = M.col(R, 1), zb = M.col(R, 2);
  const at = (x, y, z) => V.add(p, V.mul(xb, x), V.mul(yb, y), V.mul(zb, z));
  // 地面影子＋高度線
  const g = [p[0], p[1], 0];
  line(ctx, cam, g, p, 'rgba(255,255,255,0.25)', 1);
  const sh = proj(cam, g); if (sh) { ctx.beginPath(); ctx.ellipse(sh[0], sh[1], Math.max(2, 0.45 * cam.F / sh[2]), Math.max(1, 0.18 * cam.F / sh[2]), 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(); }
  drawBody(ctx, cam, sim, at);
  // 機身上方：固定長度的半透明細線，油門歸零（推力箭頭消失）或倒置時也看得出機身朝向
  line(ctx, cam, p, V.add(p, V.mul(zb, 0.6)), 'rgba(255,214,170,0.5)', 2);
  // 力的箭頭：全部用 forces.js 的數字（單位 g），1g = 懸停推力的長度 L0
  const Fz = forces(sim), L0 = 1.3, small = cam.W < 600, lay = layers || { thrust: true, comps: true, net: true };
  const T = arrowTips(sim, L0), used = [];   // used：收集標籤，箭頭都畫完再統一放（合力優先）
  arrow(ctx, cam, p, V.add(p, [0, 0, -L0]), '#ffffff', 2);                                   // 重力 1g，往下
  if (lay.comps) {
    const vt = T.vertical, ht = T.horizontal, tip = T.thrust;
    poly(ctx, cam, [tip, vt], 'rgba(255,255,255,0.3)', 1, [3, 3]);
    poly(ctx, cam, [tip, ht], 'rgba(255,255,255,0.3)', 1, [3, 3]);
    if (Fz.verticalMag > 0.05) arrow(ctx, cam, p, vt, '#3fd0e0', 3, small ? '' : fmtG(Fz.verticalMag), '#3fd0e0', used, 2, Fz.verticalMag);
    if (Fz.horizontalMag > 0.05) arrow(ctx, cam, p, ht, '#b78cff', 3, small ? '' : fmtG(Fz.horizontalMag), '#b78cff', used, 2, Fz.horizontalMag);
  }
  if (lay.thrust && Fz.thrustMag > 0.05) arrow(ctx, cam, p, T.thrust, '#ff6a1f', 3, fmtG(Fz.thrustMag), '#ff9a5c', used, 1, Fz.thrustMag);
  if (lay.net && Fz.netMag >= 0.05) arrow(ctx, cam, p, T.net, '#ffd23f', 4, fmtG(Fz.netMag), '#ffd23f', used, 0, Fz.netMag);
  flushLabels(ctx, cam, used, small);
}
const fmtG = (g) => g.toFixed(1) + 'g';
// 箭頭（線＋跟著方向的三角箭頭頭）＋尖端旁的數值標籤（暗色描邊）；used 記錄已放的標籤位置，太近就往下錯開
function arrow(ctx, cam, a, b, color, w, label, labelColor, used, prio = 1, mag = 1) {
  line(ctx, cam, a, b, color, w);
  const A = proj(cam, a), B = proj(cam, b); if (!A || !B) return;
  const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy); if (len < 5) return;
  const ux = dx / len, uy = dy / len, hs = Math.min(len * 0.6, 5 + w * 2.2);
  ctx.beginPath(); ctx.moveTo(B[0] + ux * hs * 0.4, B[1] + uy * hs * 0.4);
  ctx.lineTo(B[0] - ux * hs * 0.8 - uy * hs * 0.5, B[1] - uy * hs * 0.8 + ux * hs * 0.5);
  ctx.lineTo(B[0] - ux * hs * 0.8 + uy * hs * 0.5, B[1] - uy * hs * 0.8 - ux * hs * 0.5);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  if (label && mag >= 0.3 && used) used.push({ x: B[0] + ux * 12, y: B[1] + uy * 12, text: label, color: labelColor || color, prio }); // 箭頭長度 < 0.3g 不標
}
// 數值標籤（暗色描邊）：合力優先；桌機太近就往下錯開，手機（small）太近就只留優先的那個
function flushLabels(ctx, cam, labels, small) {
  const fs = Math.max(10, Math.min(13, cam.W / 55)), placed = [];
  ctx.save(); ctx.font = `600 ${fs}px "JetBrains Mono",ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of labels.sort((p, q) => p.prio - q.prio)) {
    let { x, y } = l;
    const clash = () => placed.some((o) => Math.abs(o[0] - x) < 34 && Math.abs(o[1] - y) < fs + 2);
    if (small) { if (clash()) continue; }
    else for (let i = 0; i < 4 && clash(); i++) y += fs + 3;
    placed.push([x, y]);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,13,0.9)'; ctx.strokeText(l.text, x, y);
    ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
  }
  ctx.restore();
}
// 示範的參照物：水平虛線（進場／改出高度）、兩線之間的 Δh、同高的參照塔。座標都在 y=0 的飛行面上
// 起始高度參考面：約 20m × 20m、以起始位置為中心、固定在起始高度的半透明網格（比地面網格淡）。飛機慢慢下沉時看得到它離開這片網格
function drawRefPlane(ctx, cam, pl) {
  const H = 10, S = 2; ctx.lineWidth = 1;
  for (let k = -H; k <= H; k += S) {
    for (const [a, b] of [[[pl.x + k, pl.y - H, pl.z], [pl.x + k, pl.y + H, pl.z]], [[pl.x - H, pl.y + k, pl.z], [pl.x + H, pl.y + k, pl.z]]]) {
      ctx.beginPath(); if (seg(ctx, cam, a, b)) { ctx.strokeStyle = k === 0 ? 'rgba(120,200,255,0.30)' : 'rgba(120,200,255,0.16)'; ctx.stroke(); }
    }
  }
  poly(ctx, cam, [[pl.x - H, pl.y - H, pl.z], [pl.x + H, pl.y - H, pl.z], [pl.x + H, pl.y + H, pl.z], [pl.x - H, pl.y + H, pl.z], [pl.x - H, pl.y - H, pl.z]], 'rgba(120,200,255,0.35)', 1.2);
}
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
// 這個畫面要畫哪些東西（純函式，測試用）：FPV（withDrone 為 false）只看地面網格，起始高度參考面只在第三人稱畫，否則 FPV 裡會變成一片空中網格
export function scenePlan(S, withDrone) {
  return { ground: true, refPlane: !!withDrone && !!S.refPlane, drone: !!withDrone };
}
export function scene(ctx, cam, S, withDrone) {
  const sim = S.sim, plan = scenePlan(S, withDrone);
  drawSky(ctx, cam); if (plan.ground) drawGrid(ctx, cam, !withDrone);
  const poles = (S.poles || []).map((pp) => ({ pp, z: V.dot(V.sub([pp[0], pp[1], 3], cam.c), cam.f) }));
  const dz = V.dot(V.sub(sim.p, cam.c), cam.f);
  poles.filter((o) => o.z >= dz).sort((a, b) => b.z - a.z).forEach((o) => drawPole(ctx, cam, o.pp));
  if (S.ghost.length) poly(ctx, cam, S.ghost, 'rgba(255,255,255,0.4)', 1.5, [6, 6]);
  if (S.trail.length > 1) poly(ctx, cam, S.trail, 'rgba(255,106,31,0.55)', 2);
  if (plan.refPlane) drawRefPlane(ctx, cam, S.refPlane);
  if (S.marks) drawMarks(ctx, cam, S.marks);
  if (withDrone) drawDrone(ctx, cam, sim, S.layers);
  poles.filter((o) => o.z < dz).sort((a, b) => b.z - a.z).forEach((o) => drawPole(ctx, cam, o.pp));
}
// 旁觀鏡頭設定在各示範的 side 欄位（{follow:[...]} 跟隨 或 {pos, look} 固定）；自由練習只用追尾
export function viewCam(W, H, sim, mode, side, rear, dt = 1 / 60) {
  if (mode === 'rear' && rear) { rearSt = rearCam(sim, rear.heading, rearSt, dt, rearCfg(rear.cfg, W)); return makeCam(rearSt.pos, rearSt.look, W, H, W < 600 ? 50 : 62); } // 機尾後方：位置跟著飛機、方向固定
  if (mode === 'chase') { chaseSt = chaseCam(sim, chaseSt, dt); return makeCam(chaseSt.c, chaseSt.look, W, H, W < 600 ? 50 : 62); }
  const s = side || { follow: [-3, -12, 5] };
  const fov = W < 600 ? 46 : 58;  // 手機寬度：鏡頭拉近，飛機在畫面上比較大
  if (s.follow) { const goal = V.add(sim.p, s.follow, V.mul(sim.v, s.lead ?? 0.17)); if (!chase) chase = { c: goal }; chase.c = V.add(V.mul(chase.c, 0.9), V.mul(goal, 0.1)); return makeCam(chase.c, V.add(chase.c, V.mul(s.follow, -1)), W, H, fov); } // lead：往速度方向預先移動一點，高速時飛機和力的箭頭才不會被畫面邊緣切掉
  return makeCam(s.pos, s.look, W, H, fov);
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

// 互動單元的小圖：y = f(x) 曲線、上限水平線、臨界交點、目前滑桿位置的點。文字由呼叫端從 lessons.json 傳進來
export function drawCurve(cv, def, x, tx) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight || 150;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const pl = 46, pr = 8, pt = 8, pb = 26, { x: ax, y: ay } = def;
  const X = (v) => pl + (v - ax.min) / (ax.max - ax.min) * (W - pl - pr), Y = (v) => pt + (1 - (v - ay.min) / (ay.max - ay.min)) * (H - pt - pb);
  c.font = '10px "JetBrains Mono",monospace'; c.fillStyle = '#8d949e'; c.strokeStyle = '#2a2f37'; c.lineWidth = 1; c.textAlign = 'right';
  for (let v = ay.min; v <= ay.max; v += 40) { c.beginPath(); c.moveTo(pl, Y(v)); c.lineTo(W - pr, Y(v)); c.stroke(); c.fillText(v + '%', pl - 4, Y(v) + 3); }
  c.textAlign = 'center'; for (let v = ax.min; v <= ax.max; v += 20) c.fillText(v + '', X(v), H - pb + 12);
  c.fillText(tx.x || '', pl + (W - pl - pr) / 2, H - 2);
  c.save(); c.translate(8, pt + (H - pt - pb) / 2); c.rotate(-Math.PI / 2); c.fillText(tx.y || '', 0, 0); c.restore();
  c.setLineDash([5, 4]); c.strokeStyle = '#ffffff'; c.beginPath(); c.moveTo(pl, Y(def.limit)); c.lineTo(W - pr, Y(def.limit)); c.stroke();
  c.beginPath(); c.moveTo(X(def.cross), Y(ay.min)); c.lineTo(X(def.cross), Y(def.limit)); c.strokeStyle = 'rgba(255,255,255,0.4)'; c.stroke(); c.setLineDash([]);
  c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText(tx.limit || '', pl + 3, Y(def.limit) - 3); c.textAlign = 'center'; c.fillText(tx.cross || '', X(def.cross), Y(ay.min) - 3);
  c.beginPath(); let started = false;
  for (let v = ax.min; v <= ax.max + 1e-9; v += 0.5) { const y = def.f(v); if (!isFinite(y) || y > ay.max) break; if (started) c.lineTo(X(v), Y(y)); else { c.moveTo(X(v), Y(y)); started = true; } }
  c.strokeStyle = '#3fd0e0'; c.lineWidth = 2; c.stroke();
  const yv = Math.min(ay.max, def.f(x)); c.beginPath(); c.arc(X(x), Y(yv), 5, 0, 7); c.fillStyle = def.f(x) > def.limit ? '#ffd23f' : '#ff6a1f'; c.fill(); c.strokeStyle = '#14100c'; c.lineWidth = 2; c.stroke();
}

// 油門–傾角曲線圖（B2）：橫軸傾角 0–90°、縱軸油門 0–100%。曲線＝剛好不掉高的油門（懸停 ÷ cosθ，夾 100%）；曲線上方＝往上、下方＝往下；
// 66.4° 虛線＝油門 100% 也只能撐到這裡。pts：最近約 2 秒的 { tilt, thr } 軌跡，最後一點是當下。文字由呼叫端從 lessons.json 傳進來。
export function drawThrCurve(cv, pts, tx) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight || 140;
  if (!W) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const pl = 34, pr = 8, pt = 8, pb = 24, XM = 110, X = (a) => pl + a / XM * (W - pl - pr), Y = (v) => pt + (1 - v) * (H - pt - pb);
  const cross = Math.acos(HOVER) / D2R, curve = (a) => (a >= 90 ? 1 : Math.min(1, thrForLevel(a).thr));
  // 曲線上方（往上）、下方（往下）的淡色區
  c.beginPath(); c.moveTo(X(0), Y(1)); for (let a = 0; a <= XM; a += 1) c.lineTo(X(a), Y(curve(a))); c.lineTo(X(XM), Y(1)); c.closePath(); c.fillStyle = 'rgba(255,210,63,0.08)'; c.fill();
  c.beginPath(); c.moveTo(X(0), Y(0)); for (let a = 0; a <= XM; a += 1) c.lineTo(X(a), Y(curve(a))); c.lineTo(X(XM), Y(0)); c.closePath(); c.fillStyle = 'rgba(63,208,224,0.08)'; c.fill();
  c.font = '10px "JetBrains Mono",monospace'; c.fillStyle = '#8d949e'; c.strokeStyle = '#2a2f37'; c.lineWidth = 1; c.textAlign = 'right';
  for (const v of [0, 0.5, 1]) { c.beginPath(); c.moveTo(pl, Y(v)); c.lineTo(W - pr, Y(v)); c.stroke(); c.fillText(Math.round(v * 100) + '%', pl - 4, Y(v) + 3); }
  c.textAlign = 'center'; for (const a of [0, 30, 60, 90]) c.fillText(a + '°', X(a), H - pb + 12);
  c.fillText(tx.x || '', pl + (W - pl - pr) / 2, H - 2);
  c.setLineDash([4, 4]); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.moveTo(X(cross), Y(0)); c.lineTo(X(cross), Y(1)); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#fff'; c.textAlign = 'right'; c.fillText(tx.limit || '', X(cross) - 3, Y(0) - 4 - 12);
  c.fillStyle = 'rgba(255,210,63,0.9)'; c.textAlign = 'left'; c.fillText(tx.up || '', pl + 4, Y(1) + 11);
  c.fillStyle = 'rgba(63,208,224,0.9)'; c.fillText(tx.down || '', pl + 4, Y(0) - 4);
  c.beginPath(); for (let a = 0; a <= XM; a += 1) (a ? c.lineTo(X(a), Y(curve(a))) : c.moveTo(X(a), Y(curve(a)))); c.strokeStyle = '#3fd0e0'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#3fd0e0'; c.textAlign = 'left'; c.fillText(tx.level || '', X(4), Y(curve(4)) - 6);
  if (pts.length) {
    c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(X(q.tilt), Y(q.thr)) : c.moveTo(X(q.tilt), Y(q.thr)))); c.strokeStyle = 'rgba(255,106,31,0.6)'; c.lineWidth = 2; c.stroke();
    const e = pts[pts.length - 1]; c.beginPath(); c.arc(X(Math.min(XM, e.tilt)), Y(e.thr), 4.5, 0, 7); c.fillStyle = '#ff6a1f'; c.fill(); c.strokeStyle = '#14100c'; c.lineWidth = 2; c.stroke();
  }
}

// FPV 小畫面的垂直速度讀數（B5、B5a）：往上綠「↑ 4.5 m/s」、往下橘「↓ 2.0 m/s」
export function drawVs(ctx, W, H, vz) {
  const fs = Math.max(10, Math.min(14, W / 18)), up = vz >= 0, txt = `${up ? '↑' : '↓'} ${Math.abs(vz).toFixed(1)} m/s`;
  ctx.save(); ctx.font = `700 ${fs}px "JetBrains Mono",ui-monospace,monospace`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,13,0.9)'; ctx.strokeText(txt, W - 6, H - 6);
  ctx.fillStyle = up ? '#5be37a' : '#ff9a3c'; ctx.fillText(txt, W - 6, H - 6); ctx.restore();
}
