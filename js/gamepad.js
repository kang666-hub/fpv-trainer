// 遙控器（USB 搖桿 / Gamepad API）輸入。
// 上半部是純函式（無 DOM、可在 Node 測試），下半部是瀏覽器端輪詢。

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 預設 mapping 用 AETR（0=Roll、1=Pitch、2=油門、3=Yaw）。這只是假設，未在 TX15 MAX 實機驗證，
// 所以首次連線一定要走校正，不可直接當成正確。
export const DEFAULT_GAMEPAD = {
  id: '',
  axes: {
    thr:   { index: 2, invert: false, min: -1, max: 1 },
    yaw:   { index: 3, invert: false, min: -1, max: 1, center: 0 },
    pitch: { index: 1, invert: false, min: -1, max: 1, center: 0 },
    roll:  { index: 0, invert: false, min: -1, max: 1, center: 0 },
  },
  deadzone: 0.03,
  expo: 0,
  rateScale: 1,
};

// |v| < dz 回 0，其餘重新映射到 0～±1（dz 邊界連續）
export function applyDeadzone(v, dz) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  if (dz >= 1) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}

// v*(1-expo) + v^3*expo
export function applyExpo(v, expo) {
  return v * (1 - expo) + v * v * v * expo;
}

// 原始軸值 → {thr: 0～1, yaw/pitch/roll: -1～1}。
// thr 用 min/max 線性換算；其餘以 center 為 0，正負兩側各自除以到 max／min 的距離，再夾限。
export function mapAxes(rawAxes, mapping) {
  const out = {};
  for (const key of ['thr', 'yaw', 'pitch', 'roll']) {
    const m = mapping[key];
    const raw = rawAxes[m.index];
    if (!Number.isFinite(raw)) { out[key] = 0; continue; }
    if (key === 'thr') {
      const span = m.max - m.min;
      let v = span > 1e-6 ? (raw - m.min) / span : 0;
      v = clamp(v, 0, 1);
      out.thr = m.invert ? 1 - v : v;
    } else {
      const c = m.center ?? (m.min + m.max) / 2;
      const d = raw - c;
      const half = d >= 0 ? m.max - c : c - m.min;
      let v = half > 1e-6 ? d / half : 0;
      v = clamp(v, -1, 1);
      out[key] = m.invert ? -v : v;
    }
  }
  return out;
}

// 死區 → Expo → Rate 倍率（夾限在 ±1）。只作用在 yaw/pitch/roll，油門不動。
export function shapeSticks(s, { deadzone = 0, expo = 0, rateScale = 1 } = {}) {
  const f = (v) => clamp(applyExpo(applyDeadzone(v, deadzone), expo) * rateScale, -1, 1);
  return { thr: s.thr, yaw: f(s.yaw), pitch: f(s.pitch), roll: f(s.roll) };
}

// 校正用：找出位移最大的軸。direction 為 +1／-1（位移為 0 時是 0）。沒有軸時 index = -1。
export function detectAxis(baseline, current) {
  let index = -1, delta = 0;
  const n = Math.min(baseline.length, current.length);
  for (let i = 0; i < n; i++) {
    const d = current[i] - baseline[i];
    if (Math.abs(d) > Math.abs(delta)) { index = i; delta = d; }
  }
  return { index, direction: Math.sign(delta), delta: Math.abs(delta) };
}

// 校正結果 → axes 設定。
// assign: {thr|yaw|pitch|roll: {index, direction}}（direction < 0 代表要反向）
// range:  {軸編號: {min, max}}（校正過程中看到的原始極值）
// center: 放回中間時的原始軸值陣列
export function finalizeCalibration({ assign, range, center }) {
  const axes = {};
  for (const key of ['thr', 'yaw', 'pitch', 'roll']) {
    const { index, direction } = assign[key];
    const r = range[index];
    axes[key] = { index, invert: direction < 0, min: r.min, max: r.max };
    if (key !== 'thr') axes[key].center = center[index];
  }
  return axes;
}

// ===== 瀏覽器端 =====
export function isSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
}

export function createGamepadInput() {
  let mapping = null;
  let lastId = null;
  const listeners = new Set();

  const pick = () => {
    if (!isSupported()) return null;
    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return null; }
    for (const p of pads) if (p && p.connected && p.axes.length >= 4) return p;
    return null;
  };
  const emit = () => {
    const p = pick(), id = p ? p.id : null;
    if (id === lastId) return;
    lastId = id;
    for (const fn of listeners) fn(id);
  };
  if (typeof addEventListener === 'function') {
    addEventListener('gamepadconnected', emit);
    addEventListener('gamepaddisconnected', emit);
  }

  return {
    supported: isSupported(),
    setMapping(m) { mapping = m; },
    onChange(fn) { listeners.add(fn); },
    // 每個畫面更新呼叫一次：補抓沒有事件通知的狀態變化
    poll() { emit(); },
    getId() { return lastId; },
    getRaw() { const p = pick(); return p ? Array.from(p.axes) : null; },
    // 已連接且有 mapping 才有值；否則回 null（呼叫端退回鍵盤／觸控）
    getSticks() {
      const raw = this.getRaw();
      return raw && mapping ? mapAxes(raw, mapping) : null;
    },
  };
}
