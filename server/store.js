// 들판 상태 영속화 — 개인정보 없음: 꽃 종류/색상/위치/개화 "일자"만 저장
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'garden.json');

const DEFAULT_STATE = {
  flowers: [],        // { flowerId, variant, x, y, seed, date }  (date = YYYY-MM-DD, 시각 미저장)
  dailyCounts: {},    // { "YYYY-MM-DD": n } — 관리자 화면용 집계
  dailyChoices: {},   // { "YYYY-MM-DD": { weather: {맑음: n, ...}, need: {쉼: n, ...} } }
                      // 날짜별 선택지 집계뿐 — 개별 참여·꽃과는 연결되지 않음
  epicDate: null,     // 아주 드묾 꽃이 마지막으로 등장한 날짜 (하루 1회 제한용)
  settings: {
    orientation: 'auto', // 사이니지 화면 방향: auto | landscape | portrait
  },
};

let state = load();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      ...DEFAULT_STATE,
      ...raw,
      settings: { ...DEFAULT_STATE.settings, ...(raw.settings || {}) },
    };
  } catch {
    return { ...DEFAULT_STATE, settings: { ...DEFAULT_STATE.settings } };
  }
}

let saveTimer = null;
function save() {
  // 짧은 디바운스로 연속 쓰기 묶기
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }, 200);
}

function todayStr(tz = 'Asia/Seoul') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/** 집계에 잡히지 않는 꽃 심기 — 개원 초기 들판을 채우는 씨앗용. */
function seedFlower(entry) {
  state.flowers.push(entry);
  save();
}

function addFlower(entry) {
  state.flowers.push(entry);
  state.dailyCounts[entry.date] = (state.dailyCounts[entry.date] || 0) + 1;
  save();
}

/** 심기 완료 시 그날의 선택지 집계 증가. 값이 없으면(옛 클라이언트 등) 조용히 건너뜀. */
function addChoice(weather, need) {
  const day = todayStr();
  if (!state.dailyChoices[day]) state.dailyChoices[day] = { weather: {}, need: {} };
  const bucket = state.dailyChoices[day];
  if (weather) bucket.weather[weather] = (bucket.weather[weather] || 0) + 1;
  if (need) bucket.need[need] = (bucket.need[need] || 0) + 1;
  save();
}

function canDrawEpicToday() {
  return state.epicDate !== todayStr();
}

function markEpicDrawn() {
  state.epicDate = todayStr();
  save();
}

/** 오래된 집계만 정리 (꽃은 건드리지 않는다). */
function pruneOldStats(keepDays = 60) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cc = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(cutoff);
  let changed = false;
  for (const d of Object.keys(state.dailyCounts)) {
    if (d < cc) { delete state.dailyCounts[d]; changed = true; }
  }
  for (const d of Object.keys(state.dailyChoices)) {
    if (d < cc) { delete state.dailyChoices[d]; changed = true; }
  }
  if (changed) save();
}

/** 지정된 꽃들만 제거 (낮 동안의 바람 연출용). */
function removeFlowers(ids) {
  const set = new Set(ids);
  const removed = state.flowers.filter((f) => set.has(f.id));
  state.flowers = state.flowers.filter((f) => !set.has(f.id));
  if (removed.length) save();
  return removed;
}

/** 통계만 초기화 — 들판의 꽃과 화면 설정은 그대로 둔다. */
function resetStats() {
  state.dailyCounts = {};
  state.dailyChoices = {};
  save();
}

function setSetting(key, value) {
  state.settings[key] = value;
  save();
}

module.exports = {
  get state() { return state; },
  addFlower,
  seedFlower,
  addChoice,
  canDrawEpicToday,
  markEpicDrawn,
  pruneOldStats,
  removeFlowers,
  resetStats,
  todayStr,
  setSetting,
};
