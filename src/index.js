require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
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
