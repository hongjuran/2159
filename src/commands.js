function requireVoiceChannel(message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    message.reply("먼저 음성 채널에 접속한 후에 명령어를 사용해 주세요.");
    return null;
  }
  return voiceChannel;
}

const commands = {
  async play(message, args, distube) {
    const voiceChannel = requireVoiceChannel(message);
    if (!voiceChannel) return;

    const query = args.join(" ");
    if (!query) {
      message.reply("유튜브나 사운드클라우드 URL을 함께 입력해 주세요. 예: `!play <URL>`");
      return;
    }

    await distube.play(voiceChannel, query, {
      textChannel: message.channel,
      member: message.member,
    });
  },

  async skip(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    try {
      const song = await queue.skip();
      message.reply(`⏭️ 스킵했습니다. 다음 곡: **${song.name}**`);
    } catch (e) {
      message.reply("다음 곡이 없어 재생을 종료합니다.");
    }
  },

  stop(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    queue.stop();
    message.reply("⏹️ 재생을 멈추고 대기열을 비웠습니다.");
  },

  pause(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    if (queue.paused) {
      message.reply("이미 일시정지 상태입니다.");
      return;
    }
    queue.pause();
    message.reply("⏸️ 일시정지했습니다.");
  },

  resume(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    if (!queue.paused) {
      message.reply("이미 재생 중입니다.");
      return;
    }
    queue.resume();
    message.reply("▶️ 다시 재생합니다.");
  },

  leave(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    queue.stop();
    message.reply("👋 음성 채널에서 나갔습니다.");
  },

  queue(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("대기열이 비어 있습니다.");
      return;
    }
    const list = queue.songs
      .map((song, i) => `${i === 0 ? "▶️" : `${i}.`} **${song.name}** \`${song.formattedDuration}\``)
      .join("\n");
    message.reply(`**현재 대기열**\n${list}`);
  },

  nowplaying(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    const song = queue.songs[0];
    message.reply(
      `🎵 **${song.name}** \`[${queue.formattedCurrentTime}/${song.formattedDuration}]\` - 요청: ${song.user}`
    );
  },

  volume(message, args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("현재 재생 중인 곡이 없습니다.");
      return;
    }
    const value = Number(args[0]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      message.reply(`현재 볼륨: ${queue.volume}%. 사용법: \`!volume <0-100>\``);
      return;
    }
    queue.setVolume(value);
    message.reply(`🔊 볼륨을 ${value}%로 설정했습니다.`);
  },

  shuffle(message, _args, distube) {
    const queue = distube.getQueue(message);
    if (!queue) {
      message.reply("대기열이 비어 있습니다.");
      return;
    }
    queue.shuffle();
    message.reply("🔀 대기열을 섞었습니다.");
  },

  help(message) {
    message.reply(
      [
        "**사용 가능한 명령어**",
        "`!play <URL>` - 유튜브/사운드클라우드 URL 재생 (대기열에 추가)",
        "`!skip` - 다음 곡으로 넘기기",
        "`!stop` - 재생 정지 및 대기열 비우기",
        "`!pause` / `!resume` - 일시정지 / 다시재생",
        "`!queue` - 대기열 보기",
        "`!nowplaying` - 현재 재생 곡 정보",
        "`!volume <0-100>` - 볼륨 조절",
        "`!shuffle` - 대기열 섞기",
        "`!leave` - 음성 채널 나가기",
      ].join("\n")
    );
  },
};

module.exports = { commands };
