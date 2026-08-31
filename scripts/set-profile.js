// 봇의 표시 이름과 프로필 사진(아바타)을 한 번에 설정하는 1회성 스크립트입니다.
// 사용법: npm run set-profile [이미지경로]  (이미지경로 생략 시 assets/penguin-avatar.png 사용)
require("dotenv").config();
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const BOT_NAME = process.env.BOT_NAME || "펭베";
const avatarPath = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "assets", "penguin-avatar.png")
);

if (!TOKEN) {
  console.error("DISCORD_TOKEN이 설정되어 있지 않습니다. .env 파일을 확인해 주세요.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  try {
    console.log(`현재 이름: ${client.user.username}`);

    if (client.user.username !== BOT_NAME) {
      await client.user.setUsername(BOT_NAME);
      console.log(`이름을 "${BOT_NAME}"(으)로 변경했습니다.`);
    } else {
      console.log("이름이 이미 동일하여 건너뜁니다.");
    }

    await client.user.setAvatar(avatarPath);
    console.log(`아바타를 "${avatarPath}"(으)로 변경했습니다.`);

    console.log("완료! 디스코드 클라이언트를 재시작(Ctrl+R)하면 바로 반영됩니다.");
  } catch (error) {
    console.error("프로필 변경 중 오류가 발생했습니다:", error.message);
    console.error(
      "이름/아바타 변경은 디스코드 자체 요청 한도(예: 짧은 시간 내 반복 변경)에 걸릴 수 있습니다. 잠시 후 다시 시도해 주세요."
    );
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(TOKEN);
