// 슬래시(/) 명령어를 디스코드 서버에 등록하는 스크립트입니다.
// .env에 DISCORD_TOKEN, CLIENT_ID, GUILD_ID를 넣고 한 번 실행하세요.
//   npm run deploy-commands
// 서버(길드) 단위로 등록하기 때문에 실행 즉시 반영됩니다.
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    ".env에 DISCORD_TOKEN, CLIENT_ID, GUILD_ID가 모두 설정되어 있어야 합니다. README를 참고하세요."
  );
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("유튜브/사운드클라우드 URL 재생 (대기열에 추가)")
    .addStringOption((option) =>
      option.setName("url").setDescription("유튜브 또는 사운드클라우드 URL").setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("다음 곡으로 넘기기"),
  new SlashCommandBuilder().setName("stop").setDescription("재생 정지 및 대기열 비우기"),
  new SlashCommandBuilder().setName("pause").setDescription("일시정지"),
  new SlashCommandBuilder().setName("resume").setDescription("다시 재생"),
  new SlashCommandBuilder().setName("queue").setDescription("대기열 보기"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("현재 재생 곡 정보"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("볼륨 조절")
    .addIntegerOption((option) =>
      option.setName("value").setDescription("0~100").setMinValue(0).setMaxValue(100).setRequired(true)
    ),
  new SlashCommandBuilder().setName("shuffle").setDescription("대기열 섞기"),
  new SlashCommandBuilder().setName("leave").setDescription("음성 채널 나가기"),
  new SlashCommandBuilder().setName("help").setDescription("명령어 목록 보기"),
].map((command) => command.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`슬래시 명령어 ${commands.length}개를 등록합니다...`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ 등록 완료! 디스코드에서 `/`를 입력해 보세요.");
  } catch (error) {
    console.error("명령어 등록 중 오류가 발생했습니다:", error);
    process.exit(1);
  }
})();
