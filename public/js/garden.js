/* 나의 봄 — 사이니지 들판 (가로/세로 대응 · 실시간 날씨 연동) */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const flowersEl = $('#flowers');

  let CONFIG = null;            // /api/config
  let CATALOG = null;           // flowerId -> 꽃 정의
  let ORIENT_SETTING = 'auto';  // auto | landscape | portrait (관리 화면에서 변경)
  let WEATHER = { category: 'clear', windKmh: 0 };
  const onField = new Map();    // id -> { entry, el }
  let fieldBaseAge = 0;         // 들판에서 가장 최근 꽃의 나이 — 깊이의 기준점
  const rank = new Map();       // id -> 최신순 순위 (밀도 상한 판단용)


  // 튜닝용 URL 파라미터: ?hour=18.5  ?weather=rain|snow|cloudy|overcast|clear  ?wind=30
  const PARAMS = new URLSearchParams(location.search);
  let FORCED_HOUR = PARAMS.get('hour') === null ? null : Number(PARAMS.get('hour'));
  const FORCED_WEATHER = PARAMS.get('weather');
  const FORCED_WIND = PARAMS.get('wind') === null ? null : Number(PARAMS.get('wind'));
  // 환자 일회용 창문 모드: /garden?w=토큰 (심은 직후 30분, 한 번만)
  const WINDOW_TOKEN = PARAMS.get('w');
  const FORCED_GUST = PARAMS.get('gust');   // soft|normal|strong — 바람 세기 미리보기
  const DEMO = PARAMS.get('demo') !== null; // 시연 모드: 오늘의 연출을 차례로 보여준다
  let guestEntry = null;

  // ---------------------------------------------------------------- 유틸
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  function hexLerp(h1, h2, t) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [r1, g1, b1] = p(h1), [r2, g2, b2] = p(h2);
    const c = (v) => Math.round(v).toString(16).padStart(2, '0');
    return `#${c(lerp(r1, r2, t))}${c(lerp(g1, g2, t))}${c(lerp(b1, b2, t))}`;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function ageDays(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((t - new Date(y, m - 1, d)) / 86400000));
  }

  // 시드 기반 결정적 난수 (같은 꽃은 항상 같은 자리·같은 흔들림)
  function seededRand(seed, salt) {
    const rng = FlowerSVG.mulberry32(seed + salt);
    return rng();
  }

  // ---------------------------------------------------------------- 화면 방향
  function effectiveOrientation() {
    if (ORIENT_SETTING === 'landscape' || ORIENT_SETTING === 'portrait') return ORIENT_SETTING;
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }

  function currentLayout() {
    return CONFIG.layouts[effectiveOrientation()];
  }

  function applyOrientation() {
    const o = effectiveOrientation();
    document.body.classList.toggle('portrait', o === 'portrait');
    for (const { entry, el } of onField.values()) applyLayout(entry, el);
    makeGrass();
  }

  // ---------------------------------------------------------------- 하늘
  const SKY_KEYS = [
    { h: 0,  top: '#232838', mid: '#2E3448', bot: '#3D4254', glow: 'rgba(214,222,240,0.12)', gx: 78, gy: 16, warm: 'rgba(70,84,130,0.30)', warmO: 0.5, night: 0.85 },
    { h: 5,  top: '#2A3040', mid: '#3A3F52', bot: '#4E4E5C', glow: 'rgba(226,214,220,0.15)', gx: 20, gy: 60, warm: 'rgba(120,100,130,0.25)', warmO: 0.4, night: 0.7 },
    { h: 7,  top: '#B8AFB4', mid: '#D6C6B4', bot: '#E6D6BC', glow: 'rgba(240,214,190,0.6)',  gx: 24, gy: 52, warm: 'rgba(232,190,160,0.5)', warmO: 0.5, night: 0 },
    { h: 10, top: '#B6C8CE', mid: '#D8DCC8', bot: '#E8E2C8', glow: 'rgba(250,244,214,0.5)',  gx: 40, gy: 30, warm: 'rgba(250,244,200,0.28)', warmO: 0.28, night: 0 },
    { h: 13, top: '#AFC6CF', mid: '#D4DCC6', bot: '#E6E2C6', glow: 'rgba(252,248,224,0.55)', gx: 52, gy: 22, warm: 'rgba(252,250,220,0.22)', warmO: 0.2, night: 0 },
    { h: 16, top: '#B4BEC2', mid: '#DCD4BC', bot: '#E9DBBB', glow: 'rgba(248,228,190,0.55)', gx: 66, gy: 34, warm: 'rgba(244,214,170,0.35)', warmO: 0.35, night: 0 },
    { h: 18, top: '#A99FA6', mid: '#D2B49E', bot: '#E4C6A2', glow: 'rgba(240,196,150,0.68)', gx: 76, gy: 52, warm: 'rgba(230,168,120,0.5)', warmO: 0.6, night: 0.06 },
    { h: 19.5, top: '#5A5468', mid: '#77687A', bot: '#93788A', glow: 'rgba(226,182,160,0.4)', gx: 80, gy: 66, warm: 'rgba(160,120,140,0.4)', warmO: 0.5, night: 0.35 },
    { h: 21, top: '#2A3040', mid: '#3A3F52', bot: '#4E4E5C', glow: 'rgba(218,222,238,0.14)', gx: 70, gy: 20, warm: 'rgba(80,90,130,0.3)', warmO: 0.5, night: 0.75 },
    { h: 24, top: '#232838', mid: '#2E3448', bot: '#3D4254', glow: 'rgba(214,222,240,0.12)', gx: 78, gy: 16, warm: 'rgba(70,84,130,0.30)', warmO: 0.5, night: 0.85 },
  ];

  function skyAt(hour) {
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (hour >= SKY_KEYS[i].h && hour <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    }
    const t = (hour - a.h) / Math.max(0.001, b.h - a.h);
    return {
      top: hexLerp(a.top, b.top, t), mid: hexLerp(a.mid, b.mid, t), bot: hexLerp(a.bot, b.bot, t),
      glow: t < 0.5 ? a.glow : b.glow,
      gx: lerp(a.gx, b.gx, t), gy: lerp(a.gy, b.gy, t),
      warm: t < 0.5 ? a.warm : b.warm,
      warmO: lerp(a.warmO, b.warmO, t),
      night: lerp(a.night, b.night, t),
    };
  }

  function updateSky() {
    const now = new Date();
    const hour = FORCED_HOUR !== null ? FORCED_HOUR : now.getHours() + now.getMinutes() / 60;
    const s = skyAt(hour);
    $('#sky').style.background = `linear-gradient(180deg, ${s.top} 0%, ${s.mid} 55%, ${s.bot} 100%)`;
    const glow = $('#sun-glow');
    glow.style.left = s.gx + '%';
    glow.style.top = s.gy + '%';
    glow.style.background = `radial-gradient(circle, ${s.glow}, transparent 70%)`;
    $('#light-warm').style.background = s.warm;
    $('#light-warm').style.opacity = s.warmO * (WEATHER.category === 'clear' ? 1 : 0.45);
    $('#light-night').style.opacity = s.night;
    document.body.classList.toggle('dark', s.night > 0.3);
  }

  // ---------------------------------------------------------------- 날씨
  function applyWeather(w) {
    WEATHER = {
      category: FORCED_WEATHER || w.category || 'clear',
      windKmh: FORCED_WIND !== null ? FORCED_WIND : (w.windKmh || 0),
    };
    // 몸통 클래스: 구름·씻김 오버레이는 CSS가 처리
    document.body.classList.remove('w-clear', 'w-cloudy', 'w-overcast', 'w-rain', 'w-snow');
    document.body.classList.add('w-' + WEATHER.category);

    // 바람: 흔들림 진폭 배수 (10km/h 이하 1.0 ~ 40km/h 이상 2.6)
    const wind = Math.min(2.6, Math.max(1, 1 + (WEATHER.windKmh - 10) / 20));
    document.getElementById('stage').style.setProperty('--wind', wind.toFixed(2));

    makePrecipitation(WEATHER.category);
    updateSky();
  }

  function makePrecipitation(category) {
    const wrap = $('#weather-particles');
    wrap.innerHTML = '';
    if (category === 'rain') {
      // 차분하지만 또렷하게 보이는 비
      for (let i = 0; i < 110; i++) {
        const d = document.createElement('div');
        d.className = 'rain-drop';
        d.style.left = rand(-4, 102) + '%';
        d.style.height = rand(18, 34) + 'px';
        d.style.animationDuration = rand(0.75, 1.25).toFixed(2) + 's';
        d.style.animationDelay = (-rand(0, 1.5)).toFixed(2) + 's';
        d.style.opacity = rand(0.35, 0.6).toFixed(2);
        wrap.appendChild(d);
      }
    } else if (category === 'snow') {
      for (let i = 0; i < 46; i++) {
        const d = document.createElement('div');
        d.className = 'snow-flake';
        const sz = rand(3, 7);
        d.style.width = d.style.height = sz + 'px';
        d.style.left = rand(-4, 102) + '%';
        d.style.animationDuration = rand(9, 18).toFixed(1) + 's';
        d.style.animationDelay = (-rand(0, 18)).toFixed(1) + 's';
        d.style.opacity = rand(0.5, 0.9).toFixed(2);
        wrap.appendChild(d);
      }
    }
  }

  async function pollWeather() {
    try {
      const w = await fetch('/api/weather').then((r) => r.json());
      applyWeather(w);
    } catch (e) { /* 오프라인: 시간대 빛만으로 동작 */ }
  }

  // ---------------------------------------------------------------- 특별한 날
  let SPECIAL = [];

  function hasEffect(name) {
    return SPECIAL.some((d) => (d.effects || []).includes(name));
  }

  function applySpecial(active) {
    SPECIAL = active || [];
    const layer = $('#special-layer');
    layer.innerHTML = '';

    if (hasEffect('sunrise')) {
      const el = document.createElement('div');
      el.className = 'sp-sunrise';
      layer.appendChild(el);
    }
    if (hasEffect('glow')) {
      const el = document.createElement('div');
      el.className = 'sp-glow';
      layer.appendChild(el);
    }
    if (hasEffect('lights')) {
      // 들판이 시작되는 능선을 따라 작은 불빛
      const top = effectiveOrientation() === 'portrait' ? 36 : 39;
      for (let i = 0; i < 22; i++) {
        const d = document.createElement('div');
        d.className = 'sp-light';
        d.style.left = rand(1, 98) + '%';
        d.style.top = (top + rand(-0.6, 1.4)) + '%';
        d.style.animationDuration = rand(1.6, 3.4).toFixed(1) + 's';
        d.style.animationDelay = (-rand(0, 3)).toFixed(1) + 's';
        layer.appendChild(d);
      }
    }
    if (hasEffect('star')) {
      const el = document.createElement('div');
      el.className = 'sp-star';
      el.style.left = '20%'; el.style.top = '13%';
      layer.appendChild(el);
    }
    if (hasEffect('moon')) {
      const el = document.createElement('div');
      el.className = 'sp-moon';
      el.style.left = '17%'; el.style.top = '11%';
      layer.appendChild(el);
    }
    if (hasEffect('snow')) makePrecipitation('snow');
    if (hasEffect('petals')) startAmbientPetals();

    // 한 줄 문구는 아주 가끔, 조용히 떴다 사라진다
    const msg = SPECIAL.map((d) => d.message).filter(Boolean)[0];
    const el = $('#special-msg');
    if (msg) {
      el.textContent = msg;
      const cycle = () => {
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 12000);
      };
      setTimeout(cycle, 4000);
      setInterval(cycle, 5 * 60 * 1000);
    }
  }

  // 벚꽃철처럼 하루 종일 꽃잎이 조금씩 흩날리는 날
  let ambientPetalTimer = null;
  function startAmbientPetals() {
    if (ambientPetalTimer) return;
    ambientPetalTimer = setInterval(() => {
      playGust({ dir: Math.random() < 0.5 ? -1 : 1, strength: 'soft', swirl: Math.random() < 0.4, ids: [] });
    }, 70000);
  }

  // ---------------------------------------------------------------- 꽃 배치
  function layerFor(entry) {
    const cap = CONFIG.maxVisible || Infinity;
    if ((rank.get(entry.id) ?? 0) >= cap) return currentLayout().farLayer;
    // 깊이는 절대 나이가 아니라 '들판에서 가장 최근 꽃'과의 거리로 잰다.
    // 며칠 참여가 뜸해도 가장 최근 꽃들은 전경에 남아, 들판이 원경으로만
    // 몰리지 않는다. 새 꽃이 오면 나머지가 8초에 걸쳐 부드럽게 물러난다.
    const age = Math.max(0, ageDays(entry.date) - fieldBaseAge);
    const L = currentLayout().layers;
    if (age < L.length) return L[age];
    return currentLayout().farLayer;
  }

  // 들판이 붐빌 때: 최신 maxVisible송이만 나이대로 배치하고, 그보다 오래된 꽃은
  // 원경으로 물려 화면이 얼룩처럼 뭉치지 않게 한다
  function recomputeRanks() {
    const arr = [...onField.values()].map((v) => v.entry);
    arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    rank.clear();
    arr.forEach((e, i) => rank.set(e.id, i));
    fieldBaseAge = arr.length ? ageDays(arr[0].date) : 0;
  }

  function depthOf(entry) {
    // 서버가 빈자리를 골라 저장한 y(0=뒤 1=앞)를 쓴다. 옛 데이터는 시드 기반.
    return entry.y != null ? entry.y : seededRand(entry.seed, 11);
  }

  function applyLayout(entry, el) {
    const layer = layerFor(entry);
    const depth = depthOf(entry);
    const topPct = lerp(layer.band[0], layer.band[1], depth);
    const h = lerp(layer.scale[0], layer.scale[1], depth);
    el.style.left = entry.x + '%';
    el.style.top = `calc(${topPct}% - ${h}px)`;
    el.style.height = h + 'px';
    el.style.width = h * (200 / 280) + 'px';
    el.style.zIndex = String(100 + Math.round(topPct * 10));
    el.style.opacity = layer.opacity;
    el.style.filter = `saturate(${layer.sat}) blur(${layer.blur}px)`;
  }

  function makeFlowerEl(entry, { bloom = false } = {}) {
    const def = CATALOG[entry.flowerId];
    if (!def) return null;
    const el = document.createElement('div');
    el.className = 'flower' + (bloom ? ' blooming' : '');
    const sway = document.createElement('div');
    sway.className = 'sway';
    sway.style.animationDuration = (3.6 + seededRand(entry.seed, 7) * 2.6).toFixed(2) + 's';
    sway.style.animationDelay = (-seededRand(entry.seed, 13) * 4).toFixed(2) + 's';
    sway.innerHTML = FlowerSVG.render(def, entry.variant, { seed: entry.seed });
    el.appendChild(sway);
    applyLayout(entry, el);
    flowersEl.appendChild(el);
    if (bloom) setTimeout(() => el.classList.remove('blooming'), 3000);
    return el;
  }

  function addFlower(entry, opts) {
    if (onField.has(entry.id)) return;
    const el = makeFlowerEl(entry, opts);
    if (!el) return;
    onField.set(entry.id, { entry, el });
    recomputeRanks();
    // 상한을 넘긴 꽃이 있으면 조용히 원경으로 물러난다 (값이 같으면 아무 변화 없음)
    for (const item of onField.values()) applyLayout(item.entry, item.el);
  }

  // 새 꽃 개화 연출: 씨앗이 떨어져 → 빛 번짐 → 개화
  function plantWithCeremony(entry, opts = {}) {
    const layer = layerFor(entry);
    const depth = depthOf(entry);
    const topPct = lerp(layer.band[0], layer.band[1], depth);
    const mote = document.createElement('div');
    mote.className = 'seed-mote';
    mote.style.left = entry.x + '%';
    mote.style.top = '-3%';
    flowersEl.appendChild(mote);
    const fall = mote.animate(
      [
        { top: '-3%', offset: 0 },
        { top: topPct * 0.55 + '%', offset: 0.6 },
        { top: topPct + '%', offset: 1 },
      ],
      { duration: 1500, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'forwards' }
    );
    fall.onfinish = () => {
      const ring = document.createElement('div');
      ring.className = 'bloom-ring' + (entry.rarity === 'epic' ? ' epic' : '');
      const rs = entry.rarity === 'epic' ? 220 : 130;
      ring.style.width = ring.style.height = rs + 'px';
      ring.style.left = entry.x + '%';
      ring.style.top = topPct + '%';
      flowersEl.appendChild(ring);
      setTimeout(() => ring.remove(), 1700);
      mote.remove();
      addFlower(entry, { bloom: true });
      if (entry.rarity === 'epic') {
        // 아주 드문 꽃 — 들판이 잠시 환해지고 바람이 한 번 지난다
        const stage = document.getElementById('stage');
        stage.classList.add('epic-moment');
        setTimeout(() => stage.classList.remove('epic-moment'), 4000);
        setTimeout(() => playGust({ dir: Math.random() < 0.5 ? -1 : 1, strength: 'soft', swirl: true, ids: [] }), 400);
      }
      if (opts.mine) {
        const item = onField.get(entry.id);
        if (item) {
          item.el.classList.add('mine');
          setTimeout(() => item.el.classList.remove('mine'), 9000);
        }
      }
    };
  }

  // 창문 닫힘/일몰 안내
  function showFarewell(kind) {
    const overlay = document.getElementById('window-farewell');
    const text = document.getElementById('farewell-text');
    if (kind === 'closed') {
      text.innerHTML = '이 창은 닫혔어요.<br>들판은 대기실에서 계속 자라고 있습니다';
      overlay.classList.add('instant');
    } else {
      text.innerHTML = '들판은 이곳에서 계속 자랍니다.<br>오늘의 꽃, 고마웠어요';
    }
    overlay.classList.add('show');
  }

  // 낮의 바람 — 방향·세기가 매번 다르고, 이따금 소용돌이친다.
  // 서버가 정한 성격(dir/strength/swirl)을 모든 화면이 똑같이 받는다.
  function playGust(g) {
    const dir = g.dir === -1 ? -1 : 1;                  // 1=왼→오른쪽
    const strength = g.strength || 'normal';
    const swirl = !!g.swirl;
    const spec = {
      soft:   { petals: 10, wind: 1.7, lean: 1.4, dur: [4.5, 7.0], hold: 8000 },
      normal: { petals: 20, wind: 2.4, lean: 2.6, dur: [3.4, 5.4], hold: 9500 },
      strong: { petals: 34, wind: 3.4, lean: 4.2, dur: [2.4, 4.0], hold: 11000 },
    }[strength];

    const stage = document.getElementById('stage');
    const base = parseFloat(stage.style.getPropertyValue('--wind')) || 1;
    stage.style.setProperty('--wind', Math.max(spec.wind, base).toFixed(2));
    // 들판 전체가 바람 부는 쪽으로 잠시 눕는다
    stage.style.setProperty('--lean', (spec.lean * dir).toFixed(2) + 'deg');
    setTimeout(() => {
      stage.style.setProperty('--wind', base.toFixed(2));
      stage.style.setProperty('--lean', '0deg');
    }, spec.hold);

    const wrap = $('#drift');
    const colors = ['#E7B2C9', '#EFD9A8', '#D8D3E9', '#F5E1EA', '#E3C96D', '#FBF3E4'];
    for (let i = 0; i < spec.petals; i++) {
      const p = document.createElement('div');
      p.className = 'gust-petal' + (swirl && Math.random() < 0.6 ? ' swirl' : '');
      p.style.background = colors[Math.floor(rand(0, colors.length))];
      // 바람이 오는 쪽에서 등장
      p.style.left = dir === 1 ? rand(-8, -2) + '%' : rand(102, 108) + '%';
      p.style.top = rand(20, 84) + '%';
      const sz = rand(9, 17);
      p.style.width = sz + 'px';
      p.style.height = sz * rand(0.65, 0.85) + 'px';
      p.style.setProperty('--dir', String(dir));
      p.style.setProperty('--spin', (rand(240, 720) * (Math.random() < 0.5 ? 1 : -1)).toFixed(0) + 'deg');
      p.style.setProperty('--midy', rand(-14, 2).toFixed(1) + 'vh');
      p.style.setProperty('--endy', rand(-22, -2).toFixed(1) + 'vh');
      p.style.setProperty('--peak', rand(0.6, 0.95).toFixed(2));
      p.style.animationDelay = rand(0, 2.2).toFixed(2) + 's';
      p.style.animationDuration = rand(spec.dur[0], spec.dur[1]).toFixed(2) + 's';
      wrap.appendChild(p);
      setTimeout(() => p.remove(), spec.hold + 2000);
    }
    if (g.ids && g.ids.length) setTimeout(() => sweep(g.ids), 1300);
  }

  // 마감: 지정된 꽃들이 바람에 실려 떠난다
  function sweep(ids) {
    ids.forEach((id, i) => {
      const item = onField.get(id);
      if (!item) return;
      item.el.style.setProperty('--fly-delay', (i * 0.35 + Math.random() * 0.5).toFixed(2) + 's');
      item.el.style.setProperty('--fly-dur', (6 + Math.random() * 3).toFixed(2) + 's');
      item.el.classList.add('leaving');
      onField.delete(id);
      setTimeout(() => item.el.remove(), 11000 + i * 350);
    });
    // 가장 최근 꽃이 떠났을 수 있으니 기준을 다시 잡고 남은 꽃을 앞으로 당긴다
    recomputeRanks();
    for (const { entry, el } of onField.values()) applyLayout(entry, el);
  }

  // 날짜가 바뀌면 레이어 재계산 (전경 → 중경으로 물러남)
  let lastLayoutDay = todayStr();
  setInterval(() => {
    if (todayStr() !== lastLayoutDay) {
      lastLayoutDay = todayStr();
      recomputeRanks();
      for (const { entry, el } of onField.values()) applyLayout(entry, el);
    }
  }, 5 * 60 * 1000);

  // ---------------------------------------------------------------- 배경 생물
  function makeGrass() {
    const svg = $('#grass');
    const W = Math.max(600, window.innerWidth);
    const H = Math.round(window.innerHeight * 0.13);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let s = '';
    const colors = ['#5E8452', '#557C4B', '#68905C', '#4E7346'];
    const count = Math.round(W / 12);
    for (let i = 0; i < count; i++) {
      const x = rand(0, W);
      const h = rand(H * 0.28, H * 0.8);
      const lean = rand(-14, 14);
      const c = colors[Math.floor(rand(0, colors.length))];
      s += `<path class="blade" style="animation-duration:${rand(3.4, 6.2).toFixed(2)}s;animation-delay:${(-rand(0, 6)).toFixed(2)}s"
        d="M${x.toFixed(1)} ${H} Q ${(x + lean * 0.4).toFixed(1)} ${(H - h * 0.55).toFixed(1)}, ${(x + lean).toFixed(1)} ${(H - h).toFixed(1)}"
        stroke="${c}" stroke-width="${rand(2.4, 4.6).toFixed(1)}" fill="none" stroke-linecap="round" opacity="${rand(0.55, 0.95).toFixed(2)}"/>`;
    }
    svg.innerHTML = s;
  }

  // 구름 하나의 실루엣 — 크고 작은 덩어리를 겹쳐 매번 다른 모양을 만든다
  function cloudSilhouette(alpha) {
    const lobes = [];
    const n = 4 + Math.floor(rand(0, 4)); // 4~7 덩어리
    // 아래쪽은 평평하고 위쪽은 봉긋하게 (실제 구름의 인상)
    for (let i = 0; i < n; i++) {
      const cx = rand(10, 90);
      const cy = rand(45, 68);
      const rx = rand(18, 34);
      const ry = rx * rand(0.8, 1.3);
      const a = (alpha * rand(0.85, 1)).toFixed(2);
      lobes.push(
        `radial-gradient(${rx.toFixed(1)}% ${ry.toFixed(1)}% at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ` +
        `rgba(255,253,246,${a}), rgba(255,253,246,0) 66%)`
      );
    }
    // 바닥을 살짝 눌러주는 넓고 옅은 층
    lobes.push(
      `radial-gradient(46% 20% at ${rand(35, 65).toFixed(0)}% 66%, ` +
      `rgba(255,253,246,${(alpha * 0.55).toFixed(2)}), rgba(255,253,246,0) 75%)`
    );
    return lobes.join(', ');
  }

  function makeCloud(extra) {
    const c = document.createElement('div');
    c.className = 'cloud' + (extra ? ' cloud-extra' : '');
    const depth = Math.random();               // 0=멀리(작고 옅고 느리게) 1=가까이
    const w = lerp(220, 640, depth) * (extra ? 1.2 : 1);
    c.style.setProperty('--cw', w.toFixed(0) + 'px');
    c.style.width = w.toFixed(0) + 'px';
    c.style.height = (w * rand(0.30, 0.44)).toFixed(0) + 'px';
    c.style.top = rand(1, extra ? 32 : 28) + '%';
    // 투명도는 CSS(날씨 규칙)가 제어하므로 진하기는 그라데이션 알파로만 조절
    c.style.background = cloudSilhouette(lerp(0.78, 1, depth));
    c.style.filter = `blur(${lerp(7, 2.5, depth).toFixed(1)}px)`;
    // 가까운 구름일수록 빠르게 (원근감)
    c.style.animationDuration = lerp(460, 190, depth).toFixed(0) + 's';
    c.style.animationDelay = (-rand(0, 460)).toFixed(0) + 's';
    return c;
  }

  function makeClouds() {
    const wrap = $('#clouds');
    wrap.innerHTML = '';
    for (let i = 0; i < 6; i++) wrap.appendChild(makeCloud(false));
    // 흐림/비/눈일 때만 나타나는 구름 (표시 여부는 CSS가 제어)
    for (let i = 0; i < 4; i++) wrap.appendChild(makeCloud(true));
  }

  function makeDrift() {
    const wrap = $('#drift');
    for (let i = 0; i < 10; i++) {
      const m = document.createElement('div');
      m.className = 'mote';
      const sz = rand(5, 11);
      m.style.width = sz + 'px';
      m.style.height = sz * rand(0.8, 1.1) + 'px';
      m.style.left = rand(-5, 85) + '%';
      m.style.top = rand(35, 95) + '%';
      m.style.animationDuration = rand(16, 30).toFixed(1) + 's';
      m.style.animationDelay = (-rand(0, 28)).toFixed(1) + 's';
      wrap.appendChild(m);
    }
  }

  // ---------------------------------------------------------------- 들판의 손님
  // 계절(월)과 시각에 맞는 생물만 찾아온다. 진료시간(09~19:30)에 보이는 것 위주.
  const CREATURES = [
    {
      id: 'butterfly', months: [4,5,6,7,8,9,10], hours: [9, 19], weight: 3,
      size: [30, 42], dur: [18000, 30000], flap: 0.34,
      svg: () => {
        const c = ['#D8C078', '#C8A8C0', '#E4CFA0', '#B9C8DE'][Math.floor(rand(0,4))];
        return `<svg viewBox="0 0 34 30">
          <g class="wing left"><path d="M17 15 C 6 2, -2 8, 3 16 C 6 21, 12 20, 17 15 Z" fill="${c}" opacity="0.9"/></g>
          <g class="wing right"><path d="M17 15 C 28 2, 36 8, 31 16 C 28 21, 22 20, 17 15 Z" fill="${c}" opacity="0.9"/></g>
          <ellipse cx="17" cy="15" rx="1.6" ry="6" fill="#4A4238"/></svg>`;
      },
    },
    {
      id: 'bee', months: [4,5,6,7,8,9], hours: [9, 18], weight: 2,
      size: [18, 24], dur: [14000, 22000], flap: 0.12, hover: true,
      svg: () => `<svg viewBox="0 0 28 20">
        <g class="wing left"><ellipse cx="11" cy="6.5" rx="5.2" ry="2.6" fill="#E8F0F6" opacity="0.55"/></g>
        <g class="wing right"><ellipse cx="17" cy="6.5" rx="5.2" ry="2.6" fill="#E8F0F6" opacity="0.55"/></g>
        <ellipse cx="14" cy="12.5" rx="7" ry="4.6" fill="#D9A93C"/>
        <path d="M11 9 v7 M14.6 8.6 v7.8 M18.2 9.8 v5.8" stroke="#4A3B22" stroke-width="1.8"/>
        <circle cx="7.4" cy="12" r="2.8" fill="#3E3423"/>
        <path d="M6 9.4 l-2.4 -2.6 M8 9 l-1 -3.2" stroke="#3E3423" stroke-width="0.9"/></svg>`,
    },
    {
      id: 'dragonfly', months: [7,8,9,10], hours: [10, 18], weight: 2,
      size: [30, 40], dur: [10000, 16000], flap: 0.09,
      svg: () => `<svg viewBox="0 0 40 24">
        <g class="wing left"><ellipse cx="15" cy="7.6" rx="10" ry="3.2" fill="#CFE0EA" opacity="0.8"/></g>
        <g class="wing right"><ellipse cx="25" cy="7.6" rx="10" ry="3.2" fill="#CFE0EA" opacity="0.8"/></g>
        <g class="wing left"><ellipse cx="17" cy="15" rx="7.6" ry="2.4" fill="#CFE0EA" opacity="0.62"/></g>
        <g class="wing right"><ellipse cx="25" cy="15" rx="7.6" ry="2.4" fill="#CFE0EA" opacity="0.62"/></g>
        <rect x="9" y="10.6" width="26" height="2.8" rx="1.4" fill="#7C93AC"/>
        <circle cx="8.6" cy="12" r="3.1" fill="#5C7793"/></svg>`,
    },
    {
      id: 'sparrow', months: null, hours: [9, 18], weight: 2, flock: [3, 6],
      size: [22, 30], dur: [12000, 20000], flap: 0.22,
      svg: () => `<svg viewBox="0 0 28 20">
        <ellipse cx="14" cy="12" rx="7.5" ry="5.2" fill="#A98D6B"/>
        <circle cx="21" cy="9" r="3.6" fill="#B99B77"/>
        <path d="M24 9 l4 1.4 -4 1.2 z" fill="#6E5A3E"/>
        <g class="wing left"><path d="M13 10 C 8 3, 2 5, 5 11 C 8 14, 11 13, 13 10 Z" fill="#8C7355"/></g>
        <path d="M7 12 l-6 2 6 1.6 z" fill="#8C7355"/></svg>`,
    },
    {
      id: 'swallow', months: [4,5,6,7,8,9], hours: [17, 20], weight: 1.5,
      size: [34, 44], dur: [9000, 14000], flap: 0.26, low: true,
      svg: () => `<svg viewBox="0 0 40 22">
        <path d="M20 12 C 26 8, 33 8, 38 11 C 33 13, 27 14, 22 14 Z" fill="#3E4A5C"/>
        <g class="wing left"><path d="M20 12 C 14 3, 6 4, 4 11 C 9 14, 15 14, 20 12 Z" fill="#4A566A"/></g>
        <path d="M4 11 l-4 -3 2 4 -2 4 4 -3 z" fill="#3E4A5C"/>
        <circle cx="37" cy="11" r="2.2" fill="#C4694F"/></svg>`,
    },
    {
      id: 'firefly', months: [6,7,8], hours: [19, 20], weight: 2, flock: [4, 8],
      size: [8, 12], dur: [16000, 26000], flap: 0,
      svg: () => `<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3" fill="#F6E9A8" class="glow-dot"/></svg>`,
    },
  ];

  function creatureAllowed(c, month, hour) {
    if (c.months && !c.months.includes(month)) return false;
    return hour >= c.hours[0] && hour <= c.hours[1];
  }

  function spawnCreature(def) {
    const W = window.innerWidth, H = window.innerHeight;
    const el = document.createElement('div');
    el.className = 'creature' + (def.id === 'firefly' ? ' firefly' : '');
    const size = rand(def.size[0], def.size[1]);
    el.style.width = size + 'px';
    el.style.height = size * 0.85 + 'px';
    el.innerHTML = def.svg();
    if (def.flap) {
      el.querySelectorAll('.wing').forEach((w, i) => {
        w.style.animationDuration = def.flap + 's';
        if (i === 1) w.style.animationDelay = (def.flap / 2) + 's';
      });
    }
    // 비행 경로 — 낮게 나는 새는 들판 가까이, 나머지는 중간 높이
    const band = def.low ? [0.42, 0.58] : def.id === 'firefly' ? [0.55, 0.8] : [0.3, 0.62];
    const y1 = rand(band[0], band[1]) * H, y2 = rand(band[0], band[1]) * H, y3 = rand(band[0], band[1]) * H;
    const fromLeft = Math.random() < 0.5;
    const path = fromLeft
      ? `M -60 ${y1} C ${W * 0.25} ${y2 - 140}, ${W * 0.55} ${y3 + 90}, ${W + 80} ${y2}`
      : `M ${W + 60} ${y1} C ${W * 0.75} ${y2 - 140}, ${W * 0.45} ${y3 + 90}, ${-80} ${y2}`;
    el.style.offsetPath = `path('${path}')`;
    document.getElementById('stage').appendChild(el);
    const dur = rand(def.dur[0], def.dur[1]);
    // 벌은 꽃 사이에서 잠깐씩 머문다
    const frames = def.hover
      ? [{ offsetDistance: '0%' }, { offsetDistance: '32%', offset: 0.28 }, { offsetDistance: '38%', offset: 0.42 },
         { offsetDistance: '70%', offset: 0.72 }, { offsetDistance: '76%', offset: 0.84 }, { offsetDistance: '100%' }]
      : [{ offsetDistance: '0%' }, { offsetDistance: '100%' }];
    el.animate(frames, { duration: dur, easing: def.hover ? 'ease-in-out' : 'linear' })
      .onfinish = () => el.remove();
  }

  function visitCreature() {
    scheduleCreature();
    if (WEATHER.category === 'rain' || WEATHER.category === 'snow') return; // 비·눈에는 쉰다
    const now = new Date();
    const hour = FORCED_HOUR !== null ? FORCED_HOUR : now.getHours() + now.getMinutes() / 60;
    const month = now.getMonth() + 1;
    const pool = CREATURES.filter((c) => creatureAllowed(c, month, hour));
    if (!pool.length) return;
    const total = pool.reduce((a, c) => a + c.weight, 0);
    let r = Math.random() * total, i = 0;
    while (i < pool.length - 1 && (r -= pool[i].weight) > 0) i++;
    const def = pool[i];
    // 무리로 다니는 손님 (참새·반딧불이)
    const n = def.flock ? Math.round(rand(def.flock[0], def.flock[1])) : 1;
    for (let k = 0; k < n; k++) setTimeout(() => spawnCreature(def), k * rand(200, 700));
  }

  function scheduleCreature() {
    setTimeout(visitCreature, rand(20000, 55000));
  }

  // ---------------------------------------------------------------- 시연 모드
  // /garden?demo=1 — 하루의 빛, 날씨, 바람, 손님, 특별한 날을 차례로 보여준다.
  function runDemo() {
    document.body.classList.add('demo');
    const label = document.createElement('div');
    label.id = 'demo-label';
    document.getElementById('stage').appendChild(label);

    const setHour = (h) => { FORCED_HOUR = h; updateSky(); };
    const setWeather = (c, wind = 8) => applyWeather({ category: c, windKmh: wind });
    const gust = (strength, swirl) => playGust({ dir: Math.random() < 0.5 ? -1 : 1, strength, swirl, ids: [] });
    const creature = (id, n = 1) => {
      const def = CREATURES.find((c) => c.id === id);
      for (let k = 0; k < n; k++) setTimeout(() => spawnCreature(def), k * 450);
    };
    const special = (effects, message) => applySpecial([{ effects, message }]);

    // 새 꽃이 피는 순간 (실제 카탈로그에서 한 송이)
    const bloom = (rarity) => {
      const pool = Object.values(CATALOG).filter((f) => f.rarity === rarity);
      const def = pool[Math.floor(Math.random() * pool.length)];
      plantWithCeremony({
        id: 'demo-' + Math.random().toString(36).slice(2),
        flowerId: def.id, variant: 0, rarity,
        seed: Math.floor(Math.random() * 1e9),
        x: 30 + Math.random() * 40, y: 0.9,
        date: todayStr(),
      }, { mine: true });
    };

    const steps = [
      ['아침 — 은은한 빛', () => { setHour(9); setWeather('clear'); special([], null); }],
      ['한낮', () => setHour(13)],
      ['해질녘', () => setHour(18.4)],
      ['밤', () => setHour(20)],
      ['흐린 날', () => { setHour(13); setWeather('overcast'); }],
      ['비 오는 날', () => setWeather('rain', 18)],
      ['눈 오는 날', () => setWeather('snow', 10)],
      ['잔잔한 바람 — 꽃잎이 흩날립니다', () => { setWeather('clear'); gust('soft', false); }],
      ['센 바람 — 하루 한 번쯤 (소용돌이)', () => gust('strong', true)],
      ['나비', () => creature('butterfly')],
      ['벌 — 꽃 사이에 잠깐 머뭅니다', () => creature('bee')],
      ['잠자리', () => creature('dragonfly')],
      ['참새 무리', () => creature('sparrow', 5)],
      ['제비 — 해질녘 낮게', () => { setHour(18.4); creature('swallow'); }],
      ['반딧불이 — 여름 저녁', () => { setHour(20); creature('firefly', 6); }],
      ['꽃이 피는 순간', () => { setHour(13); bloom('common'); }],
      ['아주 드문 꽃 — 들판이 잠시 환해집니다', () => bloom('epic')],
      ['성탄', () => { setHour(19); special(['snow', 'lights', 'star'], '따뜻한 성탄 보내세요'); }],
      ['새해 첫날', () => { setHour(9); setWeather('clear'); special(['sunrise', 'glow'], '새해에도 당신의 봄이 오기를'); }],
      ['추석 — 보름달', () => { setHour(19.5); special(['moon'], '풍성한 한가위 되세요'); }],
      ['벚꽃철 — 꽃잎이 자주 흩날립니다', () => { setHour(13); special(['petals'], null); gust('normal', true); }],
      ['저녁, 함께 떠나는 순간', () => {
        special([], null);
        setHour(18.2);
        const ids = [...onField.keys()].slice(0, 8);
        if (ids.length) sweep(ids);
      }],
      ['시연이 끝났습니다', () => { setHour(13); setWeather('clear'); special([], null); }],
    ];

    // ?demo=1&step=18 처럼 특정 장면부터 볼 수 있다.
    // 중간부터 시작해도 앞 단계의 설정이 남지 않도록 기준 상태를 먼저 잡는다.
    let i = Math.max(0, Math.min(steps.length - 1, (Number(PARAMS.get('step')) || 1) - 1));
    if (i > 0) { setHour(13); setWeather('clear'); special([], null); }
    const tick = () => {
      const [name, fn] = steps[i];
      label.textContent = `${i + 1} / ${steps.length}  ·  ${name}`;
      label.classList.add('show');
      fn();
      i++;
      if (i < steps.length) setTimeout(tick, 7000);
    };
    setTimeout(tick, 800);
  }

  // ---------------------------------------------------------------- 시작
  async function init() {
    const [config, catalog] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/flowers').then((r) => r.json()),
    ]);
    CONFIG = config;
    ORIENT_SETTING = config.orientation || 'auto';
    CATALOG = Object.fromEntries(catalog.flowers.map((f) => [f.id, f]));

    // 들판 데이터: 게스트 창문이면 토큰으로, 아니면 공개 API로
    let garden;
    if (WINDOW_TOKEN) {
      document.body.classList.add('guest');
      ORIENT_SETTING = 'auto'; // 폰 화면 비율을 따른다
      const wres = await fetch('/api/window/' + encodeURIComponent(WINDOW_TOKEN));
      if (!wres.ok) {
        updateSky();
        showFarewell('closed');
        return;
      }
      garden = await wres.json();
      guestEntry = garden.entry;
      // 내 꽃은 잠시 뒤 개화 연출로 등장
      setTimeout(() => plantWithCeremony(guestEntry, { mine: true }), 1100);
      // 잠깐 열린 창문 — 몇 분 뒤 천천히 저문다
      setTimeout(() => showFarewell('sunset'), 4 * 60 * 1000);
    } else {
      garden = await fetch('/api/garden').then((r) => r.json());
    }

    document.body.classList.toggle('portrait', effectiveOrientation() === 'portrait');
    updateSky();
    setInterval(updateSky, 30 * 1000);
    makeGrass();
    makeClouds();
    makeDrift();
    scheduleCreature();

    for (const entry of garden.flowers) {
      if (guestEntry && entry.id === guestEntry.id) continue; // 내 꽃은 개화 연출로
      addFlower(entry);
    }

    // 시연 중에는 실제 날씨가 장면을 덮어쓰지 않게 한다
    if (!DEMO) {
      pollWeather();
      setInterval(pollWeather, 10 * 60 * 1000);
    } else {
      applyWeather({ category: 'clear', windKmh: 8 });
    }

    if (DEMO) runDemo();

    // 바람 세기 미리보기: /garden?gust=strong
    if (FORCED_GUST) {
      const demo = () => playGust({ dir: Math.random() < 0.5 ? -1 : 1, strength: FORCED_GUST, swirl: Math.random() < 0.3, ids: [] });
      setTimeout(demo, 1200);
      setInterval(demo, 14000);
    }

    const loadSpecial = () => fetch('/api/special').then((r) => r.json())
      .then(({ active }) => applySpecial(active)).catch(() => {});
    if (!DEMO) {
      loadSpecial();
      setInterval(loadSpecial, 60 * 60 * 1000); // 날짜가 바뀌면 자동 반영
    }

    // 참여용 QR 카드 (게스트 창문에는 표시하지 않는다)
    // 서버 주소가 바뀌어도 오래 켜둔 사이니지가 옛 QR을 들고 있지 않도록 주기 갱신
    function loadQr() {
      fetch('/api/qr').then((r) => r.json()).then(({ svg }) => {
        if (!svg) return;
        $('#qr-img').innerHTML = svg;
        $('#qr-card').hidden = false;
      }).catch(() => { /* QR 실패 시 기존 카드 유지 */ });
    }
    if (!WINDOW_TOKEN) {
      loadQr();
      setInterval(loadQr, 10 * 60 * 1000);
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyOrientation, 400);
    });
    try {
      matchMedia('(orientation: portrait)').addEventListener('change', applyOrientation);
    } catch (e) { /* 구형 브라우저: resize 리스너로 충분 */ }

    const socket = io();
    socket.on('flower:planted', (entry) => plantWithCeremony(entry));
    socket.on('garden:sweep', ({ ids }) => sweep(ids));
    socket.on('garden:gust', (g) => playGust(g || {}));
    socket.on('weather:update', (w) => applyWeather(w));
    socket.on('display:config', ({ orientation }) => {
      ORIENT_SETTING = orientation;
      applyOrientation();
    });
    socket.on('connect', async () => {
      if (!WINDOW_TOKEN) loadQr(); // 서버 재시작 후 주소가 바뀌었을 수 있다
      // 재접속 시 들판 동기화 (놓친 꽃 반영)
      const g = await fetch('/api/garden').then((r) => r.json());
      const liveIds = new Set(g.flowers.map((f) => f.id));
      for (const entry of g.flowers) {
        // 게스트의 꽃은 개화 연출 전에 미리 등장하지 않게
        if (guestEntry && entry.id === guestEntry.id && !onField.has(entry.id)) continue;
        addFlower(entry);
      }
      for (const [id, item] of onField) {
        if (!liveIds.has(id) && !item.el.classList.contains('leaving')) {
          item.el.remove();
          onField.delete(id);
        }
      }
    });
  }

  init();
})();
