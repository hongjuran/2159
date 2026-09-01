# 디스코드 음악 봇 (개인용)

디스코드 서버에서 친구들과 함께 음악을 듣기 위한 개인용 봇입니다.
유튜브 또는 사운드클라우드 URL을 붙여넣으면 음성 채널에서 재생하고, 대기열(큐)을 관리합니다.

## 사전 준비물

- [Node.js](https://nodejs.org/) 18 버전 이상
- [FFmpeg](https://ffmpeg.org/download.html) (시스템에 설치되어 있고 `ffmpeg` 명령으로 실행 가능해야 합니다)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) (유튜브/사운드클라우드 오디오 추출에 사용됩니다. `pip install -U yt-dlp` 또는 공식 설치 가이드를 참고하세요)
- 디스코드 봇 토큰 ([Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션과 봇을 생성)

봇 생성 시 **Bot** 탭에서 아래 항목을 꼭 켜주세요.

- `MESSAGE CONTENT INTENT` (Privileged Gateway Intents)

봇 초대(OAuth2 URL Generator) 시 필요한 권한/스코프:

- Scope: `bot`
- Bot Permissions: `View Channels`, `Send Messages`, `Connect`, `Speak`

## 설치

```bash
npm install
cp .env.example .env
```

`.env` 파일을 열어 `DISCORD_TOKEN`에 발급받은 봇 토큰을 입력하세요.

```
DISCORD_TOKEN=여기에_봇_토큰
COMMAND_PREFIX=!
```

## 실행

```bash
npm start
```

## 사용법

음성 채널에 먼저 접속한 상태에서 텍스트 채널에 명령어를 입력합니다.

| 명령어 | 설명 |
| --- | --- |
| `!play <URL>` | 유튜브/사운드클라우드 URL 재생 (대기열에 추가) |
| `!skip` | 다음 곡으로 넘기기 |
| `!stop` | 재생 정지 및 대기열 비우기 |
| `!pause` / `!resume` | 일시정지 / 다시재생 |
| `!queue` | 대기열 보기 |
| `!nowplaying` | 현재 재생 곡 정보 |
| `!volume <0-100>` | 볼륨 조절 |
| `!shuffle` | 대기열 섞기 |
| `!leave` | 음성 채널 나가기 |
| `!help` | 명령어 목록 보기 |

명령어 접두사는 `.env`의 `COMMAND_PREFIX`로 바꿀 수 있습니다.

## 봇 이름 / 프로필 사진 설정 (펭베)

`.env`에 토큰을 넣은 뒤 아래 명령을 한 번 실행하면 봇 표시 이름을 **펭베**로, 프로필 사진을 `assets/penguin-avatar.png`(펭귄 아이콘)로 자동 설정합니다.

```bash
npm run set-profile
```

- 이름/아바타는 `client.user.setUsername()` / `client.user.setAvatar()`로 즉시 반영되며, 디스코드 클라이언트를 재시작(Ctrl+R)하면 바로 보입니다.
- 아이폰 기본 펭귄 이모지(🐧)는 애플의 저작물이라 그대로 복제해서 넣을 수 없어, 비슷한 느낌의 자체 제작 펭귄 아이콘(`assets/penguin-avatar.svg` 원본 포함)을 기본값으로 넣어뒀습니다.
- 아이폰에서 실제 이모지를 캡처/저장한 이미지가 있다면 그 파일을 대신 사용할 수 있습니다.
  ```bash
  npm run set-profile -- /path/to/penguin.png
  ```
- 이름은 `.env`의 `BOT_NAME`으로 바꿀 수 있습니다.
- 디스코드는 짧은 시간 안에 이름/아바타를 반복 변경하면 제한을 걸 수 있으니, 보통 한 번만 실행하면 충분합니다.

## 유튜브 로그인(쿠키) 설정 (선택, 권장)

봇은 파일을 다운로드하지 않고 유튜브/사운드클라우드에서 오디오 스트림 주소만 받아 바로 디스코드 음성 채널로 흘려보냅니다. 다만 유튜브가 로그인하지 않은 요청을 "로봇 확인"으로 자주 막기 때문에, 본인 계정 쿠키를 넘겨주면 안정성이 크게 좋아집니다.

> 참고: 쿠키를 넣어도 유튜브 프리미엄의 광고 제거/고음질 혜택이 오디오 추출 자체에 적용되지는 않습니다. 실질적 효과는 "로봇 확인" 차단 회피와 연령제한/비공개 영상 접근입니다.

1. 크롬/엣지에 [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) 같은 확장 프로그램을 설치합니다.
2. 본인 계정으로 유튜브에 로그인한 상태에서 `youtube.com`을 열고 확장 프로그램으로 쿠키를 `cookies.txt`로 내보냅니다.
3. 내보낸 파일을 이 프로젝트 폴더에 `cookies.txt`로 저장합니다. (`.gitignore`에 이미 등록되어 있어 실수로 커밋되지 않습니다. 로그인 정보나 다름없으니 **절대 남과 공유하거나 커밋하지 마세요**.)
4. yt-dlp가 항상 이 쿠키를 사용하도록 설정 파일을 만듭니다.
   - macOS/Linux: `~/.config/yt-dlp/config` 파일을 만들고 아래 한 줄을 적습니다.
     ```
     --cookies /절대/경로/2159/cookies.txt
     ```
   - Windows: `%APPDATA%\yt-dlp\config.txt` 파일에 동일하게 적습니다.
5. 봇을 재시작하면 이후 모든 `!play` 요청에 로그인 쿠키가 자동 적용됩니다.

쿠키는 시간이 지나면 만료될 수 있어, 재생이 다시 자주 실패하면 1~2번 과정을 반복해 새로 내보내면 됩니다.

## 참고

- 유튜브/사운드클라우드 추출은 [DisTube](https://distube.js.org/) + `@distube/yt-dlp`(유튜브) + `@distube/soundcloud`(사운드클라우드) 플러그인을 사용합니다.
- 유튜브 쪽 추출이 실패한다면 yt-dlp를 최신 버전으로 업데이트해 보세요 (`pip install -U yt-dlp`).
- 봇은 컴퓨터(또는 서버)가 켜져 있고 `npm start`가 실행 중인 동안에만 온라인 상태입니다. 계속 켜두고 싶다면 상시 켜둘 PC에서 실행하거나, VPS/라즈베리파이 등에 [pm2](https://pm2.keymetrics.io/) 같은 프로세스 매니저로 등록해두는 걸 추천합니다.
