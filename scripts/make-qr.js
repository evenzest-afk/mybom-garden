// 인쇄용 QR 생성: node scripts/make-qr.js [URL]
// URL 미지정 시 이 컴퓨터의 LAN IP와 PORT로 주소를 만든다.
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

function lanIp() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return 'localhost';
}

const port = process.env.PORT || 3000;
const url = process.argv[2] || process.env.PUBLIC_URL || `http://${lanIp()}:${port}/`;
const out = path.join(__dirname, '..', 'qr-print.png');

QRCode.toFile(out, url, {
  width: 1200,             // 인쇄용 고해상도
  margin: 4,
  errorCorrectionLevel: 'M',
  color: { dark: '#35302A', light: '#F5F1E8' }, // 프로젝트 톤
}).then(() => {
  console.log(`QR 생성 완료 → ${out}`);
  console.log(`인코딩된 주소: ${url}`);
  if (url.startsWith('https://')) {
    console.log('대기실 안내물에 붙여 인쇄하세요. 어떤 네트워크에서든 접속됩니다.');
  } else {
    console.log('대기실 안내물에 붙여 인쇄하세요. 환자 폰이 같은 네트워크(병원 와이파이)에 있어야 합니다.');
  }
}).catch((e) => {
  console.error('QR 생성 실패:', e.message);
  process.exit(1);
});
