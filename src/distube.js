const { DisTube } = require("distube");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { nowPlayingEmbed, addedSongEmbed } = require("./embeds");
const { controlRow } = require("./buttons");

// 오디오를 인코딩하는 opusscript는 기본적으로 비트레이트를 지정하지 않으면
// (OPUS_AUTO) 다소 보수적인 값을 스스로 고르는 경우가 있어, 매 곡마다
// 명시적으로 최대치(prism-media가 허용하는 128kbps)로 올려 음질을 높인다.
const OPUS_BITRATE = 128_000;

function boostBitrate(queue) {
  try {
    queue.voice.stream.audioResource.encoder?.setBitrate(OPUS_BITRATE);
  } catch {
    // 인코더가 아직 준비되지 않았거나 다른 이유로 실패해도 재생 자체엔 지장 없음
  }
}

function createDisTube(client) {
  const distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new SoundCloudPlugin(), new YtDlpPlugin()],
  });

  distube
    .on("playSong", (queue, song) => {
      boostBitrate(queue);
      queue.textChannel
        ?.send({ embeds: [nowPlayingEmbed(queue)], components: [controlRow(queue)] })
        .catch(() => {});
    })
    .on("addSong", (queue, song) => {
      queue.textChannel?.send({ embeds: [addedSongEmbed(song)] }).catch(() => {});
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
