// 라우트 존재 점검: node server/routes.test.js
const src = require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8');
const EXPECTED = [
  ['get', '/garden'], ['get', '/admin'], ['get', '/admin.html'],
  ['post', '/api/draw'], ['post', '/api/plant'], ['get', '/api/window/:token'],
  ['get', '/api/garden'], ['get', '/api/flowers'], ['get', '/api/config'],
  ['get', '/api/weather'], ['get', '/api/qr'], ['get', '/api/special'],
  ['post', '/api/admin/login'], ['get', '/api/admin/stats'],
  ['get', '/api/admin/display'], ['post', '/api/admin/display'],
  ['post', '/api/admin/reset-stats'], ['post', '/api/admin/undo-flower'],
  ['post', '/api/admin/special-days'], ['post', '/api/admin/sweep'], ['post', '/api/admin/gust'],
];
let bad = 0;
for (const [m, r] of EXPECTED) {
  if (!src.includes(`app.${m}('${r}'`)) { console.log(`  없음: ${m.toUpperCase()} ${r}`); bad++; }
}
console.log(bad ? `\n${bad}개 라우트 누락` : `라우트 ${EXPECTED.length}개 모두 정상`);
process.exit(bad ? 1 : 0);
