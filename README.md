# 나의 봄 — 대기실 디지털 정원

정신건강의학과 대기실용 참여형 설치물.
환자가 QR로 접속해 두 번의 선택으로 꽃 한 송이를 뽑아 벽면 사이니지 들판에 피우면,
꽃은 정해진 날짜가 아니라 **들판이 얼마나 붐비는지**에 따라 바람에 실려 떠납니다.
한산하면 오래 머물고, 붐비면 오래된 꽃부터 자주 떠납니다.

## 화면

| 주소 | 용도 |
|---|---|
| `/` | 환자 모바일 (QR 진입) |
| `/garden.html` | 32인치 사이니지 들판 (1920×1080, 전체화면) |
| `/admin.html` | 관리자 — 일자별 새로 핀 꽃 수만 표시 |
| `/preview.html` | 개발용 꽃 카탈로그 |

## 원칙

- 회원가입·로그인·식별자 없음. 꽃과 심은 사람은 연결되지 않습니다.
- 저장 데이터는 꽃 종류·색상·위치·개화 **일자**뿐 (시각 미저장). 수명이 지나면 물리 삭제.
- 자유 텍스트 입력 없음, 화면에 숫자·통계 노출 없음 (관리자 화면 제외).
- 관리자에게 보이는 것은 **날짜별 집계 숫자**뿐입니다: 새로 핀 꽃 수, 그리고
  마음의 날씨/필요한 것 선택지별 일일 선택 수. 개별 참여·꽃·선택은 서로 연결 저장되지 않습니다.

## 실행

```bash
npm install
npm start
```

기본 포트 3000. 사이니지 PC의 브라우저에서 `http://localhost:3000/garden.html`을 전체화면(kiosk)으로 띄우세요.

### 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `CLOSING_TIME` | `18:00` | 진료 마감 시각 — 남아 있는 수명 다한 꽃들이 함께 떠나는 피날레 |
| `DRIFT_START` | `12:00` | 이 시각부터 마감까지 15~30분 간격으로 바람이 지나가며 수명 마지막 날의 꽃을 1~2송이씩 실어 감 (대기 환자들이 떠나는 장면을 볼 수 있게 분산) |
| `DRIFT_END` | `19:30` | 바람이 그치는 시각 (진료 종료) |
| `GARDEN_FLOOR` | `20` | 이 아래로는 꽃이 거의 줄지 않음 |
| `GARDEN_TARGET` | `95` | 평소 유지하려는 꽃 수 (32인치 기준) |
| `GARDEN_MAX` | `150` | 이 위로는 빠르게 줄임 |
| `MAX_AGE_DAYS` | `21` | 한산해도 이만큼 지나면 떠남 |
| `SEED_COUNT` | `35` | 서버 시작 시 이보다 적으면 미리 채움 (더 풍성하게 하려면 올린다) |
| `ADMIN_PASSWORD` | (임의 생성) | 관리자 비밀번호 — **반드시 직접 설정할 것**. 없으면 서버가 매번 임의로 만들어 로그에 남긴다 |
| `TZ_NAME` | `Asia/Seoul` | 날짜 계산 시간대 |
| `CLINIC_LAT` / `CLINIC_LON` | 서울 좌표 | 실시간 날씨를 받아올 병원 위치 (위도/경도) |
| `PUBLIC_URL` | (없음) | 환자 접속 주소. 설정하면 사이니지 QR 카드와 QR 인쇄 스크립트가 이 주소를 사용 (미설정 시 LAN IP) |

예: `CLOSING_TIME=18:30 ADMIN_PASSWORD=우리병원비번 npm start`

환경변수는 프로젝트 폴더의 **`.env` 파일**로도 설정할 수 있다 (한 줄에 `이름=값`).
서버 시작 시 자동으로 읽으며, 명령줄 환경변수가 있으면 그쪽이 우선.
현재 `.env`에 관리자 비밀번호가 들어 있다 — 바꾸려면 파일을 수정하고 서버 재시작.

### 가로/세로 화면

관리자 화면(`/admin`)의 "사이니지 화면"에서 **자동 / 세로 / 가로**를 선택하면
사이니지에 즉시 반영됩니다(재시작 불필요, 설정은 저장됨).
자동은 모니터 비율을 따라갑니다. 모니터 자체의 회전은 OS 디스플레이 설정에서 하세요.

### 실시간 날씨

Open-Meteo(무료, API 키 불필요)에서 병원 좌표(`CLINIC_LAT`/`CLINIC_LON`)의 날씨를
10분마다 받아 들판에 반영합니다 — 흐림(구름·차분한 빛), 비(가는 빗줄기),
눈(눈송이), 바람(꽃과 풀의 흔들림 폭). 인터넷이 없으면 시간대 빛만으로 동작합니다.
현재 반영 중인 날씨는 관리자 화면에서 확인할 수 있습니다.

### 사이니지 연출 조정

`server/index.js`의 `LAYOUTS`(가로/세로 각각)에 들판 밀도/레이어 값이 모여 있습니다.
실제 화면을 보면서 조정하세요:

- `layers[n]` — 개화 경과일별 크기(`scale`), 세로 배치 밴드(`band`), 투명도·채도·블러
- `FLOWER_LIFE_DAYS`를 늘리면 오래된 꽃은 자동으로 `farLayer`(원경 풀숲) 처리
- **시연 모드**: `/garden?demo=1` — 하루의 빛·날씨·바람·손님·특별한 날을 23장면으로 차례로 보여준다.
  특정 장면부터 보려면 `?demo=1&step=18` (18=성탄). 직원 안내나 튜닝에 쓴다.
- 튜닝용 URL 파라미터: `?hour=18.5`(시간대) · `?weather=rain|snow|cloudy|overcast`(날씨) · `?wind=30`(풍속) · `?gust=soft|normal|strong`(바람 세기 미리보기)

## QR — 사이니지 표시 + 인쇄

사이니지 우하단에 참여용 QR 카드가 자동으로 표시됩니다
(`PUBLIC_URL` 설정 시 그 주소, 없으면 서버 PC의 LAN IP).

인쇄용 PNG도 만들 수 있습니다:

```bash
node scripts/make-qr.js
```

이 컴퓨터의 LAN IP 기준 주소로 `qr-print.png`(1200px)를 생성합니다.
도메인이 있으면 `node scripts/make-qr.js https://주소` 로 지정하세요.
환자 폰이 같은 네트워크(병원 와이파이)에 접속할 수 있어야 합니다.

## 외부 주소 열기 — Cloudflare Tunnel + 관리자 보호

병원 PC에서 서버를 돌리면서 환자가 LTE/5G로도 접속할 수 있게 하는 구성.
앱과 데이터는 계속 병원 PC에 있고, Cloudflare는 통로만 제공한다. (무료)

### 1) Tunnel 만들기

준비물: Cloudflare 계정(무료), 도메인 1개(Cloudflare에 등록).

```bash
brew install cloudflared
cloudflared tunnel login          # 브라우저가 열리면 Cloudflare 로그인 후 도메인 선택
cloudflared tunnel create my-bom
cloudflared tunnel route dns my-bom bom.내도메인.com
```

`~/.cloudflared/config.yml` 생성:

```yaml
tunnel: my-bom
credentials-file: /Users/사용자명/.cloudflared/<터널ID>.json
ingress:
  - hostname: bom.내도메인.com
    service: http://localhost:3000
  - service: http_status:404
```

실행 및 자동 시작 등록:

```bash
cloudflared tunnel run my-bom          # 동작 확인
sudo cloudflared service install       # 부팅 시 자동 실행
```

macOS에서 `service install` 후 터널이 안 뜨면 (로그: "use `cloudflared tunnel run`"):
루트 데몬은 `/etc/cloudflared/config.yml`을 읽고, 실행 명령에 `tunnel run` 인자가 필요하다.

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/config.yml ~/.cloudflared/<터널ID>.json /etc/cloudflared/
sudo sed -i '' 's#'"$HOME"'/.cloudflared/#/etc/cloudflared/#' /etc/cloudflared/config.yml
sudo /usr/libexec/PlistBuddy -c "Add :ProgramArguments:1 string tunnel" \
  -c "Add :ProgramArguments:2 string run" /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl unload /Library/LaunchDaemons/com.cloudflare.cloudflared.plist 2>/dev/null
sudo launchctl load /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

데몬 로그: `/Library/Logs/com.cloudflare.cloudflared.err.log`

이후 서버는 `PUBLIC_URL=https://bom.내도메인.com` 환경변수와 함께 시작하면
사이니지 QR·인쇄 QR이 모두 외부 주소를 쓴다.

### 2) 관리자 화면 잠그기 — Cloudflare Access (Zero Trust)

관리자 화면을 원격에서 쓰되, 지정한 이메일만 접근할 수 있게 한다.

1. Cloudflare 대시보드 → **Zero Trust** (처음이면 무료 플랜 선택) → **Access → Applications → Add an application → Self-hosted**
2. Application name: `나의 봄 관리자`
3. **Application domain에 두 경로를 모두 추가** (Add domain 버튼으로 추가):
   - `bom.내도메인.com` / path: `admin`
   - `bom.내도메인.com` / path: `api/admin`
   (관리 API까지 함께 잠가야 완전하다. 환자용 `/`와 사이니지 `/garden`은 그대로 공개)
4. Policy 만들기: Action **Allow**, Include → **Emails** → 원장님 이메일 입력
5. 저장. 이제 `/admin` 접속 시 이메일 인증코드(OTP)를 먼저 통과해야 하고,
   그 다음 앱 자체 비밀번호(`ADMIN_PASSWORD`)를 입력한다 — 이중 잠금.

병원 안 같은 네트워크에서는 `http://localhost:3000/admin` 으로 열면
Access를 거치지 않고 바로(비밀번호만으로) 들어갈 수 있다.

## Mac mini 상시 구동 (자동 시작)

### 1) 서버 자동 시작 — launchd

`~/Library/LaunchAgents/com.mybom.server.plist` 생성:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mybom.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/경로/My_Bom/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/경로/My_Bom</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLOSING_TIME</key><string>18:00</string>
    <key>ADMIN_PASSWORD</key><string>비밀번호변경</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.mybom.server.plist
```

`node` 경로는 `which node`로 확인해 맞춰 주세요.

### 2) 사이니지 브라우저 kiosk 자동 시작

로그인 항목에 아래 명령의 앱/스크립트를 추가하거나 Automator 앱으로 만들어 등록:

```bash
open -a "Google Chrome" --args --kiosk --noerrdialogs --disable-session-crashed-bubble http://localhost:3000/garden.html
```

- 시스템 설정에서 **화면 잠자기 끔**, 자동 로그인 켬.
- 정전 후 자동 재시작: 시스템 설정 → 에너지 → "정전 후 자동으로 시작".
- 서버 데이터는 `data/garden.json`에 저장되므로 재시작해도 들판이 유지됩니다.

## 들판이 사는 방식

- **이별은 밀도가 정한다** — 붐빌수록 자주, 한산하면 거의 떠나지 않는다. 오래된 꽃일수록
  떠날 확률이 높다(나이 제곱 가중). 하루 총 이별 수를 먼저 정하고 바람 횟수로 나누므로,
  바람이 자주 불어도 이별이 잦아지지는 않는다.
- **바람** — `DRIFT_START`~`DRIFT_END` 사이 15~30분 간격(하루 약 20회). 매번 방향(좌↔우)·
  세기(약/보통/강)가 다르고 30% 확률로 소용돌이친다. 들판 전체가 바람 부는 쪽으로 눕는다.
- **저녁 이별** — `CLOSING_TIME`에 그날 붐빈 만큼 함께 떠난다(한 번에 최대 25송이).
  한산했던 날은 아무도 떠나지 않는다. 이때 통계 정리와 백업도 함께 이뤄진다.
- **처음 채우기** — 서버 시작 시 꽃이 `SEED_COUNT`보다 적으면 그만큼 미리 피운다.
  이 꽃들은 관리자 통계에 잡히지 않으며, 실제 참여가 늘면 오래된 순으로 자리를 내준다.

## 들판의 손님

계절(월)과 시각에 맞는 생물만 찾아온다 — 나비(4~10월), 벌(4~9월), 잠자리(7~10월),
참새 무리(연중), 제비(4~9월 해질녘), 반딧불이(6~8월 저녁). 비·눈에는 쉰다.

## 특별한 날

`data/special-days.json`에서 날짜와 효과를 정한다. 효과: `snow` `lights` `star` `moon`
`sunrise` `petals` `glow`. 관리자 화면에서 전체를 켜고 끌 수 있다.
설날·추석은 음력이라 해마다 날짜가 달라, 그 해 날짜를 직접 넣어야 한다.

## 대기실 안내 카드

- `/card-a4.html` — **2쪽짜리 인쇄물**
  - 1쪽: A4 가로에 A5 카드 2장 (가운데 점선에서 자른다) — 테이블·의자에 두는 용도
  - 2쪽: A4 세로에 큰 카드 1장 — 접수대·벽면 게시용
- `/card.html` — A5 한 장짜리.

두 화면 모두 인쇄 버튼이 있고 QR은 자동으로 들어간다.
업데이트를 실행하면 `C:\MyBom\나의봄-안내카드-A4.pdf` 로도 저장된다.

## 원격 업데이트 (평소에는 이 방법)

저장소: **https://github.com/evenzest-afk/mybom-garden**

1. 개발 쪽에서 고친 뒤 `git push`
2. 관리 화면(`/admin`) → **프로그램 업데이트 → 업데이트 확인 → 지금 적용하기**
   - 휴대폰·집에서도 됩니다 (`https://bom.bommind.co.kr/admin`)
   - 저장소의 `server/`·`public/` 만 받아 덮어쓰고, 서버가 스스로 재시작합니다(10초쯤)
   - **적용 전 자동 백업** — 문제가 생기면 **직전 버전으로 되돌리기** 버튼
3. `.env`(비밀번호·설정), `data/garden.json`(들판), `data/special-days.json`(기념일)은
   저장소에 없으므로 절대 덮이지 않습니다.

동작 조건: 병원 PC에 지킴이가 설치되어 있어야 합니다(재시작을 지킴이가 맡습니다).
업데이트 대상 저장소는 `UPDATE_REPO` 환경변수로 바꿀 수 있습니다.

## 병원 PC에 수정사항 반영하기 (USB)

압축을 풀면 세 가지가 나온다. **USB 루트에 그대로** 넣는다:

```
업데이트.bat          <- 이것만 실행하면 된다
mybom-files/          <- 프로그램 파일 (app/ 로 복사됨)
mybom-system/         <- 지킴이 스크립트 (루트로 복사됨)
```

병원 PC에 USB를 꽂고 **`업데이트.bat` 하나만 실행**하면 5단계가 자동으로 진행된다:

1. 프로그램 파일 적용 (server/, public/ 만 덮어씀)
2. 지킴이 설치 — 서버·터널이 죽으면 스스로 되살아난다
3. 로그인 시 자동 시작 등록 (서버 / 터널 / 사이니지)
4. 서버·터널 재시작
5. 사이니지 화면 재실행

**보존되는 것**: `.env`(비밀번호·설정), `data/garden.json`(들판),
`data/special-days.json`(기념일 — 이미 있으면 덮어쓰지 않음).
USB 에는 아무것도 쓰지 않으므로 읽기 전용 USB 도 된다.

문제가 생기면 로그를 본다:
`%USERPROFILE%\mybom-server.log`, `%USERPROFILE%\mybom-tunnel.log`

## 폴더 구조

```
server/   서버 (Express + socket.io), 가챠 로직, 저장소
data/     flowers.json(꽃 42종 정의) · garden.json(들판 상태, 자동 생성)
public/   모바일(/), 사이니지(garden.html), 관리자(admin.html), 꽃 SVG 렌더러
scripts/  QR 생성
```
