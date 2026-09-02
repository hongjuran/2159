require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { getVoiceConnection } = require("@discordjs/voice");
const { createDisTube } = require("./distube");
const { commands } = require("./commands");

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.COMMAND_PREFIX || "!";

if (!TOKEN) {
  console.error("DISCORD_TOKEN이 설정되어 있지 않습니다. .env 파일을 확인해 주세요.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const distube = createDisTube(client);

client.once("ready", () => {
  console.log(`${client.user.tag}로 로그인했습니다.`);
});

// 사람이 디스코드에서 봇을 직접 "연결 끊기" 했는데도 진행 중이던 작업(예: 오래
// 걸리는 !play 처리)이 끝나면서 저절로 다시 들어오는 걸 막기 위해, 봇 자신이
// 음성 채널에서 빠졌다는 이벤트를 받으면 연결과 대기열을 확실히 정리한다.
client.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.id !== client.user.id) return;
  if (!oldState.channelId || newState.channelId) return;

  const connection = getVoiceConnection(oldState.guild.id);
  connection?.destroy();

  const queue = distube.getQueue(oldState.guild.id);
  if (queue) {
    try {
      queue.stop();
    } catch {
      // 연결이 이미 끊어진 상태라 stop()이 실패해도 무시한다.
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  const handler = commands[commandName];
  if (!handler) return;

  try {
    await handler(message, args, distube);
  } catch (error) {
    console.error(`명령어 처리 중 오류 (${commandName}):`, error);
    message.reply("명령어 처리 중 오류가 발생했습니다.").catch(() => {});
  }
});

client.login(TOKEN);
