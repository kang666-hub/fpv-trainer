// 外殼：分頁切換、讀 lessons.json、組裝畫面、主迴圈。
import { Sim, HOVER, yawOnly, euler } from './core.js';
import { LESSONS, FREE, lessonStart, lessonCtrl, stageProfile } from './demos.js';
import { scene, viewCam, camFromBody, sizeCanvas, drawStick, drawAlt, drawOSD, resetChase } from './view.js';
import * as store from './progress.js';
import { createGamepadInput, shapeSticks, detectAxis, finalizeCalibration, DEFAULT_GAMEPAD } from './gamepad.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== 狀態 =====
const sim = new Sim();
let lessonsData = null, lessonsError = '', progress = { version: 2, levels: {} };
let allLevels = [];                  // lessons.json 所有關卡（基礎＋進階）攤平
let stageEnds = [], stageProf = [], stageIdx = -1;
let CLASS = LESSONS;                 // 教室課程順序（讀到 lessons.json 後依關卡順序排）
let page = 'class';
let freeView = 'fpv'; // 自由練習的大畫面：'fpv' | 'chase'，存在設定裡
let L = CLASS[0], vIdx = 0, t = 0, mem = {}, paused = false, speed = 1, crashT = 0, camMode = L.cam;
let hist = [], trail = [], ghost = [], stats = { minz: 1e9, maxz: -1e9, z0: 0, crashed: false }, lastResult = '';
let ctrlOut = { thr: HOVER, roll: 0, pitch: 0, yaw: 0, phase: '' };
const stickTrail = { L: [], R: [] };

// lessons.json 還沒載入（或載入失敗）時，示範先用最陽春的文字，不讓畫面壞掉
for (const l of LESSONS) { l.title = l.title || l.id; l.notes = l.notes || []; l.watch = l.watch || ''; l.tier = l.tier || 'basic'; l.variants.forEach((v) => { v.kind = v.kind || 'style'; v.label = v.label || v.key; }); }

// 把 lessons.json 的文字併進示範（示範只管動作，文字都在 json）
function applyContent(data) {
  for (const tier of data.tiers) for (const lv of tier.levels) {
    const l = LESSONS.find((x) => x.id === lv.demo); if (!l) continue;
    Object.assign(l, { title: lv.title, notes: lv.notes, watch: lv.watch, tier: tier.id, levelId: lv.id });
    for (const v of l.variants) { const jv = lv.variants.find((x) => x.key === v.key); if (jv) Object.assign(v, { kind: jv.kind, label: jv.label, stages: jv.stages }); }
  }
  if (data.free) Object.assign(FREE, { title: data.free.title, notes: data.free.notes, watch: data.free.watch });
}

// ===== 舞台面板（通道、遙測）=====
const CH = [
  { k: 'THR', name: '油門', key: 'thr', uni: true },
  { k: 'YAW', name: 'Yaw', key: 'yaw', rate: 400 },
  { k: 'PITCH', name: 'Pitch', key: 'pitch', rate: 500 },
  { k: 'ROLL', name: 'Roll', key: 'roll', rate: 500 },
];
$('chs').innerHTML = CH.map((c) => `<div class="ch"><span class="k">${c.k}</span><div class="track">${c.uni ? `<span class="hov" style="left:${HOVER * 100}%"></span>` : '<span class="mid"></span>'}<span class="fill" id="f_${c.key}"></span></div><span class="v" id="v_${c.key}"></span></div>`).join('');
const TELE = [['alt', '高度', 'm'], ['vz', '垂直速度', 'm/s'], ['spd', '速度', 'm/s'], ['pit', '前傾', '°'], ['rol', '滾轉', '°'], ['hdg', '航向', '°']];
$('tele').innerHTML = TELE.map(([id, k, u]) => `<div class="t"><div class="k">${k}</div><div class="v"><span id="t_${id}">0</span><small>${u}</small></div></div>`).join('');

// ===== 教室 UI =====
const shortTitle = (s) => String(s).replace(/（.*?）/g, '');
function buildTabs() {
  const TIER = { basic: '基礎', advanced: '進階' };
  let prev = '';
  $('tabs').innerHTML = CLASS.map((l, i) => {
    const head = l.tier !== prev ? `<span class="tg">${TIER[l.tier] || ''}</span>` : ''; prev = l.tier;
    return `${head}<button class="tab" role="tab" id="tab_${l.id}" aria-selected="${l === L}" data-i="${i}"><span class="n">${esc(l.id)}</span>${esc(shortTitle(l.title))}</button>`;
  }).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => { b.onclick = () => selectLesson(CLASS[+b.dataset.i]); });
}
function buildVariants() {
  const grp = (kind, name) => {
    const items = L.variants.map((v, i) => ({ v, i })).filter((o) => o.v.kind === kind);
    return items.length ? `<span class="vg"><span class="vg-l">${name}</span>${items.map(({ v, i }) => `<button type="button" aria-pressed="${i === vIdx}" data-i="${i}"><span class="dot ${kind}"></span>${esc(v.label)}</button>`).join('')}</span>` : '';
  };
  $('variants').innerHTML = L.free ? '' : grp('style', '飛法') + grp('contrast', '對照');
  $('variants').querySelectorAll('button').forEach((b) => { b.onclick = () => { vIdx = +b.dataset.i; buildVariants(); restart(); }; });
}
function buildSeg(id, items, cur, fn) {
  $(id).innerHTML = items.map(([val, lab]) => `<button type="button" aria-pressed="${val === cur}" data-v="${val}">${lab}</button>`).join('');
  $(id).querySelectorAll('button').forEach((b) => { b.onclick = () => fn(b.dataset.v); });
}
function buildSpeed() { buildSeg('speed', [['1', '1×'], ['0.5', '0.5×'], ['0.25', '0.25×']], String(speed), (v) => { speed = +v; buildSpeed(); }); }
function buildCam() {
  if (L.free) {
    buildSeg('camsel', [['fpv', 'FPV'], ['chase', '第三人稱']], freeView, async (v) => {
      freeView = v; resetChase(); buildCam();
      await store.saveSettings({ freeView: v });
    });
    return;
  }
  buildSeg('camsel', [['side', '旁觀'], ['chase', '追尾']], camMode, (v) => { camMode = v; resetChase(); buildCam(); });
}
function buildNotes() {
  $('ntitle').textContent = L.title;
  $('nlist').innerHTML = L.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  $('nwatch').textContent = L.watch;
  $('keys').hidden = !L.free;
  $('modeTag').textContent = L.free ? '你在飛' : '示範中';
  $('result').innerHTML = lastResult;
}
function selectLesson(l) {
  L = l; vIdx = 0; lastResult = '';
  camMode = L.cam; buildTabs(); buildVariants(); buildNotes(); buildCam(); restart();
}
function restart() {
  t = 0; mem = {}; crashT = 0; hist = []; trail = []; resetChase();
  if (L.free) { // 自由練習：從地面起飛，油門從 0 開始
    sim.groundHold = true;
    sim.reset([-14, -9, 0], [0, 0, 0], yawOnly(0)); sim.st = { thr: 0, yaw: 0, pitch: 0, roll: 0 }; freeIn.thr = 0;
  } else { sim.groundHold = false; sim.rateScale = 1; lessonStart(L, sim, L.variants[vIdx]); }
  stats = { minz: sim.p[2], maxz: sim.p[2], z0: sim.p[2], crashed: false };
  ghost = L.free ? [] : L.ghost(L.variants[vIdx]);
  $('banner').hidden = true;
  buildTimeline();
}
// ===== 階段時間軸 =====
const CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const profCache = new Map();
function buildTimeline() {
  const el = $('timeline'), v = L.free ? null : L.variants[vIdx];
  stageIdx = -1; stageEnds = [];
  if (!v || !v.stages) { el.hidden = true; return; }
  const key = L.id + ':' + v.key;
  if (!profCache.has(key)) profCache.set(key, stageProfile(L, v));
  stageProf = profCache.get(key); stageEnds = L.stages(v);
  const pct = (x) => Math.round(x);
  $('tlBar').innerHTML = stageProf.map((s, i) => `<span class="seg-i" data-i="${i}" style="flex:${(s.t1 - s.t0).toFixed(3)} 1 0" title="${esc(v.stages[i].label)}"><b>${CIRC[i] || i + 1}</b></span>`).join('') + '<i class="tl-cur" id="tlCur"></i>';
  $('tlRows').innerHTML = v.stages.map((st, i) => {
    const s = stageProf[i];
    return `<div class="tl-row" data-i="${i}"><span class="tl-n">${CIRC[i] || i + 1}</span><div class="tl-t"><b>${esc(st.label)}</b><span>${esc(st.note)}</span></div>
      <div class="tl-s" aria-label="該段平均桿量"><span><i>Roll</i>${pct(s.roll)}%</span><span><i>Pitch</i>${pct(s.pitch)}%</span><span><i>Yaw</i>${pct(s.yaw)}%</span><span><i>油門</i>${pct(s.thr)}%</span></div></div>`;
  }).join('');
  el.hidden = false;
}
function updateTimeline() {
  if (!stageEnds.length) return;
  let i = stageEnds.findIndex((e) => t < e); if (i < 0) i = stageEnds.length - 1;
  if (i !== stageIdx) {
    stageIdx = i;
    document.querySelectorAll('#tlBar .seg-i, #tlRows .tl-row').forEach((n) => n.classList.toggle('on', +n.dataset.i === i));
  }
  const cur = $('tlCur'); if (cur) cur.style.left = Math.min(100, t / L.dur * 100).toFixed(1) + '%';
}

function finishRun() {
  if (L.free) return;
  const v = L.variants[vIdx];
  lastResult = `上一輪（${esc(v.label)}）：起始 <b>${stats.z0.toFixed(1)} m</b> · 最低 <b>${Math.max(0, stats.minz).toFixed(1)} m</b> · 最高 <b>${stats.maxz.toFixed(1)} m</b>${stats.crashed ? ' · <b style="color:var(--bad)">觸地</b>' : ''}`;
  $('result').innerHTML = lastResult;
}
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? '繼續' : '暫停'; };
$('restart').onclick = () => restart();

// ===== 自由練習輸入 =====
const keys = {};
const freeIn = { thr: HOVER, yaw: 0, pitch: 0, roll: 0, ptrL: null, ptrR: null };
addEventListener('keydown', (e) => {
  if (page === 'menu') return;
  if (!L.free) { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('pause').click(); } return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true; if (e.code === 'KeyR') restart();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
function stickPointer(cv, side) {
  const pos = (e) => { const r = cv.getBoundingClientRect(); const pad = r.width * 0.12, w = r.width - 2 * pad; return [Math.max(-1, Math.min(1, ((e.clientX - r.left - pad) / w) * 2 - 1)), Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top - pad) / w) * 2))]; };
  cv.addEventListener('pointerdown', (e) => {
    if (!L.free) setPage('free'); // 碰搖桿就切到自由練習
    cv.setPointerCapture(e.pointerId); freeIn['ptr' + side] = pos(e);
  });
  cv.addEventListener('pointermove', (e) => { if (freeIn['ptr' + side]) freeIn['ptr' + side] = pos(e); });
  const up = () => { freeIn['ptr' + side] = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
stickPointer($('stL'), 'L'); stickPointer($('stR'), 'R');
function freeControl(dt) {
  const k = (a, b) => (keys[a] ? 1 : 0) - (keys[b] ? 1 : 0);
  const gs = padSticks(); // 遙控器已連接且已校正才有值；觸控拖曳的那支搖桿仍以觸控為準
  sim.rateScale = gs ? gpVals().rateScale : 1; // Rate 倍率乘在角速度上，不改搖桿值
  if (freeIn.ptrL) { freeIn.thr = (freeIn.ptrL[1] + 1) / 2; freeIn.yaw = freeIn.ptrL[0]; }
  else if (gs) { freeIn.thr = gs.thr; freeIn.yaw = gs.yaw; }
  else { freeIn.thr = Math.max(0, Math.min(1, freeIn.thr + k('KeyW', 'KeyS') * 0.45 * dt)); freeIn.yaw += (k('KeyD', 'KeyA') * 0.7 - freeIn.yaw) * Math.min(1, dt * 10); }
  if (freeIn.ptrR) { freeIn.pitch = freeIn.ptrR[1]; freeIn.roll = freeIn.ptrR[0]; }
  else if (gs) { freeIn.pitch = gs.pitch; freeIn.roll = gs.roll; }
  else { freeIn.pitch += (k('ArrowUp', 'ArrowDown') * 0.5 - freeIn.pitch) * Math.min(1, dt * 10); freeIn.roll += (k('ArrowRight', 'ArrowLeft') * 0.6 - freeIn.roll) * Math.min(1, dt * 10); }
  return { thr: freeIn.thr, yaw: freeIn.yaw, pitch: freeIn.pitch, roll: freeIn.roll, phase: sim.onGround ? '在地面 · 推油門起飛' : gs ? '自由練習 · 遙控器輸入' : '自由練習 · 鍵盤 W S A D + 方向鍵，或拖曳右側搖桿' };
}

// ===== 遙控器（Gamepad）=====
const pad = createGamepadInput();
let settings = { version: 1 };
let wiz = null; // 校正精靈狀態；null = 沒在校正

const gpVals = () => ({ ...DEFAULT_GAMEPAD, ...(settings.gamepad || {}) });
const gpCalibrated = () => !!(settings.gamepad && settings.gamepad.axes && settings.gamepad.id && settings.gamepad.id === pad.getId());
// 有遙控器、已校正、且不在校正中，才採用遙控器；回傳已套用死區／Expo／Rate 的值
function padSticks() {
  if (wiz || !gpCalibrated()) return null;
  const s = pad.getSticks();
  return s ? shapeSticks(s, gpVals()) : null;
}
function applyPadMapping() { pad.setMapping(gpCalibrated() ? settings.gamepad.axes : null); }

function updateGpUi() {
  applyPadMapping();
  const id = pad.getId(), cal = gpCalibrated();
  $('gpStatus').textContent = id ? `已連接：${id}${cal ? '（已校正）' : '（尚未校正）'}` : '未連接';
  $('gpCal').disabled = !id;
  $('gpHint').textContent = !id ? '接上 USB 遙控器（Joystick／HID 模式）後，動一下搖桿或按個鍵，瀏覽器才看得到。'
    : cal ? '遙控器輸入中；放開的搖桿回到鍵盤／觸控。' : '尚未校正：請按「校正遙控器」，校正前仍用鍵盤／觸控。';
  if (!id && wiz) $('wizErr').textContent = '遙控器已斷線，請重新接上或取消。';
}
function updateGpSliders() {
  const v = gpVals();
  $('gpDz').value = v.deadzone; $('gpEx').value = v.expo; $('gpRt').value = v.rateScale;
  $('gpDzV').textContent = Number(v.deadzone).toFixed(2); $('gpExV').textContent = Number(v.expo).toFixed(2); $('gpRtV').textContent = Number(v.rateScale).toFixed(2) + '×';
}
for (const [el, key] of [['gpDz', 'deadzone'], ['gpEx', 'expo'], ['gpRt', 'rateScale']]) {
  $(el).addEventListener('input', async () => {
    settings.gamepad = { ...(settings.gamepad || {}), [key]: Number($(el).value) };
    updateGpSliders();
    settings = await store.saveSettings({ gamepad: { [key]: Number($(el).value) } });
  });
}
pad.onChange(updateGpUi);

// 校正精靈：要求每步先把其他搖桿放回原位，所以「同一軸被指定給兩個通道」代表有桿沒放開或軸重複
const WIZ = [
  { text: '① 兩支搖桿放中間、油門拉到最低', kind: 'baseline' },
  { text: '② 油門推到最高', kind: 'axis', key: 'thr' },
  { text: '③ 油門放回最低，Yaw 打到最右', kind: 'axis', key: 'yaw' },
  { text: '④ Yaw 放回中間，Pitch 推到最前', kind: 'axis', key: 'pitch' },
  { text: '⑤ Pitch 放回中間，Roll 打到最右', kind: 'axis', key: 'roll' },
  { text: '⑥ 兩支搖桿各畫一圈（每個方向都推到底）', kind: 'range' },
  { text: '⑦ 全部放回中間（油門保持最低），然後按完成', kind: 'center' },
];
const KEY_NAME = { thr: '油門', yaw: 'Yaw', pitch: 'Pitch', roll: 'Roll' };
const MIN_MOVE = 0.5, MIN_SPAN = 1.2, MAX_REST = 0.3;
const assignedKeys = () => Object.keys(wiz.assign);

function wizTrack(raw) {
  for (const key of assignedKeys()) {
    const i = wiz.assign[key].index, r = wiz.range[i] || (wiz.range[i] = { min: raw[i], max: raw[i] });
    r.min = Math.min(r.min, raw[i]); r.max = Math.max(r.max, raw[i]);
  }
}
// 目前這步的即時狀態：{ ok, text, err }
function wizEval(raw) {
  const st = WIZ[wiz.step];
  if (!raw) return { ok: false, text: '', err: '遙控器已斷線，請重新接上或取消。' };
  if (st.kind === 'baseline') return { ok: true, text: raw.map((v, i) => `軸${i}: ${v.toFixed(2)}`).join('  ') };
  if (st.kind === 'axis') {
    const d = detectAxis(wiz.baseline, raw);
    const text = d.index < 0 ? '沒有偵測到動作' : `偵測到：軸 ${d.index}（${d.direction > 0 ? '＋' : '－'}方向，位移 ${d.delta.toFixed(2)}）`;
    if (d.delta < MIN_MOVE) return { ok: false, text, err: `位移不足（需 ≥ ${MIN_MOVE}），請把搖桿推到底。` };
    const dup = assignedKeys().find((k) => wiz.assign[k].index === d.index);
    if (dup) return { ok: false, text, err: `軸 ${d.index} 已指定給「${KEY_NAME[dup]}」。請確認其他搖桿都放回原位，或重做這一步。` };
    return { ok: true, text, det: d };
  }
  if (st.kind === 'range') {
    const lines = assignedKeys().map((k) => { const r = wiz.range[wiz.assign[k].index]; return `${KEY_NAME[k]}（軸${wiz.assign[k].index}）：${r.min.toFixed(2)} ～ ${r.max.toFixed(2)}`; });
    const ok = assignedKeys().every((k) => { const r = wiz.range[wiz.assign[k].index]; return r.max - r.min >= MIN_SPAN; });
    return { ok, text: lines.join('\n'), err: ok ? '' : `還有搖桿的行程不夠（每軸需 ≥ ${MIN_SPAN}），繼續畫圈。` };
  }
  // center：除了油門，其他三軸要回到基準附近
  const off = assignedKeys().filter((k) => Math.abs(raw[wiz.assign[k].index] - wiz.baseline[wiz.assign[k].index]) > MAX_REST);
  return { ok: off.length === 0, text: assignedKeys().map((k) => `${KEY_NAME[k]}：${raw[wiz.assign[k].index].toFixed(2)}`).join('  '), err: off.length ? `還沒放回原位：${off.map((k) => KEY_NAME[k]).join('、')}` : '' };
}
function wizRender(ev) {
  const st = WIZ[wiz.step];
  setTxt('wizStep', `步驟 ${wiz.step + 1}／${WIZ.length}　${st.text}`);
  setTxt('wizLive', ev.text || '');
  setTxt('wizErr', ev.err || wiz.fail || '');
  $('wizNext').disabled = !ev.ok;
  $('wizNext').textContent = wiz.step === WIZ.length - 1 ? '完成並存檔' : '下一步';
}
function wizTick() {
  if (!wiz) return;
  const raw = pad.getRaw();
  if (raw) wizTrack(raw);
  wizRender(wizEval(raw));
}
function wizOpen() {
  const raw = pad.getRaw(); if (!raw) return;
  wiz = { step: 0, baseline: null, assign: {}, range: {} };
  $('gpWiz').hidden = false; $('gpCal').disabled = true;
  wizTick();
}
function wizClose() { wiz = null; $('gpWiz').hidden = true; $('wizErr').textContent = ''; updateGpUi(); }
async function wizNext() {
  const raw = pad.getRaw(), ev = wizEval(raw);
  if (!raw || !ev.ok) return;
  const st = WIZ[wiz.step];
  if (st.kind === 'baseline') wiz.baseline = raw.slice();
  else if (st.kind === 'axis') {
    wiz.assign[st.key] = { index: ev.det.index, direction: ev.det.direction };
    wiz.range[ev.det.index] = { min: Math.min(wiz.baseline[ev.det.index], raw[ev.det.index]), max: Math.max(wiz.baseline[ev.det.index], raw[ev.det.index]) };
  } else if (st.kind === 'center') {
    let axes;
    try { axes = finalizeCalibration({ assign: wiz.assign, range: wiz.range, center: raw.slice() }); }
    catch (e) { wiz.fail = '校正資料不完整，請取消後重做。'; return; }
    const bad = Object.entries(axes).find(([, m]) => !(m.max - m.min >= MIN_MOVE) || (m.center !== undefined && (m.center < m.min || m.center > m.max)));
    if (bad) { wiz.fail = `${KEY_NAME[bad[0]]} 的行程或中點不合理，請取消後重做。`; return; }
    const v = gpVals();
    settings = await store.saveSettings({ gamepad: { id: pad.getId(), axes, deadzone: v.deadzone, expo: v.expo, rateScale: v.rateScale } });
    wizClose(); return;
  }
  wiz.step++; wiz.fail = '';
  wizTick();
}
$('gpCal').onclick = wizOpen;
$('wizNext').onclick = wizNext;
$('wizCancel').onclick = wizClose; // 取消不動已存的設定

// ===== 面板更新 =====
function setTxt(id, v) { const el = $(id); if (el.textContent !== v) el.textContent = v; }
function updatePanel() {
  const s = sim.st;
  for (const ch of CH) {
    const v = s[ch.key], f = $('f_' + ch.key);
    if (ch.uni) { f.style.left = '0'; f.style.width = (v * 100).toFixed(1) + '%'; setTxt('v_' + ch.key, (v * 100).toFixed(0) + '%'); }
    else { const a = Math.min(v, 0), b = Math.max(v, 0); f.style.left = (50 + a * 50).toFixed(1) + '%'; f.style.width = ((b - a) * 50).toFixed(1) + '%'; setTxt('v_' + ch.key, `${(v * 100).toFixed(0)}% ${(v * ch.rate * sim.rateScale).toFixed(0)}°/s`); }
  }
  const e = euler(sim.R);
  setTxt('t_alt', sim.p[2].toFixed(1)); setTxt('t_vz', sim.v[2].toFixed(1)); setTxt('t_spd', Math.hypot(...sim.v).toFixed(1));
  setTxt('t_pit', e.pitch.toFixed(0)); setTxt('t_rol', e.roll.toFixed(0)); setTxt('t_hdg', ((-e.yaw + 360) % 360).toFixed(0));
}

// ===== 主迴圈 =====
let last = performance.now(), acc = 0, trailT = 0, histT = 0;
const DT = 1 / 240;
function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  if (page !== 'menu') {
    pad.poll(); wizTick();
    if (!paused) {
      acc += real * speed;
      while (acc >= DT) {
        acc -= DT;
        if (sim.crashed) { crashT += DT; if (crashT > 1.6 / Math.max(speed, 0.5)) { finishRun(); restart(); } continue; }
        ctrlOut = L.free ? freeControl(DT) : lessonCtrl(L, L.variants[vIdx], sim, t, mem);
        Object.assign(sim.st, { thr: ctrlOut.thr, roll: ctrlOut.roll, pitch: ctrlOut.pitch, yaw: ctrlOut.yaw });
        sim.step(DT); t += DT;
        stats.minz = Math.min(stats.minz, sim.p[2]); stats.maxz = Math.max(stats.maxz, sim.p[2]);
        if (sim.crashed) { stats.crashed = true; $('banner').hidden = false; }
        if ((trailT += DT) > 0.05) { trailT = 0; trail.push(sim.p.slice()); if (trail.length > 70) trail.shift(); }
        if ((histT += DT) > 0.04) { histT = 0; hist.push({ t, z: sim.p[2] }); if (hist.length > 400) hist.shift(); }
        if (!L.free && t >= L.dur) { finishRun(); restart(); }
        const sl = stickTrail.L, sr = stickTrail.R;
        sl.push([sim.st.yaw, sim.st.thr * 2 - 1]); sr.push([sim.st.roll, sim.st.pitch]);
        if (sl.length > 90) { sl.shift(); sr.shift(); }
      }
    }
    const S = { sim, poles: L.poles, ghost, trail };
    const fpvMain = L.free && freeView === 'fpv'; // 自由練習預設 FPV 為大畫面，小畫面放第三人稱
    const mode = L.free ? 'chase' : camMode;
    const drawChase = (cv, ratio) => { const c = sizeCanvas(cv, ratio); scene(c.ctx, viewCam(c.W, c.H, sim, mode, L.side), S, true); };
    const drawFpv = (cv, ratio, osd) => {
      const c = sizeCanvas(cv, ratio); scene(c.ctx, camFromBody(sim.p, sim.R, c.W, c.H, 25, 110), S, false);
      if (osd) drawOSD(c.ctx, c.W, c.H, { alt: sim.p[2], spd: Math.hypot(...sim.v), thr: sim.st.thr });
    };
    const cvView = $('view'), bigRatio = cvView.clientWidth < 600 && innerWidth <= 600 ? 4 / 3 : 16 / 10;
    if (fpvMain) { drawFpv(cvView, bigRatio, true); drawChase($('fpv'), 16 / 9); }
    else { drawChase(cvView, bigRatio); drawFpv($('fpv'), 16 / 9, false); }
    $('legend').hidden = fpvMain; // 推力／垂直分量／重力線在 FPV 裡看不到
    setTxt('fpvtag', fpvMain ? '第三人稱' : 'FPV 25°');
    if (!L.free) updateTimeline();
    const stg = !L.free && L.variants[vIdx].stages && stageIdx >= 0 ? L.variants[vIdx].stages[stageIdx] : null;
    setTxt('phase', L.free ? (ctrlOut.phase || '') : stg ? `${CIRC[stageIdx] || ''} ${stg.label}` : '');
    if (L.free) setTxt('modeTag', gpCalibrated() && !wiz ? '遙控器' : '你在飛');
    drawStick($('stL'), sim.st.yaw, sim.st.thr * 2 - 1, stickTrail.L.filter((_, i) => i % 3 === 0), true);
    drawStick($('stR'), sim.st.roll, sim.st.pitch, stickTrail.R.filter((_, i) => i % 3 === 0), false);
    updatePanel(); drawAlt($('alt'), hist, stats.z0);
  }
  requestAnimationFrame(frame);
}

// ===== 訓練菜單 =====
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const STATUS_LABEL = { todo: '未開始', doing: '練習中', passed: '已過關' };
const openIds = new Set();
let menuMsg = { text: '', bad: false };

// 「10 次做到 8 次、連續 2 個練習日」：模擬器紀錄依日期合併，最近兩個不同日期的成功率都 ≥ 80%
export function passHint(logs) {
  const byDate = new Map();
  for (const g of logs) {
    if (g.kind !== 'sim' || !(g.total > 0)) continue;
    const d = byDate.get(g.date) || { s: 0, n: 0 };
    d.s += g.success; d.n += g.total; byDate.set(g.date, d);
  }
  const days = [...byDate.keys()].sort().slice(-2);
  return days.length === 2 && days.every((k) => byDate.get(k).s / byDate.get(k).n >= 0.8);
}

const lv = (id) => progress.levels[id] || { status: 'todo', passedSim: null, passedReal: null, logs: [] };

function logRows(logs) {
  if (!logs.length) return '<div class="none">還沒有紀錄</div>';
  return logs.map((g, i) => ({ g, i })).sort((a, b) => (a.g.date < b.g.date ? 1 : a.g.date > b.g.date ? -1 : b.i - a.i)).slice(0, 5)
    .map(({ g }) => `<div class="lg"><span class="d">${esc(g.date)}</span><span>${g.kind === 'real' ? '實機' : '模擬器'}</span><span class="r">${g.success}/${g.total}</span><span>${esc(g.note)}</span></div>`).join('');
}

function cardHTML(level, tier) {
  const p = lv(level.id);
  const hint = p.status !== 'passed' && passHint(p.logs);
  const demoOk = level.demo && LESSONS.some((l) => l.id === level.demo);
  return `<details class="card" data-id="${esc(level.id)}"${openIds.has(level.id) ? ' open' : ''}>
    <summary><span class="no">${esc(level.id)}</span><span class="ttl">${esc(level.title)}</span><span class="badge ${p.status}">${STATUS_LABEL[p.status]}</span>
      <span class="dates">建議順序 ${level.order}／${tier.levels.length} · 模擬器過關：${esc(p.passedSim || '—')} · 實機過關：${esc(p.passedReal || '—')}</span></summary>
    <div class="body">
      <div class="two">
        <div class="box"><span class="k">模擬器</span>${esc(level.sim.do)}<div class="p">過關：<b>${esc(level.sim.pass)}</b></div></div>
        <div class="box"><span class="k">實機</span>${esc(level.real.do)}<div class="p">過關：<b>${esc(level.real.pass)}</b></div></div>
      </div>
      <ul class="tips">${level.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${hint ? '<div class="hint"><span>最近兩個練習日的模擬器成功率都 ≥ 80%，可標記過關。</span><button class="btn primary" type="button" data-act="pass-sim">確認模擬器過關</button></div>' : ''}
      <div class="row">
        ${demoOk ? '<button class="btn" type="button" data-act="demo">看示範</button>' : ''}
        ${p.status !== 'passed' ? '<button class="btn ok" type="button" data-act="pass-sim">標記模擬器過關</button>' : `<button class="btn ok" type="button" data-act="pass-real"${p.passedReal ? ' disabled' : ''}>標記實機過關</button><button class="btn" type="button" data-act="undo">取消過關</button>`}
      </div>
      <div class="logs">${logRows(p.logs)}</div>
      <form class="form" data-act="log">
        <label>日期<input type="date" name="date" value="${today()}" required></label>
        <label>類型<select name="kind"><option value="sim">模擬器</option><option value="real">實機</option></select></label>
        <label>成功次數<input type="number" name="success" min="0" step="1" inputmode="numeric" required></label>
        <label>總次數<input type="number" name="total" min="1" step="1" inputmode="numeric" required></label>
        <label class="wide">備註<input type="text" name="note" maxlength="200"></label>
        <button class="btn primary" type="submit">新增紀錄</button>
      </form>
    </div>
  </details>`;
}

function renderMenu() {
  const m = $('menu');
  if (!lessonsData) { m.innerHTML = `<p class="err">${esc(lessonsError || '載入中…')}</p>`; return; }
  const d = lessonsData;
  m.innerHTML = `
    <section class="guide"><h2>基本練習指引</h2><ul class="rules">${d.guide.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>
    <section><h2>訓練規則</h2><ul class="rules">${d.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>
    <section class="tools">
      <button class="btn" type="button" data-act="export">匯出進度</button>
      <button class="btn" type="button" data-act="import">匯入進度</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <span class="msg${menuMsg.bad ? ' bad' : ''}" role="status">${esc(menuMsg.text)}</span>
    </section>
    ${d.tiers.map((tier) => `<section class="tier"><h2>${esc(tier.title)}</h2><p class="intro">${esc(tier.intro)}</p><div class="cards">${tier.levels.map((lv) => cardHTML(lv, tier)).join('')}</div></section>`).join('')}
    <section class="weekly"><h2>每週檢討</h2><ul>${d.weekly.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>`;
}

function setMsg(text, bad = false) { menuMsg = { text, bad }; }

async function refreshMenu() { progress = await store.loadProgress(); renderMenu(); }

$('menu').addEventListener('toggle', (e) => {
  const c = e.target.closest?.('details.card'); if (!c) return;
  if (c.open) openIds.add(c.dataset.id); else openIds.delete(c.dataset.id);
}, true);

$('menu').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b || b.type === 'submit') return;
  const act = b.dataset.act, card = b.closest('.card'), id = card?.dataset.id;
  if (act === 'demo') { setPage('class', allLevels.find((x) => x.id === id).demo); return; }
  if (act === 'export') {
    const url = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `fpv-trainer-progress-${today()}.json` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg('已匯出進度檔'); renderMenu(); return;
  }
  if (act === 'import') { $('importFile').click(); return; }
  if (act === 'pass-sim') await store.saveLevel(id, { status: 'passed', passedSim: today() });
  if (act === 'pass-real') await store.saveLevel(id, { passedReal: today() });
  if (act === 'undo') await store.saveLevel(id, { status: 'doing', passedSim: null, passedReal: null });
  setMsg(''); await refreshMenu();
});

$('menu').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, id = f.closest('.card').dataset.id, fd = new FormData(f);
  const success = Number(fd.get('success')), total = Number(fd.get('total'));
  if (!Number.isInteger(success) || !Number.isInteger(total) || total < 1 || success < 0 || success > total) {
    setMsg('成功次數須為 0 到總次數之間的整數，總次數至少 1', true); renderMenu(); return;
  }
  await store.addLog(id, { date: fd.get('date'), kind: fd.get('kind'), success, total, note: String(fd.get('note') || '').trim() });
  setMsg(''); await refreshMenu();
});

$('menu').addEventListener('change', async (e) => {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files[0]; if (!file) return;
  try { await store.importJSON(await file.text()); setMsg('匯入完成'); }
  catch (err) { setMsg('匯入失敗：' + err.message, true); }
  await refreshMenu();
});

// ===== 頁面切換 =====
function setPage(p, demoId) {
  page = p;
  document.querySelectorAll('#pages .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === p)));
  $('lab').hidden = p === 'menu';
  $('menu').hidden = p !== 'menu';
  $('tabs').hidden = p !== 'class';
  $('gpPanel').hidden = p !== 'free' || !pad.supported;
  if (p !== 'free' && wiz) wizClose();
  if (p === 'menu') { refreshMenu(); return; }
  if (p === 'free') { if (L !== FREE) selectLesson(FREE); }
  else {
    const target = CLASS.find((l) => l.id === demoId) || (L.free ? CLASS[0] : L);
    if (target !== L || demoId) selectLesson(target);
  }
  last = performance.now(); acc = 0;
}
$('pages').querySelectorAll('.tab').forEach((b) => { b.onclick = () => setPage(b.dataset.page); });

// ===== 啟動 =====
async function init() {
  try {
    const res = await fetch('data/lessons.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lessonsData = await res.json();
    allLevels = lessonsData.tiers.flatMap((tier) => tier.levels);
    applyContent(lessonsData);
    const order = allLevels.filter((x) => x.demo).map((x) => LESSONS.find((l) => l.id === x.demo)).filter(Boolean);
    if (order.length) CLASS = order;
  } catch (err) {
    lessonsError = '無法載入 data/lessons.json（' + err.message + '）。請用 http 伺服器開啟（python3 -m http.server），不要直接點開檔案。';
  }
  progress = await store.loadProgress();
  settings = await store.loadSettings();
  freeView = settings.freeView === 'chase' ? 'chase' : 'fpv';
  updateGpSliders(); updateGpUi();
  buildSpeed(); selectLesson(CLASS[0]);
  requestAnimationFrame(frame);
}
init();
