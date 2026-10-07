// 外殼：分頁切換、讀 lessons.json、組裝畫面、主迴圈。
import { Sim, HOVER, yawOnly, euler } from './core.js';
import { LESSONS, FREE, lessonStart, lessonCtrl } from './demos.js';
import { scene, viewCam, camFromBody, sizeCanvas, drawStick, drawAlt, resetChase } from './view.js';
import * as store from './progress.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== 狀態 =====
const sim = new Sim();
let lessonsData = null, lessonsError = '', progress = { version: 1, levels: {} };
let CLASS = LESSONS;                 // 教室課程順序（讀到 lessons.json 後依關卡順序排）
let page = 'class';
let L = CLASS[0], vIdx = 0, t = 0, mem = {}, paused = false, speed = 1, crashT = 0, camMode = L.cam;
let hist = [], trail = [], ghost = [], stats = { minz: 1e9, maxz: -1e9, z0: 0, crashed: false }, lastResult = '';
let ctrlOut = { thr: HOVER, roll: 0, pitch: 0, yaw: 0, phase: '' };
const stickTrail = { L: [], R: [] };

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
function buildTabs() {
  $('tabs').innerHTML = CLASS.map((l, i) => `<button class="tab" role="tab" id="tab_${l.id}" aria-selected="${l === L}" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(l.title)}</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => { b.onclick = () => selectLesson(CLASS[+b.dataset.i]); });
}
function buildVariants() {
  $('variants').innerHTML = L.variants.map((v, i) => `<button type="button" aria-pressed="${i === vIdx}" data-i="${i}"><span class="dot" style="background:var(--${v.kind === 'ok' ? 'ok' : 'bad'})"></span>${esc(v.label)}</button>`).join('');
  $('variants').querySelectorAll('button').forEach((b) => { b.onclick = () => { vIdx = +b.dataset.i; buildVariants(); restart(); }; });
}
function buildSeg(id, items, cur, fn) {
  $(id).innerHTML = items.map(([val, lab]) => `<button type="button" aria-pressed="${val === cur}" data-v="${val}">${lab}</button>`).join('');
  $(id).querySelectorAll('button').forEach((b) => { b.onclick = () => fn(b.dataset.v); });
}
function buildSpeed() { buildSeg('speed', [['1', '1×'], ['0.5', '0.5×'], ['0.25', '0.25×']], String(speed), (v) => { speed = +v; buildSpeed(); }); }
function buildCam() { buildSeg('camsel', [['side', '旁觀'], ['chase', '追尾']], camMode, (v) => { camMode = v; resetChase(); buildCam(); }); }
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
  if (L.free) { sim.reset([-14, -9, 2], [0, 0, 0], yawOnly(0)); sim.st = { thr: HOVER, yaw: 0, pitch: 0, roll: 0 }; freeIn.thr = HOVER; }
  else lessonStart(L, sim);
  stats = { minz: sim.p[2], maxz: sim.p[2], z0: sim.p[2], crashed: false };
  ghost = [];
  if (L.ref) for (let s = L.pathT[0]; s <= L.pathT[1]; s += 0.08) ghost.push(L.ref(s).p);
  $('banner').hidden = true;
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
  if (freeIn.ptrL) { freeIn.thr = (freeIn.ptrL[1] + 1) / 2; freeIn.yaw = freeIn.ptrL[0]; }
  else { freeIn.thr = Math.max(0, Math.min(1, freeIn.thr + k('KeyW', 'KeyS') * 0.45 * dt)); freeIn.yaw += (k('KeyD', 'KeyA') * 0.7 - freeIn.yaw) * Math.min(1, dt * 10); }
  if (freeIn.ptrR) { freeIn.pitch = freeIn.ptrR[1]; freeIn.roll = freeIn.ptrR[0]; }
  else { freeIn.pitch += (k('ArrowUp', 'ArrowDown') * 0.5 - freeIn.pitch) * Math.min(1, dt * 10); freeIn.roll += (k('ArrowRight', 'ArrowLeft') * 0.6 - freeIn.roll) * Math.min(1, dt * 10); }
  return { thr: freeIn.thr, yaw: freeIn.yaw, pitch: freeIn.pitch, roll: freeIn.roll, phase: '自由練習 · 鍵盤 W S A D + 方向鍵，或拖曳右側搖桿' };
}

// ===== 面板更新 =====
function setTxt(id, v) { const el = $(id); if (el.textContent !== v) el.textContent = v; }
function updatePanel() {
  const s = sim.st;
  for (const ch of CH) {
    const v = s[ch.key], f = $('f_' + ch.key);
    if (ch.uni) { f.style.left = '0'; f.style.width = (v * 100).toFixed(1) + '%'; setTxt('v_' + ch.key, (v * 100).toFixed(0) + '%'); }
    else { const a = Math.min(v, 0), b = Math.max(v, 0); f.style.left = (50 + a * 50).toFixed(1) + '%'; f.style.width = ((b - a) * 50).toFixed(1) + '%'; setTxt('v_' + ch.key, `${(v * 100).toFixed(0)}% ${(v * ch.rate).toFixed(0)}°/s`); }
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
    const cvView = $('view');
    const v = sizeCanvas(cvView, cvView.clientWidth < 600 && innerWidth <= 600 ? 4 / 3 : 16 / 10);
    scene(v.ctx, viewCam(v.W, v.H, sim, camMode, L.id), S, true);
    const f = sizeCanvas($('fpv'), 16 / 9);
    scene(f.ctx, camFromBody(sim.p, sim.R, f.W, f.H, 25, 110), S, false);
    setTxt('phase', ctrlOut.phase || '');
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
const isLocked = (i) => i > 0 && lv(lessonsData.levels[i - 1].id).status !== 'passed';

function logRows(logs) {
  if (!logs.length) return '<div class="none">還沒有紀錄</div>';
  return logs.map((g, i) => ({ g, i })).sort((a, b) => (a.g.date < b.g.date ? 1 : a.g.date > b.g.date ? -1 : b.i - a.i)).slice(0, 5)
    .map(({ g }) => `<div class="lg"><span class="d">${esc(g.date)}</span><span>${g.kind === 'real' ? '實機' : '模擬器'}</span><span class="r">${g.success}/${g.total}</span><span>${esc(g.note)}</span></div>`).join('');
}

function cardHTML(level, i) {
  const p = lv(level.id), locked = isLocked(i);
  const hint = p.status !== 'passed' && passHint(p.logs);
  const demoOk = level.demo && LESSONS.some((l) => l.id === level.demo);
  return `<details class="card${locked ? ' locked' : ''}" data-id="${esc(level.id)}"${openIds.has(level.id) ? ' open' : ''}>
    <summary><span class="no">${String(level.order).padStart(2, '0')}</span><span class="ttl">${esc(level.title)}</span><span class="badge ${p.status}">${STATUS_LABEL[p.status]}</span>
      <span class="dates">模擬器過關：${esc(p.passedSim || '—')} · 實機過關：${esc(p.passedReal || '—')}${locked ? ' · 前一關過關後解鎖' : ''}</span></summary>
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
    <section><h2>訓練規則</h2><ul class="rules">${d.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>
    <section class="tools">
      <button class="btn" type="button" data-act="export">匯出進度</button>
      <button class="btn" type="button" data-act="import">匯入進度</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <span class="msg${menuMsg.bad ? ' bad' : ''}" role="status">${esc(menuMsg.text)}</span>
    </section>
    <section class="cards">${d.levels.map(cardHTML).join('')}</section>
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
  if (act === 'demo') { setPage('class', lessonsData.levels.find((x) => x.id === id).demo); return; }
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
    const order = lessonsData.levels.filter((x) => x.demo).sort((a, b) => a.order - b.order).map((x) => LESSONS.find((l) => l.id === x.demo)).filter(Boolean);
    if (order.length) CLASS = order;
    lessonsData.levels.sort((a, b) => a.order - b.order);
  } catch (err) {
    lessonsError = '無法載入 data/lessons.json（' + err.message + '）。請用 http 伺服器開啟（python3 -m http.server），不要直接點開檔案。';
  }
  progress = await store.loadProgress();
  buildSpeed(); selectLesson(CLASS[0]);
  requestAnimationFrame(frame);
}
init();
