// 가챠 분포 검증 스크립트: node server/gacha.test.js
const { drawFlower, db } = require('./gacha');

const N = 20000;
const month = new Date().getMonth() + 1;

console.log(`총 꽃 종류: ${db.flowers.length}종`);
const byRarity = { common: 0, rare: 0, epic: 0 };
for (const f of db.flowers) byRarity[f.rarity]++;
console.log(`등급별 종 수:`, byRarity);

const inSeason = db.flowers.filter((f) => !f.months || f.months.includes(month));
console.log(`이번 달(${month}월) 등장 가능: ${inSeason.length}종\n`);

// 1) 등급 분포 (epic 허용)
const rarityCount = { common: 0, rare: 0, epic: 0 };
const flowerCount = {};
for (let i = 0; i < N; i++) {
  const { flower, rarity } = drawFlower({ need: null, month, epicAllowed: true });
  rarityCount[rarity]++;
  flowerCount[flower.name] = (flowerCount[flower.name] || 0) + 1;
}
console.log('등급 분포 (기대 70/25/5):');
for (const [k, v] of Object.entries(rarityCount)) {
  console.log(`  ${k}: ${((v / N) * 100).toFixed(1)}%`);
}

// 2) epic 차단 시 epic 0% 확인
let epicLeaked = 0;
for (let i = 0; i < 5000; i++) {
  const { rarity } = drawFlower({ need: null, month, epicAllowed: false });
  if (rarity === 'epic') epicLeaked++;
}
console.log(`\nepicAllowed=false 일 때 epic 등장: ${epicLeaked}회 (0이어야 정상)`);

// 3) need 가중 확인 — "용기" 선택 시 용기 꽃 비율 상승
function needRatio(need) {
  let hit = 0;
  for (let i = 0; i < N; i++) {
    const { flower } = drawFlower({ need, month, epicAllowed: false });
    if (flower.needs.includes('용기')) hit++;
  }
  return (hit / N) * 100;
}
console.log(`\n"용기" 꽃 비율 — 미선택: ${needRatio(null).toFixed(1)}% / "용기" 선택: ${needRatio('용기').toFixed(1)}%`);

// 4) 12개월 전부 풀이 비지 않는지
console.log('\n월별 등장 가능 종 수:');
for (let m = 1; m <= 12; m++) {
  const pool = db.flowers.filter((f) => !f.months || f.months.includes(m));
  const c = pool.filter((f) => f.rarity === 'common').length;
  const r = pool.filter((f) => f.rarity === 'rare').length;
  const e = pool.filter((f) => f.rarity === 'epic').length;
  console.log(`  ${String(m).padStart(2)}월: 총 ${pool.length} (흔함 ${c} / 드묾 ${r} / 아주드묾 ${e})`);
}

// 5) 개별 꽃 상위 등장
const top = Object.entries(flowerCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\n최다 등장 8종:', top.map(([n, c]) => `${n} ${((c / N) * 100).toFixed(1)}%`).join(', '));
