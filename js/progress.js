// 進度儲存層：整個專案唯一碰 localStorage 的檔案。
// v2 接後端時，只要用同樣的匯出介面重寫這個檔。
const KEY = 'fpv-trainer-progress-v1';
const VERSION = 1;
const STATUSES = ['todo', 'doing', 'passed'];
const KINDS = ['sim', 'real'];

const emptyProgress = () => ({ version: VERSION, levels: {} });
const emptyLevel = () => ({ status: 'todo', passedSim: null, passedReal: null, logs: [] });

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw);
    return p && p.version === VERSION && p.levels && typeof p.levels === 'object' ? p : emptyProgress();
  } catch (e) { return emptyProgress(); }
}
function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
}

export async function loadProgress() { return read(); }

// patch：status / passedSim / passedReal 的子集
export async function saveLevel(levelId, patch) {
  const p = read();
  const lv = Object.assign(emptyLevel(), p.levels[levelId]);
  for (const k of ['status', 'passedSim', 'passedReal']) if (k in patch) lv[k] = patch[k];
  p.levels[levelId] = lv;
  write(p);
  return p;
}

// entry: {date, kind:'sim'|'real', success, total, note}
export async function addLog(levelId, entry) {
  const p = read();
  const lv = Object.assign(emptyLevel(), p.levels[levelId]);
  lv.logs = [...lv.logs, {
    date: String(entry.date), kind: entry.kind, success: entry.success | 0, total: entry.total | 0, note: entry.note || '',
  }];
  if (lv.status === 'todo') lv.status = 'doing';
  p.levels[levelId] = lv;
  write(p);
  return p;
}

export function exportJSON() { return JSON.stringify(read(), null, 2); }

function validate(p) {
  if (!p || typeof p !== 'object' || p.version !== VERSION) throw new Error('版本不符或不是進度檔');
  if (!p.levels || typeof p.levels !== 'object') throw new Error('缺少 levels');
  for (const [id, lv] of Object.entries(p.levels)) {
    if (!STATUSES.includes(lv.status)) throw new Error(`${id}：狀態不合法`);
    if (!Array.isArray(lv.logs)) throw new Error(`${id}：logs 不是陣列`);
    for (const g of lv.logs) {
      if (!KINDS.includes(g.kind) || !Number.isFinite(g.success) || !Number.isFinite(g.total) || typeof g.date !== 'string') {
        throw new Error(`${id}：紀錄格式不合法`);
      }
    }
  }
}

export async function importJSON(text) {
  const p = JSON.parse(text);
  validate(p);
  const clean = emptyProgress();
  for (const [id, lv] of Object.entries(p.levels)) clean.levels[id] = Object.assign(emptyLevel(), lv);
  if (!write(clean)) throw new Error('無法寫入瀏覽器儲存空間');
  return clean;
}

// ===== 設定（遙控器等）：與進度分開存，key 不同 =====
const SETTINGS_KEY = 'fpv-trainer-settings-v1';

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.version === VERSION && typeof s === 'object' ? s : { version: VERSION };
  } catch (e) { return { version: VERSION }; }
}

export async function loadSettings() { return readSettings(); }

// patch 以頂層 key 合併；gamepad 再往下合併一層（滑桿只改單一欄位時不會洗掉校正結果）
export async function saveSettings(patch) {
  const s = readSettings();
  for (const [k, v] of Object.entries(patch)) {
    s[k] = k === 'gamepad' && v && typeof v === 'object' ? { ...(s.gamepad || {}), ...v } : v;
  }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* 寫不進去就只在本次有效 */ }
  return s;
}
