# 나의 봄 - GitHub 에서 바로 갱신 (USB 없이)
# 진료실 PC 에서 PowerShell 을 열고 이 파일을 실행하거나, 내용을 붙여넣으세요.
$ErrorActionPreference = 'Stop'

$root = 'C:\MyBom'
$app  = Join-Path $root 'app'
if (-not (Test-Path "$app\server\index.js")) {
  Write-Host "[X] $app\server\index.js 를 찾을 수 없습니다." -ForegroundColor Red
  Write-Host "    설치 폴더가 다른 곳이면 이 스크립트의 `$root 를 고쳐 주세요."
  exit 1
}
Write-Host "[1/6] 설치 폴더 확인: $app"

$tmp = Join-Path $env:TEMP 'mybom-update'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tmp | Out-Null

Write-Host "[2/6] GitHub 에서 최신본 내려받는 중..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest 'https://codeload.github.com/evenzest-afk/mybom-garden/zip/refs/heads/main' `
  -OutFile "$tmp\m.zip" -UseBasicParsing
Expand-Archive "$tmp\m.zip" $tmp -Force
$src = Join-Path $tmp 'mybom-garden-main'
if (-not (Test-Path "$src\public\garden.html") -or -not (Test-Path "$src\server\index.js")) {
  Write-Host "[X] 내려받은 내용이 온전하지 않습니다. 중단합니다." -ForegroundColor Red
  exit 1
}

Write-Host "[3/6] 되돌리기용 사본 저장 ($root\backup-*)"
Remove-Item "$root\backup-server","$root\backup-public" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$app\server" "$root\backup-server" -Recurse -Force
Copy-Item "$app\public" "$root\backup-public" -Recurse -Force

Write-Host "[4/6] 서버 잠시 멈추고 파일 교체"
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Copy-Item "$src\server\*" "$app\server\" -Recurse -Force
Copy-Item "$src\public\*" "$app\public\" -Recurse -Force
Copy-Item "$src\package.json" "$app\" -Force
if (-not (Test-Path "$app\data\special-days.json")) {
  Copy-Item "$src\data\special-days.json" "$app\data\" -Force
}

Write-Host "[5/6] 원격 업데이트용 모듈(adm-zip) 확인"
if (-not (Test-Path "$app\node_modules\adm-zip")) {
  try {
    Push-Location $app
    & npm install adm-zip --no-audit --no-fund --loglevel=error 2>&1 | Out-Null
    Pop-Location
    if (Test-Path "$app\node_modules\adm-zip") { Write-Host "      설치 완료" }
    else { Write-Host "      건너뜀 - 관리 화면의 '지금 적용하기'만 못 씁니다 (나머지는 정상)" }
  } catch {
    Write-Host "      건너뜀 - 관리 화면의 '지금 적용하기'만 못 씁니다 (나머지는 정상)"
  }
} else { Write-Host "      이미 있음" }

Write-Host "[6/6] 서버 다시 시작"
if (Test-Path "$root\_server-hidden.vbs") {
  Start-Process wscript.exe "`"$root\_server-hidden.vbs`""
} else {
  Start-Process node -ArgumentList 'server\index.js' -WorkingDirectory $app -WindowStyle Hidden
}
Start-Sleep -Seconds 5

try {
  Invoke-WebRequest 'http://localhost:3000/card-a4.html' -UseBasicParsing -TimeoutSec 8 | Out-Null
  Write-Host ""
  Write-Host "  업데이트 완료. 대기실 화면을 F5 로 새로고침하세요." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "  [!] 서버가 응답하지 않습니다." -ForegroundColor Yellow
  Write-Host "      기록: $env:USERPROFILE\mybom-server.log"
  Write-Host "      되돌리려면 $root\backup-server, backup-public 을 app 폴더에 덮어쓰세요."
}
