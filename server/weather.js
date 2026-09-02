// 실시간 날씨 — Open-Meteo (API 키 불필요, 무료)
// 병원 좌표 기준으로 10분마다 갱신해 캐시. 실패하면 마지막 값 유지(없으면 '맑음').
const LAT = Number(process.env.CLINIC_LAT || 37.5665);   // 기본: 서울
const LON = Number(process.env.CLINIC_LON || 126.978);
const REFRESH_MS = 10 * 60 * 1000;

const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;

let cache = { category: 'clear', windKmh: 0, tempC: null, updatedAt: null, ok: false };

// WMO weather code → 연출 카테고리
function codeToCategory(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'cloudy';
  if (code === 3 || code === 45 || code === 48) return 'overcast';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'clear';
}

async function refresh(onChange) {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const cur = data.current || {};
    const next = {
      category: codeToCategory(Number(cur.weather_code)),
      windKmh: Math.round(Number(cur.wind_speed_10m) || 0),
      tempC: cur.temperature_2m ?? null,
      updatedAt: new Date().toISOString(),
      ok: true,
    };
    const changed = next.category !== cache.category ||
      Math.abs(next.windKmh - cache.windKmh) >= 8;
    cache = next;
    if (changed && onChange) onChange(cache);
  } catch (e) {
    // 네트워크 실패: 조용히 마지막 값 유지 (사이니지는 시간대 빛만으로 동작)
    cache.ok = false;
  }
}

function init(io) {
  const onChange = (w) => io.emit('weather:update', w);
  refresh(onChange);
  setInterval(() => refresh(onChange), REFRESH_MS).unref();
}

module.exports = { init, get current() { return cache; } };
