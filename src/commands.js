const { queueEmbed, nowPlayingEmbed } = require("./embeds");
const { controlRow } = require("./buttons");

function requireVoiceChannel(ctx) {
  if (!ctx.voiceChannel) {
    ctx.reply("먼저 음성 채널에 접속한 후에 명령어를 사용해 주세요.");
    return null;
  }
  return ctx.voiceChannel;
}

// 유튜브 "믹스/라디오" 자동재생 링크(list=RD...)는 yt-dlp가 영상 1개 대신
// 믹스 전체(수백~수천 개)를 추출하려다 실패하므로, 재생 전에 잘라낸다.
function sanitizeYoutubeQuery(query) {
  let url;
  try {
    url = new URL(query);
  } catch {
    return query;
  }

  const isYoutube = /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === "youtu.be";
  if (!isYoutube) return query;

  const listParam = url.searchParams.get("list");
  if (listParam && /^RD/.test(listParam)) {
    url.searchParams.delete("list");
    url.searchParams.delete("start_radio");
    url.searchParams.delete("index");
    return url.toString();
  }
  return query;
}

const commands = {
  async play(ctx, args, distube) {
    const voiceChannel = requireVoiceChannel(ctx);
    if (!voiceChannel) return;

    const rawQuery = args.join(" ");
    if (!rawQuery) {
      ctx.reply("유튜브나 사운드클라우드 URL을 함께 입력해 주세요. 예: `/play` 또는 `!play <URL>`");
      return;
    }

    const query = sanitizeYoutubeQuery(rawQuery);
    await ctx.reply("🔎 재생을 준비하고 있어요...");

    try {
      await distube.play(voiceChannel, query, {
        textChannel: ctx.channel,
        member: ctx.member,
      });
    } catch (error) {
      if (error?.errorCode === "YTDLP_ERROR") {
        ctx.reply(
          "⚠️ 이 링크는 재생할 수 없어요. 유튜브 '믹스/라디오' 자동재생 목록 링크일 수 있습니다. 영상 하단의 **공유** 버튼으로 받은 일반 링크로 다시 시도해 주세요."
        );
        return;
      }
      throw error;
    }
  },

  async skip(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    try {
      const song = await queue.skip();
      ctx.reply(`⏭️ 스킵했습니다. 다음 곡: **${song.name}**`);
    } catch (e) {
      ctx.reply("다음 곡이 없어 재생을 종료합니다.");
    }
  },

  stop(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    queue.stop();
    ctx.reply("⏹️ 재생을 멈추고 대기열을 비웠습니다.");
  },

  pause(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    if (queue.paused) {
      ctx.reply("이미 일시정지 상태입니다.");
      return;
    }
    queue.pause();
    ctx.reply("⏸️ 일시정지했습니다.");
  },

  resume(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    if (!queue.paused) {
      ctx.reply("이미 재생 중입니다.");
      return;
    }
    queue.resume();
    ctx.reply("▶️ 다시 재생합니다.");
  },

  leave(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    queue.stop();
    ctx.reply("👋 음성 채널에서 나갔습니다.");
  },

  queue(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("대기열이 비어 있습니다.");
      return;
    }
    ctx.reply({ embeds: [queueEmbed(queue)], components: [controlRow(queue)] });
  },

  nowplaying(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    ctx.reply({ embeds: [nowPlayingEmbed(queue)], components: [controlRow(queue)] });
  },

  volume(ctx, args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    const value = Number(args[0]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      ctx.reply(`현재 볼륨: ${queue.volume}%. 사용법: \`!volume <0-100>\``);
      return;
    }
    queue.setVolume(value);
    ctx.reply(`🔊 볼륨을 ${value}%로 설정했습니다.`);
  },

  shuffle(ctx, _args, distube) {
    const queue = distube.getQueue(ctx.guildId);
    if (!queue) {
      ctx.reply("대기열이 비어 있습니다.");
      return;
    }
    queue.shuffle();
    ctx.reply("🔀 대기열을 섞었습니다.");
  },

  help(ctx) {
    ctx.reply(
      [
        "**사용 가능한 명령어**",
        "`/play <url>` - 유튜브/사운드클라우드 URL 재생 (대기열에 추가)",
        "`/skip` - 다음 곡으로 넘기기",
        "`/stop` - 재생 정지 및 대기열 비우기",
        "`/pause` / `/resume` - 일시정지 / 다시재생",
        "`/queue` - 대기열 보기",
        "`/nowplaying` - 현재 재생 곡 정보",
        "`/volume <0-100>` - 볼륨 조절",
        "`/shuffle` - 대기열 섞기",
        "`/leave` - 음성 채널 나가기",
        "",
        "슬래시(`/`) 명령어를 입력하면 목록이 자동으로 뜹니다. 기존 `!` 접두사 명령어도 계속 사용할 수 있어요.",
      ].join("\n")
    );
  },
};

module.exports = { commands, sanitizeYoutubeQuery };
