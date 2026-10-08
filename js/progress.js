// 進度儲存層：整個專案唯一碰 localStorage 的檔案。
// 之後接後端時，只要用同樣的匯出介面重寫這個檔。
const KEY = 'fpv-trainer-progress-v1';          // 沿用同一個 key，內容的 version 欄位區分格式
const BACKUP_KEY = 'fpv-trainer-progress-v1-backup'; // v1 → v2 遷移前的原始資料
const VERSION = 2;
const STATUSES = ['todo', 'doing', 'passed'];
const KINDS = ['sim', 'real'];

// v1 關卡 id → v2 關卡 id
export const V1_TO_V2 = { line: 'B1', turn: 'B3', split: 'B5', orbit: 'A1', s: 'A3', inv: 'A4', flow: 'A5' };

const emptyProgress = () => ({ version: VERSION, levels: {} });
const emptyLevel = () => ({ status: 'todo', passedSim: null, passedReal: null, logs: [] });

// 純函式：把 v1 進度物件轉成 v2（未知 id 原樣保留，避免丟資料）
export function migrateV1(p) {
  const out = emptyProgress();
  for (const [id, lv] of Object.entries(p.levels || {})) out.levels[V1_TO_V2[id] || id] = Object.assign(emptyLevel(), lv);
  return out;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw);
    if (p && p.version === VERSION && p.levels && typeof p.levels === 'object') return p;
    if (p && p.version === 1 && p.levels && typeof p.levels === 'object') {
      // 第一次讀到舊資料：先備份原文（備份已存在就不覆蓋），再轉換並寫回
      try { if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, raw); } catch (e) { /* 備份失敗仍繼續 */ }
      const m = migrateV1(p);
      write(m);
      return m;
    }
    return emptyProgress();
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
  if (!p || typeof p !== 'object' || (p.version !== 1 && p.version !== VERSION)) throw new Error('版本不符或不是進度檔');
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

// 接受 v1 與 v2 匯出檔；v1 會先轉換。匯入前把目前資料備份（同一個備份 key 只在還沒有時寫入）。
export async function importJSON(text) {
  let p = JSON.parse(text);
  validate(p);
  if (p.version === 1) p = migrateV1(p);
  const clean = emptyProgress();
  for (const [id, lv] of Object.entries(p.levels)) clean.levels[id] = Object.assign(emptyLevel(), lv);
  if (!write(clean)) throw new Error('無法寫入瀏覽器儲存空間');
  return clean;
}

// ===== 設定（遙控器等）：與進度分開存，key 不同 =====
const SETTINGS_KEY = 'fpv-trainer-settings-v1';
const SETTINGS_VERSION = 1;

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.version === SETTINGS_VERSION && typeof s === 'object' ? s : { version: SETTINGS_VERSION };
  } catch (e) { return { version: SETTINGS_VERSION }; }
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
