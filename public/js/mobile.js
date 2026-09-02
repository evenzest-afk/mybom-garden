/* 나의 봄 — 모바일 플로우 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const state = { weather: null, need: null, draw: null };

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = $(id);
    el.classList.add('active');
    window.scrollTo(0, 0);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---- 인트로 장식: 작은 꽃 한 송이 --------------------------------------
  const INTRO_FLOWER = {
    name: '코스모스',
    shape: { type: 'daisy', petals: 8, len: 52, w: 24, centerR: 12, notch: true },
    palettes: [{ petal: '#D9A8BC', petalDeep: '#B97E97', center: '#CBA84F' }],
  };
  $('#intro-mark').innerHTML = FlowerSVG.render(INTRO_FLOWER, 0, { seed: 20260301 });

  // ---- 세션 내 1일 1회 부드러운 안내 -------------------------------------
  let bypassDaily = false;
  try {
    if (sessionStorage.getItem('mybom-planted') === todayStr()) {
      show('#screen-already');
    }
  } catch (e) { /* 시크릿 모드 등 — 그냥 진행 */ }

  $('#btn-again').addEventListener('click', () => {
    bypassDaily = true;
    show('#screen-q1');
  });

  // ---- 플로우 -------------------------------------------------------------
  $('#btn-start').addEventListener('click', () => show('#screen-q1'));

  $('#q1-options').addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    state.weather = btn.dataset.value;
    // 날씨 응답은 다음 질문의 어조에 쓰이고, 심기 완료 시 날짜별 집계 숫자에만 반영된다
    const h = $('#screen-q2 h2');
    if (state.weather === '힘듦' || state.weather === '무거움') {
      h.innerHTML = '그런 날이 있지요.<br>오늘의 나에게 필요한 것은?';
    } else if (state.weather === '조용히') {
      h.innerHTML = '조용한 마음으로,<br>오늘 필요한 것 하나만 골라 주세요.';
    } else {
      h.innerHTML = '오늘의 나에게<br>필요한 것은?';
    }
    show('#screen-q2');
  });

  $('#q2-options').addEventListener('click', async (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    state.need = btn.dataset.value;
    show('#screen-draw');
    await runDraw();
  });

  async function runDraw() {
    const minWait = new Promise((r) => setTimeout(r, 1700));
    let result = null;
    try {
      const res = await fetch('/api/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ need: state.need, weather: state.weather }),
      });
      result = await res.json();
    } catch (err) {
      result = null;
    }
    await minWait;

    if (!result || !result.flower) {
      $('#seed-caption').textContent = '연결이 잠시 끊겼어요. 다시 시도해 주세요.';
      setTimeout(() => show('#screen-q2'), 1600);
      return;
    }
    state.draw = result;

    // 씨앗 터지는 연출 후 결과로
    const seed = $('#seed');
    seed.classList.add('burst');
    setTimeout(() => {
      seed.classList.remove('burst');
      renderResult(result);
      show('#screen-result');
    }, 560);
  }

  function renderResult({ flower, variant, rarity, seed }) {
    $('#result-flower').innerHTML = FlowerSVG.render(flower, variant, { seed });
    $('#result-name').textContent = flower.name;
    $('#result-meaning').textContent = `꽃말 · ${flower.meaning}`;
    $('#result-message').textContent = flower.message;

    const card = $('#result-card');
    const badge = $('#result-rarity');
    card.classList.toggle('epic', rarity === 'epic');
    badge.className = 'result-rarity ' + (rarity !== 'common' ? rarity : '');
    badge.textContent = rarity === 'epic' ? '오늘 단 한 송이' : rarity === 'rare' ? '드물게 피는 꽃' : '';
  }

  $('#btn-plant').addEventListener('click', async () => {
    const btn = $('#btn-plant');
    btn.disabled = true;
    let planted = null;
    try {
      const res = await fetch('/api/plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawId: state.draw.drawId }),
      });
      if (!res.ok) throw new Error('plant failed');
      planted = await res.json();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '다시 시도하기';
      return;
    }
    try {
      if (!bypassDaily) sessionStorage.setItem('mybom-planted', todayStr());
    } catch (e) { /* 무시 */ }
    $('#planted-mini').innerHTML = FlowerSVG.render(state.draw.flower, state.draw.variant, {
      seed: state.draw.seed,
    });
    $('#planted-name').textContent = state.draw.flower.name;
    $('#planted-meaning').textContent = `꽃말 · ${state.draw.flower.meaning}`;
    if (planted && planted.windowToken) {
      const wbtn = $('#btn-window');
      wbtn.hidden = false;
      $('#window-hint').hidden = false;
      wbtn.addEventListener('click', () => {
        location.href = '/garden?w=' + encodeURIComponent(planted.windowToken);
      }, { once: true });
    }
    show('#screen-planted');
  });
})();
