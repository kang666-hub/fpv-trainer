import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseModel, visibleTris, orderByDepth } from '../js/model.js';

const json = JSON.parse(readFileSync(new URL('../assets/models/kodo_lowpoly.json', import.meta.url), 'utf8'));
const A = 0.34, DIAG = 2 * Math.SQRT2 * A;   // 與 view.js 的 BODY.A 對角軸距一致

test('parseModel：三角形 < 3000、4 個 pads、索引有效、機頭在 +x、縮放後對角軸距 = BODY 對角軸距 ±1%', () => {
  for (const part of json.parts) {
    const nv = part.v.length / 3;
    assert.ok(part.f.every((i) => Number.isInteger(i) && i >= 0 && i < nv), `${part.name} 索引超出範圍`);
    assert.equal(part.f.length % 3, 0);
  }
  const m = parseModel(json, DIAG);
  assert.ok(m.n < 3000, `三角形 ${m.n}`);
  assert.equal(m.n, json.parts.reduce((a, p) => a + p.f.length / 3, 0));
  assert.equal(m.pads.length, 4);
  assert.ok(json.fpvCam.pos[0] > 0 && m.cam.pos[0] > 0, '機頭方向');
  const diag = 2 * Math.hypot(m.pads[0][0], m.pads[0][1]);
  assert.ok(Math.abs(diag - DIAG) / DIAG < 0.01, `對角軸距 ${diag.toFixed(3)} vs ${DIAG.toFixed(3)}`);
  assert.ok(Math.abs(m.scale - 4.214) < 0.01, `縮放 ${m.scale}`);
  assert.ok(m.propR > 0.2 && m.propR < 0.3);
  assert.equal(m.blades, 3);
  assert.ok(m.tris.every(Number.isFinite));
});

test('orderByDepth：遠的先畫', () => {
  assert.deepEqual(orderByDepth(Float32Array.from([2, 9, 5])), [1, 2, 0]);
  assert.deepEqual(orderByDepth(Float32Array.from([1, 4, 3]), [0, 2]), [2, 0]);
});

function camAt(c, look, W = 800, H = 500, fovDeg = 62) {
  const f = look.map((x, i) => x - c[i]), l = Math.hypot(...f); f.forEach((_, i) => (f[i] /= l));
  const r = [f[1], -f[0], 0], rl = Math.hypot(r[0], r[1]); r[0] /= rl; r[1] /= rl;
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { c, f, r, u, W, H, F: (W / 2) / Math.tan(fovDeg * Math.PI / 360) };
}
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test('visibleTris：背面剔除、深度由遠到近、朝上的面較亮；倒置時看到機腹', () => {
  const m = parseModel(json, DIAG);
  const cam = camAt([-6, 0, 3], [0, 0, 0]);
  const v = visibleTris(m, [0, 0, 0], I, cam);
  assert.ok(v.count > 0 && v.count < m.n * 0.75, `可見 ${v.count} / ${m.n}`);
  for (let k = 1; k < v.order.length; k++) assert.ok(v.depth[v.order[k - 1]] >= v.depth[v.order[k]]);
  // 從正上方看：所有可見面法線朝上；倒置（繞 x 軸 180°）後看到的是機腹，法線朝下（機身座標）
  const top = camAt([0.001, 0, 6], [0, 0, 0]);
  const up = visibleTris(m, [0, 0, 0], I, top);
  let ups = 0; for (let k = 0; k < up.count; k++) ups += m.nrm[up.tri[k] * 3 + 2] > 0 ? 1 : 0;
  assert.ok(ups / up.count > 0.8, `正上方可見面朝上比例 ${ups / up.count}`);
  const flip = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const dn = visibleTris(m, [0, 0, 0], flip, top);
  let downs = 0; for (let k = 0; k < dn.count; k++) downs += m.nrm[dn.tri[k] * 3 + 2] < 0 ? 1 : 0;
  assert.ok(downs / dn.count > 0.8, `倒置時可見機腹比例 ${downs / dn.count}`);
  // 光源固定在世界座標：朝上的面比朝下的面亮（同一機身姿態、從側面看）
  const side = visibleTris(m, [0, 0, 0], I, cam);
  let upS = 0, upN = 0, dnS = 0, dnN = 0;
  for (let k = 0; k < side.count; k++) { if (m.nrm[side.tri[k] * 3 + 2] > 0.7) { upS += side.shade[k]; upN++; } else if (m.nrm[side.tri[k] * 3 + 2] < -0.7) { dnS += side.shade[k]; dnN++; } }
  assert.ok(upN > 0 && upS / upN > (dnN ? dnS / dnN : 0), '朝上的面應比朝下的面亮');
});

test('visibleTris：額外縮放 sc 讓投影變大；鏡頭在機身後方時前槳那一側在畫面前方（機頭方向正確）', () => {
  const m = parseModel(json, DIAG), cam = camAt([-6, 0, 0.5], [0, 0, 0]);
  const w = (sc) => { const v = visibleTris(m, [0, 0, 0], I, cam, sc); let lo = 1e9, hi = -1e9; for (let k = 0; k < v.count; k++) for (let j = 0; j < 3; j++) { const x = v.sx[k * 6 + j * 2]; lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo; };
  assert.ok(w(2) > w(1) * 1.8, '放大倍率應生效');
  // 鏡頭在 −x（機尾後方）看向 +x：天線（機尾，x<0）離鏡頭近、機頭鏡頭（x>0）較遠
  const v = visibleTris(m, [0, 0, 0], I, cam, 1);
  const camPart = (() => { let dsum = 0, c = 0, asum = 0, ac = 0; for (let k = 0; k < v.count; k++) { const t = v.tri[k], x = m.tris[t * 9]; if (x > 0.2) { dsum += v.depth[k]; c++; } if (x < -0.25) { asum += v.depth[k]; ac++; } } return [dsum / c, asum / ac]; })();
  assert.ok(camPart[0] > camPart[1], `機頭側 ${camPart[0].toFixed(2)} 應比機尾側 ${camPart[1].toFixed(2)} 遠`);
});
