// kodo 五吋機架低多邊形模型：解析、背面剔除、深度排序（純函式，Node 可測）。繪圖在 view.js。
// 模型座標：x 機頭前、y 左、z 上（mm）；解析後換成公尺並縮放，讓對角軸距等於 targetDiag。
const NEAR = 0.15;

// 每個零件依有號體積檢查三角形繞向：體積為負代表繞向朝內，整個零件翻面，之後統一用「逆時針＝朝外」
export function parseModel(json, targetDiag) {
  const pads = json.pads, d = 2 * Math.hypot(pads[0][0], pads[0][1]);       // mm
  const scale = targetDiag / d;                                             // mm → 畫面公尺
  const k = scale / 0.001;                                                  // 相對真實尺寸的放大倍率
  let n = 0; for (const p of json.parts) n += p.f.length / 3;
  const tris = new Float32Array(n * 9), nrm = new Float32Array(n * 3), cid = new Uint16Array(n), colors = [];
  let t = 0;
  for (const part of json.parts) {
    let ci = colors.indexOf(part.color); if (ci < 0) { ci = colors.length; colors.push(part.color); }
    const v = part.v, f = part.f;
    let vol = 0;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    const flip = vol < 0;
    for (let i = 0; i < f.length; i += 3) {
      const idx = flip ? [f[i], f[i + 2], f[i + 1]] : [f[i], f[i + 1], f[i + 2]];
      for (let j = 0; j < 3; j++) for (let q = 0; q < 3; q++) tris[t * 9 + j * 3 + q] = v[idx[j] * 3 + q] * scale;
      const o = t * 9, ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
      const wx = tris[o + 6] - tris[o], wy = tris[o + 7] - tris[o + 1], wz = tris[o + 8] - tris[o + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
      nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l; cid[t] = ci; t++;
    }
  }
  const rgb = colors.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  return {
    n, tris, nrm, cid, colors: rgb, scale: k,
    pads: pads.map((p) => p.map((x) => x * scale)), propR: json.propRadius * scale, blades: json.propBlades || 3,
    cam: { pos: json.fpvCam.pos.map((x) => x * scale), tilt: json.fpvCam.uptiltDeg },
    // 繪製用暫存（避免每格配置記憶體）
    _sx: new Float32Array(n * 6), _depth: new Float32Array(n), _vis: new Uint32Array(n), _key: new Float64Array(n),
  };
}

// 深度排序：回傳由遠到近的索引（depth 越大越遠）
export function orderByDepth(depths, idx) {
  const o = idx ? Array.from(idx) : Array.from(depths, (_, i) => i);
  return o.sort((a, b) => depths[b] - depths[a]);
}

// 機身姿態 R（列主序 3×3）＋位置 p＋鏡頭 cam{c,f,r,u,F,W,H}＋額外縮放 sc。
// 回傳 { count, order, sx, shade }：order 為可見三角形（由遠到近），sx[i*6..] 為螢幕座標，shade 為 0..15。
export function visibleTris(m, p, R, cam, sc = 1, light = [0.28, -0.35, 0.89]) {
  const { tris, nrm, n } = m, sx = m._sx, dep = m._depth, vis = m._vis, key = m._key;
  const px = p[0], py = p[1], pz = p[2];
  // 鏡頭在機身座標的位置（模型單位，含縮放）：Rᵀ(c − p) / sc
  const cx = cam.c[0] - px, cy = cam.c[1] - py, cz = cam.c[2] - pz;
  const lcx = (R[0] * cx + R[3] * cy + R[6] * cz) / sc, lcy = (R[1] * cx + R[4] * cy + R[7] * cz) / sc, lcz = (R[2] * cx + R[5] * cy + R[8] * cz) / sc;
  const f = cam.f, r = cam.r, u = cam.u, F = cam.F, hw = cam.W / 2, hh = cam.H / 2;
  const cxw = cam.c[0], cyw = cam.c[1], czw = cam.c[2];
  // 光源（世界座標）轉到機身座標
  const L0 = R[0] * light[0] + R[3] * light[1] + R[6] * light[2], L1 = R[1] * light[0] + R[4] * light[1] + R[7] * light[2], L2 = R[2] * light[0] + R[5] * light[1] + R[8] * light[2];
  let count = 0;
  for (let t = 0; t < n; t++) {
    const o = t * 9, q = t * 3;
    const nx = nrm[q], ny = nrm[q + 1], nz = nrm[q + 2];
    if (nx * (lcx - tris[o] * sc) + ny * (lcy - tris[o + 1] * sc) + nz * (lcz - tris[o + 2] * sc) <= 0) continue; // 背面
    let ok = true, dsum = 0;
    for (let j = 0; j < 3; j++) {
      const lx = tris[o + j * 3] * sc, ly = tris[o + j * 3 + 1] * sc, lz = tris[o + j * 3 + 2] * sc;
      const wx = px + R[0] * lx + R[1] * ly + R[2] * lz - cxw, wy = py + R[3] * lx + R[4] * ly + R[5] * lz - cyw, wz = pz + R[6] * lx + R[7] * ly + R[8] * lz - czw;
      const z = wx * f[0] + wy * f[1] + wz * f[2];
      if (z < NEAR) { ok = false; break; }
      sx[count * 6 + j * 2] = hw + (wx * r[0] + wy * r[1] + wz * r[2]) / z * F;
      sx[count * 6 + j * 2 + 1] = hh - (wx * u[0] + wy * u[1] + wz * u[2]) / z * F;
      dsum += z;
    }
    if (!ok) continue;
    const l = Math.max(0, nx * L0 + ny * L1 + nz * L2);
    vis[count] = t; dep[count] = dsum / 3; key[count] = Math.max(0, Math.min(15, Math.round((0.45 + 0.55 * l) * 15)));
    count++;
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => dep[b] - dep[a]);
  return { count, order, sx, tri: vis, shade: key, depth: dep };
}
