// 꽃 가챠 로직 — 등급 가중치, 계절(월) 필터, "필요한 것" 연동 가중 랜덤
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'flowers.json');
const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const RARITY_FALLBACK = {
  epic: ['epic', 'rare', 'common'],
  rare: ['rare', 'common'],
  common: ['common', 'rare'],
};

function rollRarity(rng) {
  const w = db.rarityWeights;
  const total = w.common + w.rare + w.epic;
  let r = rng() * total;
  if ((r -= w.common) < 0) return 'common';
  if ((r -= w.rare) < 0) return 'rare';
  return 'epic';
}

function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    if ((r -= weights[i]) < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * 꽃 한 송이 뽑기.
 * @param {object} opts
 * @param {string} opts.need        환자가 고른 "필요한 것" (없어도 동작)
 * @param {number} opts.month       1~12
 * @param {boolean} opts.epicAllowed  오늘 아주 드묾 등장 가능 여부 (하루 1회)
 * @param {function} [opts.rng]     테스트용 난수 함수
 * @returns {{flower: object, variant: number, rarity: string}}
 */
function drawFlower({ need, month, epicAllowed = true, rng = Math.random }) {
  const inSeason = db.flowers.filter(
    (f) => !f.months || f.months.includes(month)
  );

  let rarity = rollRarity(rng);
  if (rarity === 'epic' && !epicAllowed) rarity = 'rare';

  let pool = [];
  for (const tier of RARITY_FALLBACK[rarity]) {
    pool = inSeason.filter((f) => f.rarity === tier);
    if (pool.length) { rarity = tier; break; }
  }

  const weights = pool.map((f) =>
    need && f.needs.includes(need) ? db.needBoost : 1
  );
  const flower = weightedPick(pool, weights, rng);
  const variant = Math.floor(rng() * flower.palettes.length);

  return { flower, variant, rarity };
}

module.exports = { drawFlower, db };
