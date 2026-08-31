const { DisTube } = require("distube");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { YtDlpPlugin } = require("@distube/yt-dlp");

function createDisTube(client) {
  const distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new SoundCloudPlugin(), new YtDlpPlugin()],
  });

  distube
    .on("playSong", (queue, song) => {
      queue.textChannel?.send(
        `▶️ 재생 중: **${song.name}** (\`${song.formattedDuration}\`) - 요청: ${song.user}`
      );
    })
    .on("addSong", (queue, song) => {
      queue.textChannel?.send(
        `✅ 대기열에 추가됨: **${song.name}** (\`${song.formattedDuration}\`)`
      );
    })
    .on("finish", (queue) => {
      queue.textChannel?.send("🏁 대기열 재생이 모두 끝났습니다.");
    })
    .on("disconnect", (queue) => {
      queue.textChannel?.send("👋 음성 채널에서 나갔습니다.");
    })
    .on("empty", (queue) => {
      queue.textChannel?.send("음성 채널에 아무도 없어서 나갑니다.");
    })
    .on("error", (channelOrQueue, error) => {
      const textChannel = channelOrQueue?.textChannel ?? channelOrQueue;
      console.error(error);
      textChannel?.send?.(`⚠️ 오류가 발생했습니다: ${error.message ?? error}`);
    });

  return distube;
}

module.exports = { createDisTube };
