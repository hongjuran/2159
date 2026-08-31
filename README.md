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

## 참고

- 유튜브/사운드클라우드 추출은 [DisTube](https://distube.js.org/) + `@distube/yt-dlp`(유튜브) + `@distube/soundcloud`(사운드클라우드) 플러그인을 사용합니다.
- 유튜브 쪽 추출이 실패한다면 yt-dlp를 최신 버전으로 업데이트해 보세요 (`pip install -U yt-dlp`).
