import test from 'node:test';
import assert from 'node:assert/strict';

// 在 Node 模擬 localStorage（progress.js 是唯一碰它的檔案）
function mockStorage() {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
  return m;
}
const store = await import('../js/progress.js');

const V1 = {
  version: 1,
  levels: {
    line: { status: 'passed', passedSim: '2026-10-10', passedReal: null, logs: [{ date: '2026-10-08', kind: 'sim', success: 8, total: 10, note: '第一天' }] },
    turn: { status: 'doing', passedSim: null, passedReal: null, logs: [{ date: '2026-10-09', kind: 'real', success: 5, total: 10, note: '' }] },
    split: { status: 'todo', passedSim: null, passedReal: null, logs: [] },
    orbit: { status: 'passed', passedSim: '2026-10-11', passedReal: '2026-10-12', logs: [] },
    s: { status: 'doing', passedSim: null, passedReal: null, logs: [] },
    inv: { status: 'todo', passedSim: null, passedReal: null, logs: [] },
    flow: { status: 'todo', passedSim: null, passedReal: null, logs: [] },
  },
};
const MAP = { line: 'B1', turn: 'B3', split: 'B5', orbit: 'A1', s: 'A3', inv: 'A4', flow: 'A5' };

test('migrateV1：id 對應、狀態／過關日期／紀錄全數搬過去', () => {
  const m = store.migrateV1(V1);
  assert.equal(m.version, 2);
  for (const [o, n] of Object.entries(MAP)) assert.deepEqual(m.levels[n], V1.levels[o], `${o} → ${n}`);
  assert.equal(Object.keys(m.levels).length, 7);
});

test('讀到 v1 資料：自動轉成 v2、原文備份在備份 key、之後再讀不會覆蓋備份', async () => {
  const m = mockStorage();
  const raw = JSON.stringify(V1);
  m.set('fpv-trainer-progress-v1', raw);
  const p = await store.loadProgress();
  assert.equal(p.version, 2);
  assert.deepEqual(p.levels.B1, V1.levels.line);
  assert.equal(m.get('fpv-trainer-progress-v1-backup'), raw, '備份應是原始 v1 文字');
  assert.equal(JSON.parse(m.get('fpv-trainer-progress-v1')).version, 2, '主 key 應已寫回 v2');
  await store.addLog('B1', { date: '2026-10-20', kind: 'sim', success: 9, total: 10, note: 'x' });
  await store.loadProgress();
  assert.equal(m.get('fpv-trainer-progress-v1-backup'), raw, '備份不可被覆蓋');
  assert.equal((await store.loadProgress()).levels.B1.logs.length, 2);
});

test('匯入 v1 匯出檔：轉成 v2 並寫入；v2 匯出再匯入內容一致', async () => {
  mockStorage();
  const p = await store.importJSON(JSON.stringify(V1));
  assert.deepEqual(p.levels.B3, V1.levels.turn);
  const out = store.exportJSON();
  mockStorage();
  const q = await store.importJSON(out);
  assert.deepEqual(q, JSON.parse(out));
});

test('匯入壞檔會丟錯、不改現有資料', async () => {
  mockStorage();
  await store.saveLevel('B2', { status: 'doing' });
  await assert.rejects(() => store.importJSON(JSON.stringify({ version: 9, levels: {} })));
  await assert.rejects(() => store.importJSON(JSON.stringify({ version: 2, levels: { B1: { status: 'nope', logs: [] } } })));
  assert.equal((await store.loadProgress()).levels.B2.status, 'doing');
});

test('沒有 localStorage（或讀不到）：回傳空進度不報錯', async () => {
  delete globalThis.localStorage;
  const p = await store.loadProgress();
  assert.deepEqual(p, { version: 2, levels: {} });
});
