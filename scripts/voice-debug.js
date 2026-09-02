// 음성 연결이 정확히 어느 단계에서 실패하는지 확인하기 위한 임시 진단 스크립트입니다.
// 사용법: npm start를 잠깐 끄고(Ctrl+C) 대신 이걸 실행하세요.
//   node scripts/voice-debug.js
// 음성 채널에 먼저 들어간 뒤, 텍스트 채널에 !vtest 라고 입력하면 진단이 시작됩니다.
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require("@discordjs/voice");

const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`[진단봇] ${client.user.tag}로 로그인했습니다. 음성 채널에 들어간 뒤 !vtest 입력하세요.`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.content !== "!vtest") return;

  const channel = message.member?.voice?.channel;
  if (!channel) {
    message.reply("먼저 음성 채널에 들어가 주세요.");
    return;
  }

  message.reply(`"${channel.name}" 채널에 연결을 시도합니다. 콘솔 로그를 확인하세요.`);
  console.log("========== 진단 시작 ==========");
  console.log("채널:", channel.name, channel.id, "타입:", channel.type);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    debug: true,
  });

  const wireNetworkingDebug = networking => {
    if (!networking || networking.__wired) return;
    networking.__wired = true;
    networking.on("debug", m => console.log("[networking debug]", m));
    networking.on("error", e => console.error("[networking error]", e));
    networking.on("close", code => console.log("[networking CLOSE CODE]", code));
    networking.on("stateChange", (oldState, newState) => {
      console.log(`[networking 상태] ${oldState.code} -> ${newState.code}`);
    });
  };

  connection.on("debug", m => console.log("[voice debug]", m));
  connection.on("error", e => console.error("[voice error]", e));
  connection.on("stateChange", (oldState, newState) => {
    console.log(`[상태 변화] ${oldState.status} -> ${newState.status}`);
    wireNetworkingDebug(newState.networking);
  });
  wireNetworkingDebug(connection.state.networking);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    console.log("✅ 연결 성공!");
    message.channel.send("✅ 연결 성공!");
  } catch (e) {
    console.error("❌ 연결 실패:", e);
    message.channel.send("❌ 연결 실패. 콘솔 로그를 확인하세요.");
  }
  console.log("========== 진단 끝 ==========");
});

client.login(TOKEN);
