// 나의 봄 — 서버
// 모바일 가챠 / 사이니지 실시간 들판 / 마감 스케줄러 / 관리자 집계
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

// 프로젝트 폴더의 .env 파일을 읽는다 (있으면). 실제 환경변수가 우선.
// 예: ADMIN_PASSWORD=비밀번호  /  CLOSING_TIME=18:00
try {
  const envFile = require('fs')
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .replace(/^\uFEFF/, '');   // 편집기가 붙인 BOM 제거 (첫 줄 키가 깨지지 않게)
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env 없으면 그냥 진행 */ }

const { drawFlower } = require('./gacha');
const store = require('./store');
const weather = require('./weather');

const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ_NAME || 'Asia/Seoul';
const CLOSING_TIME = process.env.CLOSING_TIME || '18:00';      // 진료 마감 시각 (HH:MM)
// 꽃은 정해진 날짜가 아니라 '들판이 얼마나 붐비는가'에 따라 떠난다.
const GARDEN_FLOOR  = Number(process.env.GARDEN_FLOOR  || 20);  // 이 아래로는 거의 줄지 않는다
const GARDEN_TARGET = Number(process.env.GARDEN_TARGET || 95);  // 평소 유지하고 싶은 정도
const GARDEN_MAX    = Number(process.env.GARDEN_MAX    || 150); // 이 위로는 빠르게 줄인다
const MAX_AGE_DAYS  = Number(process.env.MAX_AGE_DAYS  || 21);  // 아무리 한산해도 이만큼 지나면 떠남
const SEED_COUNT    = Number(process.env.SEED_COUNT    || 35);  // 처음 켤 때 미리 피워 둘 꽃
// 비밀번호가 지정되지 않으면 매번 임의로 만든다 (공개된 기본값을 두지 않는다).
// 운영 시에는 .env 의 ADMIN_PASSWORD 를 반드시 설정할 것.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
if (!process.env.ADMIN_PASSWORD) {
  console.log(`[주의] ADMIN_PASSWORD 가 없어 임시 비밀번호를 만들었습니다: ${ADMIN_PASSWORD}`);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
// admin.html 직접 접근은 /admin으로 돌린다 — Cloudflare Access의 경로 보호(admin)를
// /admin.html 로 우회할 수 없게 static 등록보다 먼저 선언
app.get('/admin.html', (_req, res) => res.redirect('/admin'));
// 캐시 금지: 업데이트 후 브라우저가 옛 스크립트를 들고 있으면 화면이 어긋난다
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate'),
}));
app.get('/garden', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'garden.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

// 뽑기 결과를 심기 전까지 잠시 보관 (클라이언트가 임의 꽃을 심지 못하게)
// 개인 식별 없음 — 무작위 토큰과 꽃 정보만, 10분 후 소멸
const pendingDraws = new Map();
const DRAW_TTL_MS = 10 * 60 * 1000;

function nowParts() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false, month: 'numeric',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { month: Number(parts.month), hhmm: `${parts.hour}:${parts.minute}` };
}

// ---- 참여 제한 ---------------------------------------------------------------
// 스크립트로 들판을 도배하지 못하게 하는 최소한의 장치.
// 개인 식별이 아니라 "같은 회선에서 짧은 시간에 몇 번인가"만 세고, 주기적으로 비운다.
const PLANT_LIMIT_PER_HOUR = Number(process.env.PLANT_LIMIT_PER_HOUR || 8);
const plantCounts = new Map();   // 회선 해시 -> { n, until }

function clientKey(req) {
  const ip = (req.headers['cf-connecting-ip'] || req.ip || '').toString();
  // 원문 IP를 저장하지 않도록 해시만 남긴다
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function overPlantLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  const rec = plantCounts.get(key);
  if (!rec || now > rec.until) {
    plantCounts.set(key, { n: 1, until: now + 60 * 60 * 1000 });
    return false;
  }
  rec.n += 1;
  return rec.n > PLANT_LIMIT_PER_HOUR;
}

// 한 시간마다 기록을 통째로 비운다 (아무것도 축적하지 않는다)
setInterval(() => plantCounts.clear(), 60 * 60 * 1000).unref();

// ---- 환자 API --------------------------------------------------------------

// 선택지 화이트리스트 — 자유 텍스트가 집계 키로 들어오지 못하게 고정값만 허용
const WEATHER_CHOICES = ['맑음', '조금 흐림', '무거움', '힘듦', '조용히'];
const NEED_CHOICES = require('./gacha').db.needs;

app.post('/api/draw', (req, res) => {
  const { need, weather } = req.body || {};
  const safeNeed = NEED_CHOICES.includes(need) ? need : null;
  const safeWeather = WEATHER_CHOICES.includes(weather) ? weather : null;
  const epicAllowed = store.canDrawEpicToday();
  const { flower, variant, rarity } = drawFlower({
    need: safeNeed,
    month: nowParts().month,
    epicAllowed,
  });
  if (rarity === 'epic') store.markEpicDrawn();

  const drawId = crypto.randomBytes(12).toString('hex');
  const seed = Math.floor(Math.random() * 1e9);
  // need/weather는 심기 완료 시 날짜별 집계에만 반영된 뒤 버려진다 (꽃과 연결 저장 안 함)
  pendingDraws.set(drawId, {
    flowerId: flower.id, variant, rarity, seed,
    need: safeNeed, weather: safeWeather, at: Date.now(),
  });
  setTimeout(() => pendingDraws.delete(drawId), DRAW_TTL_MS).unref();

  res.json({ drawId, flower, variant, rarity, seed });
});

// 자리 고르기 — 자연스러운 무작위를 유지하되, 기존 꽃과 거의 포개지는
// 자리만 다시 뽑는다 (꽃송이가 통째로 가려지는 일 방지)
const MIN_NEIGHBOR_DIST = 0; // %, 0 = 완전 무작위. 겹침을 피하고 싶으면 6~10으로
function pickPlacement() {
  const today = store.todayStr();
  const peers = store.state.flowers.filter((f) => f.date === today);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < 20; i++) {
    const x = 4 + Math.random() * 92;
    const y = Math.random();
    let minD = Infinity;
    for (const p of peers) {
      const dx = x - p.x;                    // 가로 거리(%)
      const dy = (y - (p.y ?? 0.5)) * 26;    // 밴드 세로폭을 %로 환산한 근사
      minD = Math.min(minD, Math.sqrt(dx * dx + dy * dy));
    }
    if (minD >= MIN_NEIGHBOR_DIST) return { x, y }; // 무작위 그대로 채택
    if (minD > bestScore) {
      bestScore = minD;
      best = { x, y };
    }
  }
  return best; // 들판이 빽빽하면 그나마 덜 겹치는 자리
}

app.post('/api/plant', (req, res) => {
  const { drawId } = req.body || {};
  const pending = drawId && pendingDraws.get(drawId);
  if (!pending) {
    return res.status(410).json({ error: 'expired', message: '뽑기 정보가 만료되었어요. 다시 한 번 뽑아 주세요.' });
  }
  if (overPlantLimit(req)) {
    return res.status(429).json({
      error: 'too-many',
      message: '오늘은 충분히 심으셨어요. 잠시 뒤에 다시 만나요.',
    });
  }
  pendingDraws.delete(drawId);

  const placement = pickPlacement();
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    flowerId: pending.flowerId,
    variant: pending.variant,
    rarity: pending.rarity,
    seed: pending.seed,
    x: placement.x,   // 들판 좌우 위치 (%)
    y: placement.y,   // 심도 밴드 내 상대 위치 (0=뒤, 1=앞)
    date: store.todayStr(),
  };
  store.addFlower(entry);
  store.addChoice(pending.weather, pending.need); // 날짜별 집계만 — entry에는 담지 않는다
  io.emit('flower:planted', entry);

  // 일회용 "들판 창문" 토큰 — 심은 직후 폰에서 들판을 한 번 볼 수 있다.
  // 서버 메모리에만 존재, 30분 뒤 소멸. 개인 연결 저장 없음.
  const windowToken = crypto.randomBytes(12).toString('hex');
  windowTokens.set(windowToken, { entry, expiresAt: Date.now() + WINDOW_TTL_MS, usedAt: null });
  setTimeout(() => windowTokens.delete(windowToken), WINDOW_TTL_MS + 60 * 1000).unref();

  res.json({ ok: true, windowToken });
});

// ---- 들판 창문 (환자 일회용 실시간 보기) -----------------------------------
const windowTokens = new Map();
const WINDOW_TTL_MS = 30 * 60 * 1000;   // 심은 뒤 30분 안에만 열 수 있다
const WINDOW_REOPEN_MS = 90 * 1000;     // 첫 열람 후 90초(새로고침 유예)가 지나면 닫힘

app.get('/api/window/:token', (req, res) => {
  const w = windowTokens.get(req.params.token);
  const now = Date.now();
  if (!w || now > w.expiresAt || (w.usedAt && now - w.usedAt > WINDOW_REOPEN_MS)) {
    return res.status(410).json({ error: 'window-closed' });
  }
  if (!w.usedAt) w.usedAt = now;
  res.json({ entry: w.entry, flowers: store.state.flowers, today: store.todayStr() });
});

// ---- 사이니지 API ----------------------------------------------------------

app.get('/api/garden', (_req, res) => {
  res.json({ flowers: store.state.flowers, today: store.todayStr() });
});

// 개발용: 꽃 카탈로그 (preview.html / garden.js 꽃 정의 조회)
app.get('/api/flowers', (_req, res) => {
  res.json(require('./gacha').db);
});

// 사이니지 연출 설정 — 실제 화면을 보며 조정하는 값들
// layers: ageDays(개화 후 경과일)별 크기(scale, px 높이)와 세로 배치 밴드(band, %)
// farLayer: lifeDays를 늘렸을 때 그 이상 나이의 꽃에 적용 (원경 풀숲 처리)
const LAYOUTS = {
  landscape: {
    layers: [
      { ageDays: 0, scale: [190, 260], band: [62, 90], opacity: 1,    blur: 0,   sat: 1    },
      { ageDays: 1, scale: [140, 185], band: [53, 70], opacity: 0.90, blur: 0.3, sat: 0.85 },
      { ageDays: 2, scale: [108, 145], band: [46, 59], opacity: 0.80, blur: 0.6, sat: 0.70 },
      { ageDays: 3, scale: [86, 116],  band: [42, 51], opacity: 0.68, blur: 0.9, sat: 0.55 },
    ],
    farLayer: { scale: [64, 90], band: [39, 47], opacity: 0.55, blur: 1.2, sat: 0.42 },
  },
  portrait: {
    layers: [
      { ageDays: 0, scale: [195, 270], band: [60, 90], opacity: 1,    blur: 0,   sat: 1    },
      { ageDays: 1, scale: [145, 195], band: [50, 68], opacity: 0.90, blur: 0.3, sat: 0.85 },
      { ageDays: 2, scale: [110, 150], band: [43, 56], opacity: 0.80, blur: 0.6, sat: 0.70 },
      { ageDays: 3, scale: [88, 120],  band: [38, 48], opacity: 0.68, blur: 0.9, sat: 0.55 },
    ],
    farLayer: { scale: [64, 94], band: [35, 43], opacity: 0.55, blur: 1.2, sat: 0.42 },
  },
};

app.get('/api/config', (_req, res) => {
  res.json({
    density: { floor: GARDEN_FLOOR, target: GARDEN_TARGET, max: GARDEN_MAX },
    closingTime: CLOSING_TIME,
    orientation: store.state.settings.orientation, // auto | landscape | portrait
    maxVisible: 80,   // 동시에 선명하게 보이는 꽃 상한
    layouts: LAYOUTS,
  });
});

// 실시간 날씨 (사이니지 연출용 — Open-Meteo 캐시)
app.get('/api/weather', (_req, res) => {
  res.json(weather.current);
});

// 사이니지 구석에 띄울 참여용 QR — PUBLIC_URL이 있으면 그 주소, 없으면 LAN IP
function lanIp() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return 'localhost';
}

// 갤러리 톤 QR: 둥근 먹색 점 + 둥근 모서리 표식 + 중앙 꽃 장식.
// 오류복원 H(30%)라 중앙 장식(면적 ~3%)이 있어도 스캔에 여유가 크다.
function styledQrSvg(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const INK = '#3A332B';
  const at = (x, y) => data[y * n + x] === 1;
  // 모서리 표식(파인더) 3곳은 따로 그린다
  const inFinder = (x, y) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  // 중앙 꽃 장식이 덮는 영역은 점을 비운다
  const c = n / 2, hole = 4.6;
  const inHole = (x, y) => Math.hypot(x + 0.5 - c, y + 0.5 - c) < hole;

  // 타이밍 패턴(6행/6열)과 얼라인먼트 패턴(우하단 5×5)은 인식 안정성을 위해 사각형 유지
  const alignC = n - 7;
  const inAlign = (x, y) =>
    n >= 25 && Math.abs(x - alignC) <= 2 && Math.abs(y - alignC) <= 2;
  const isTiming = (x, y) => x === 6 || y === 6;

  let dots = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!at(x, y) || inFinder(x, y) || inHole(x, y)) continue;
      if (isTiming(x, y) || inAlign(x, y)) {
        dots += `<rect x="${x + 0.04}" y="${y + 0.04}" width="0.92" height="0.92" rx="0.18"/>`;
      } else {
        dots += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.46"/>`;
      }
    }
  }
  const finder = (fx, fy) => `
    <rect x="${fx + 0.5}" y="${fy + 0.5}" width="6" height="6" rx="1.4" fill="none" stroke="${INK}" stroke-width="1.05"/>
    <rect x="${fx + 2}" y="${fy + 2}" width="3" height="3" rx="0.85" fill="${INK}"/>`;
  // 중앙 꽃: 둥근 꽃잎 6장 + 금빛 중심
  const petals = [0, 60, 120, 180, 240, 300].map((a) =>
    `<ellipse cx="0" cy="-1.55" rx="0.95" ry="1.5" fill="#D9A8BC" transform="rotate(${a})"/>`
  ).join('');
  const flower = `
    <circle cx="${c}" cy="${c}" r="${hole - 0.5}" fill="#FBF9F3"/>
    <g transform="translate(${c} ${c}) scale(0.82)">${petals}
      <circle r="0.85" fill="#C9A84C"/></g>`;

  const M = 2; // 여백(quiet zone)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-M} ${-M} ${n + M * 2} ${n + M * 2}" shape-rendering="geometricPrecision">
    <rect x="${-M}" y="${-M}" width="${n + M * 2}" height="${n + M * 2}" fill="#FBF9F3"/>
    <g fill="${INK}">${dots}</g>
    ${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}
    ${flower}</svg>`;
}

app.get('/api/qr', (_req, res) => {
  const url = process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}/`;
  try {
    res.json({ url, svg: styledQrSvg(url) });
  } catch (e) {
    res.status(500).json({ error: 'qr-failed' });
  }
});

// ---- 관리자 ---------------------------------------------------------------
// 환경변수 비밀번호 하나, 서버 메모리 세션 토큰 (개인정보 없음 — 날짜별 카운트만 노출)

const adminSessions = new Set();

// Cloudflare Access 인증을 트리거/확인하는 간단한 문. 토큰이 필요 없다.
// (관리 API 경로가 Access 로 보호될 때, 브라우저가 그 경로의 인증을 받게 하는 용도)
app.get('/api/admin/ping', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8">
    <title>인증 확인</title>
    <body style="font-family:system-ui;background:#F5F1E8;color:#35302A;display:flex;
      align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
    <div><p style="font-size:20px">인증이 확인되었습니다.</p>
    <p style="color:#7C7466">이 창을 닫고 관리 화면에서 다시 로그인해 주세요.</p></div>`);
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong-password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.add(token);
  setTimeout(() => adminSessions.delete(token), 12 * 60 * 60 * 1000).unref();
  res.json({ token });
});

app.get('/api/admin/stats', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // 최근 30일 날짜별 신규 꽃 수 + 선택지 집계 (빈 날은 0으로 채움)
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
    const choices = store.state.dailyChoices[key] || { weather: {}, need: {} };
    days.push({
      date: key,
      count: store.state.dailyCounts[key] || 0,
      weather: choices.weather,
      need: choices.need,
    });
  }
  res.json({ days, weatherChoices: WEATHER_CHOICES, needChoices: NEED_CHOICES });
});

// ---- 이별 규칙 (밀도 기반) --------------------------------------------------
// 들판이 한산하면 거의 아무도 떠나지 않고, 붐빌수록 오래된 꽃부터 자주 떠난다.
const DRIFT_START = process.env.DRIFT_START || '12:00';
const DRIFT_END   = process.env.DRIFT_END   || '19:30'; // 진료 종료 시각까지 바람이 분다
const DRIFT_INTERVAL_MIN = [15, 30];  // 바람 사이 간격(분) — 진료시간 기준 하루 약 20회
const GUSTS_PER_DAY = 20;             // 위 간격으로 하루에 부는 대략의 횟수

function hhmmToMin(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function ageOfDays(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date(store.todayStr() + 'T00:00:00');
  return Math.max(0, Math.round((today - new Date(y, m - 1, d)) / 86400000));
}

/** 나이 상한을 넘긴 꽃 (한산해도 결국 떠난다) */
function overAgeIds() {
  return store.state.flowers.filter((f) => ageOfDays(f.date) >= MAX_AGE_DAYS).map((f) => f.id);
}

/** 떠날 꽃 n송이 고르기 — 오래된 꽃일수록 뽑힐 확률이 높다 */
function pickDeparting(n, exclude = new Set()) {
  const pool = store.state.flowers
    .filter((f) => !exclude.has(f.id))
    .map((f) => ({ id: f.id, w: Math.pow(ageOfDays(f.date) + 1, 2) }));
  const picked = [];
  for (let k = 0; k < n && pool.length; k++) {
    const total = pool.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total, i = 0;
    while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
    picked.push(pool[i].id);
    pool.splice(i, 1);
  }
  return picked;
}

/** 바람 한 번에 몇 송이가 실려 갈지 — 붐빌수록 많아진다 */
function departCountForGust() {
  const c = store.state.flowers.length;
  if (c <= GARDEN_FLOOR) return 0;
  // 하루에 떠날 만한 총량을 먼저 정하고, 바람 횟수로 나눈다.
  // → 바람이 자주 불어도 이별이 잦아지지는 않는다 (대부분의 바람은 꽃을 데려가지 않는다)
  let perDay = ((c - GARDEN_FLOOR) / (GARDEN_TARGET - GARDEN_FLOOR)) * 21.6;
  if (c > GARDEN_MAX) perDay += (c - GARDEN_MAX) * 2.2;
  const expected = Math.min(perDay / GUSTS_PER_DAY, 4);
  return Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
}

function runGust() {
  const aged = overAgeIds();
  const ids = [...aged, ...pickDeparting(departCountForGust(), new Set(aged))];
  if (ids.length) {
    store.removeFlowers(ids);
    console.log(`[바람] ${ids.length}송이가 실려 갔습니다. (남은 ${store.state.flowers.length})`);
  }
  // 바람의 성격을 서버가 정해 모든 화면이 같은 바람을 본다
  const r = Math.random();
  const gust = {
    ids,
    dir: Math.random() < 0.5 ? -1 : 1,                  // 1=왼→오른쪽, -1=반대
    // 센 바람은 대기실 정서를 흔들 수 있어 아주 드물게만 (하루 1회 안팎)
    strength: r < 0.65 ? 'soft' : r < 0.95 ? 'normal' : 'strong',
    swirl: Math.random() < 0.3,                          // 이따금 소용돌이치듯
  };
  io.emit('garden:gust', gust); // 떠날 꽃이 없어도 바람은 분다
}

let nextGustAt = 0;
setInterval(() => {
  const m = hhmmToMin(nowParts().hhmm);
  if (m >= hhmmToMin(DRIFT_START) && m < hhmmToMin(DRIFT_END)) {
    if (Date.now() >= nextGustAt) {
      runGust();
      const gap = DRIFT_INTERVAL_MIN[0] + Math.random() * (DRIFT_INTERVAL_MIN[1] - DRIFT_INTERVAL_MIN[0]);
      nextGustAt = Date.now() + gap * 60 * 1000;
    }
  } else {
    nextGustAt = 0;
  }
}, 60 * 1000).unref();

// ---- 마감 연출 -------------------------------------------------------------
// 그날 붐빈 만큼 저녁에 함께 떠난다. 한산했던 날은 아무도 떠나지 않는다.
let lastSweepDate = null;

function runClosingSweep() {
  lastSweepDate = store.todayStr();
  store.pruneOldStats(60); // 60일 지난 집계는 정리
  backupGarden();
  const c = store.state.flowers.length;
  const evening = Math.round(GARDEN_TARGET * 0.85);
  const aged = overAgeIds();
  const n = Math.min(Math.max(0, c - aged.length - evening), 25); // 한 번에 너무 많이 비우지 않게
  const ids = [...aged, ...pickDeparting(n, new Set(aged))];
  if (ids.length) {
    store.removeFlowers(ids);
    io.emit('garden:sweep', { ids });
    console.log(`[마감] ${ids.length}송이가 바람에 실려 떠났습니다. (남은 ${store.state.flowers.length})`);
  } else {
    console.log('[마감] 오늘 떠나는 꽃은 없습니다.');
  }
}

setInterval(() => {
  const { hhmm } = nowParts();
  if (hhmm === CLOSING_TIME && lastSweepDate !== store.todayStr()) runClosingSweep();
}, 20 * 1000).unref();

// ---- 특별한 날 -------------------------------------------------------------
// data/special-days.json 에 정의. 오늘 해당하는 이펙트를 사이니지에 알려준다.
const SPECIAL_PATH = path.join(__dirname, '..', 'data', 'special-days.json');

function loadSpecialDays() {
  try {
    return JSON.parse(require('fs').readFileSync(SPECIAL_PATH, 'utf8'));
  } catch { return { days: [] }; }
}

/** 'MM-DD' 또는 'MM-DD~MM-DD' 형식이 오늘과 맞는지 */
function matchesToday(when, todayMD) {
  if (when.includes('~')) {
    const [a, b] = when.split('~').map((x) => x.trim());
    return todayMD >= a && todayMD <= b;
  }
  return when === todayMD;
}

app.get('/api/special', (_req, res) => {
  if (store.state.settings.specialDays === false) return res.json({ active: [] });
  const todayMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()).slice(5);
  const active = loadSpecialDays().days.filter(
    (d) => d.enabled !== false && (d.when || []).some((w) => matchesToday(w, todayMD))
  );
  res.json({ active });
});

// ---- 일일 백업 --------------------------------------------------------------
function backupGarden() {
  try {
    const fs = require('fs');
    const dir = path.join(__dirname, '..', 'data', 'backup');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '..', 'data', 'garden.json'),
      path.join(dir, `garden-${store.todayStr()}.json`)
    );
    // 최근 14개만 남긴다
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('garden-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 14))) {
      fs.unlinkSync(path.join(dir, f));
    }
  } catch (e) { console.log('[백업] 실패:', e.message); }
}

// ---- 개원 초기 들판 채우기 ---------------------------------------------------
// 화면이 썰렁하지 않도록, 서버 시작 시 SEED_COUNT 미만이면 그만큼 채운다.
// 집계(관리자 통계)에는 잡히지 않으며, 이후 실제 꽃이 늘면 오래된 순으로 자연히 자리를 내준다.
function seedInitialGarden() {
  const need = SEED_COUNT - store.state.flowers.length;
  if (need <= 0) return;
  const month = nowParts().month;
  for (let i = 0; i < need; i++) {
    const { flower, variant, rarity } = drawFlower({ need: null, month, epicAllowed: false });
    // 나이를 어린 쪽으로 치우치게 — 전경(가까운 곳)이 비어 보이지 않도록
    // 40% 오늘 / 27% 어제 / 20% 2일 / 13% 3일
    const r = Math.random();
    const ageDays = r < 0.4 ? 0 : r < 0.67 ? 1 : r < 0.87 ? 2 : 3;
    const d = new Date();
    d.setDate(d.getDate() - ageDays);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
    store.seedFlower({
      id: crypto.randomBytes(8).toString('hex'),
      flowerId: flower.id, variant, rarity,
      seed: Math.floor(Math.random() * 1e9),
      x: 4 + Math.random() * 92,
      y: Math.random(),
      date,
    });
  }
  console.log(`들판이 한산해 ${need}송이를 미리 피웠습니다. (총 ${store.state.flowers.length})`);
}
seedInitialGarden();

// 시작 시 나이 상한을 넘긴 꽃 정리 (연출 없이 조용히)
{
  const stale = overAgeIds();
  if (stale.length) {
    store.removeFlowers(stale);
    console.log(`시작 정리: 오래된 꽃 ${stale.length}송이 삭제`);
  }
}

// 관리자: 사이니지 화면 방향 변경 — 저장 후 사이니지에 실시간 반영
app.post('/api/admin/display', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  const { orientation } = req.body || {};
  if (!['auto', 'landscape', 'portrait'].includes(orientation)) {
    return res.status(400).json({ error: 'bad-orientation' });
  }
  store.setSetting('orientation', orientation);
  io.emit('display:config', { orientation });
  res.json({ ok: true, orientation });
});

app.get('/api/admin/display', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    orientation: store.state.settings.orientation,
    weather: weather.current,
    specialDays: store.state.settings.specialDays !== false,
  });
});

// 관리자: 통계 초기화 — 날짜별 집계만 삭제 (들판의 꽃은 유지)
app.post('/api/admin/reset-stats', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  store.resetStats();
  console.log('[관리] 통계가 초기화되었습니다.');
  res.json({ ok: true });
});

// 관리자: 실수로 심긴 꽃 되돌리기.
// 원칙상 개별 꽃 정보는 화면에 노출하지 않으므로, 목록 없이 "가장 최근" 또는
// "오늘 심긴 것 전체"만 지울 수 있게 한다.
app.post('/api/admin/undo-flower', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  const { scope } = req.body || {};
  const flowers = store.state.flowers;
  let ids = [];
  if (scope === 'today') {
    ids = flowers.filter((f) => f.date === store.todayStr()).map((f) => f.id);
  } else {
    const last = flowers[flowers.length - 1];
    if (last) ids = [last.id];
  }
  if (ids.length) {
    store.removeFlowers(ids);
    io.emit('garden:sweep', { ids });
  }
  res.json({ ok: true, removed: ids.length });
});

// 관리자: 특별한 날 이펙트 on/off
app.post('/api/admin/special-days', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  store.setSetting('specialDays', req.body?.enabled !== false);
  res.json({ ok: true });
});

// ---- 원격 업데이트 (GitHub) --------------------------------------------------
// 저장소의 server/ · public/ 만 받아 덮어쓴다. .env 와 들판 데이터는 건드리지 않는다.
const UPDATE_REPO = process.env.UPDATE_REPO || 'evenzest-afk/mybom-garden';
const UPDATE_BRANCH = process.env.UPDATE_BRANCH || 'main';
const ROOT_DIR = path.join(__dirname, '..');
const VERSION_PATH = path.join(ROOT_DIR, 'data', 'version.json');
const ROLLBACK_DIR = path.join(ROOT_DIR, 'data', 'rollback');

function localVersion() {
  try { return JSON.parse(require('fs').readFileSync(VERSION_PATH, 'utf8')); }
  catch { return { sha: null, at: null }; }
}

/** 되돌리기용으로 현재 server/·public/ 을 통째로 복사해 둔다 */
function saveRollback() {
  const fs = require('fs');
  fs.rmSync(ROLLBACK_DIR, { recursive: true, force: true });
  for (const dir of ['server', 'public']) {
    fs.cpSync(path.join(ROOT_DIR, dir), path.join(ROLLBACK_DIR, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(ROLLBACK_DIR, 'version.json'), JSON.stringify(localVersion(), null, 2));
}

app.get('/api/admin/update/check', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/commits/${UPDATE_BRANCH}`,
      { headers: { 'User-Agent': 'mybom-garden' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('github ' + r.status);
    const c = await r.json();
    const cur = localVersion();
    res.json({
      current: cur.sha, currentAt: cur.at,
      latest: c.sha,
      message: (c.commit.message || '').split('\n')[0],
      date: c.commit.committer.date,
      updateAvailable: c.sha !== cur.sha,
      canRollback: require('fs').existsSync(ROLLBACK_DIR),
    });
  } catch (e) {
    res.status(502).json({ error: 'check-failed', message: e.message });
  }
});

app.post('/api/admin/update/apply', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  const fs = require('fs');
  try {
    const meta = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/commits/${UPDATE_BRANCH}`,
      { headers: { 'User-Agent': 'mybom-garden' }, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const zipRes = await fetch(`https://codeload.github.com/${UPDATE_REPO}/zip/refs/heads/${UPDATE_BRANCH}`,
      { signal: AbortSignal.timeout(60000) });
    if (!zipRes.ok) throw new Error('download ' + zipRes.status);
    // adm-zip 은 원격 업데이트에만 쓴다. 예전 설치본에는 없을 수 있으므로
    // 여기서 늦게 불러온다 — 없더라도 사이니지는 정상 동작해야 한다.
    let AdmZip;
    try { AdmZip = require('adm-zip'); }
    catch { throw new Error('adm-zip 모듈이 없습니다. USB의 업데이트.bat 으로 한 번 갱신해 주세요.'); }
    const zip = new AdmZip(Buffer.from(await zipRes.arrayBuffer()));
    const entries = zip.getEntries();
    if (!entries.length) throw new Error('빈 압축');
    const base = entries[0].entryName.split('/')[0] + '/';

    // 받은 내용이 온전한지 먼저 확인 (반쯤 적용되는 사고 방지)
    const wanted = entries.filter((e) => !e.isDirectory)
      .map((e) => e.entryName.slice(base.length))
      .filter((n) => n.startsWith('server/') || n.startsWith('public/'));
    if (!wanted.includes('server/index.js') || !wanted.includes('public/garden.html')) {
      throw new Error('내려받은 파일이 온전하지 않습니다');
    }

    saveRollback();
    for (const e of entries) {
      if (e.isDirectory) continue;
      const rel = e.entryName.slice(base.length);
      if (!(rel.startsWith('server/') || rel.startsWith('public/'))) continue;
      const dest = path.join(ROOT_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
    fs.writeFileSync(VERSION_PATH, JSON.stringify(
      { sha: meta.sha, at: new Date().toISOString(), message: (meta.commit.message || '').split('\n')[0] }, null, 2));

    res.json({ ok: true, applied: meta.sha, restarting: true });
    console.log('[업데이트] 적용 완료 — 재시작합니다:', meta.sha.slice(0, 7));
    setTimeout(() => process.exit(0), 600); // 지킴이가 다시 띄운다
  } catch (e) {
    console.log('[업데이트] 실패:', e.message);
    res.status(500).json({ error: 'apply-failed', message: e.message });
  }
});

app.post('/api/admin/update/rollback', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'unauthorized' });
  const fs = require('fs');
  if (!fs.existsSync(ROLLBACK_DIR)) return res.status(404).json({ error: 'no-backup' });
  try {
    for (const dir of ['server', 'public']) {
      fs.rmSync(path.join(ROOT_DIR, dir), { recursive: true, force: true });
      fs.cpSync(path.join(ROLLBACK_DIR, dir), path.join(ROOT_DIR, dir), { recursive: true });
    }
    fs.copyFileSync(path.join(ROLLBACK_DIR, 'version.json'), VERSION_PATH);
    res.json({ ok: true, restarting: true });
    console.log('[업데이트] 직전 버전으로 되돌렸습니다 — 재시작합니다');
    setTimeout(() => process.exit(0), 600);
  } catch (e) {
    res.status(500).json({ error: 'rollback-failed', message: e.message });
  }
});

// 개발용 수동 마감 트리거 (관리자 토큰 필요)
app.post('/api/admin/sweep', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  runClosingSweep();
  res.json({ ok: true });
});

// 개발용 수동 바람 트리거 (관리자 토큰 필요)
app.post('/api/admin/gust', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  runGust();
  res.json({ ok: true });
});

weather.init(io);

server.listen(PORT, () => {
  console.log(`나의 봄 서버 시작 — http://localhost:${PORT}`);
  console.log(`  사이니지: /garden · 관리자: /admin · 마감 ${CLOSING_TIME} · 들판 ${GARDEN_FLOOR}~${GARDEN_TARGET}송이 유지`);
  if (process.env.PUBLIC_URL) console.log(`  외부 주소: ${process.env.PUBLIC_URL}`);
});
