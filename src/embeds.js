const { EmbedBuilder } = require("discord.js");

const COLOR = 0x4fc3f7;

function progressBar(current, total, size = 20) {
  if (!total || total <= 0) return "🔴 LIVE";
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(size * ratio);
  return "▬".repeat(filled) + "🔘" + "▬".repeat(Math.max(size - filled, 0));
}

function nowPlayingEmbed(queue) {
  const song = queue.songs[0];
  const bar = progressBar(queue.currentTime, song.duration);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: "🎵 지금 재생 중" })
    .setTitle(song.name)
    .setURL(song.url)
    .setThumbnail(song.thumbnail ?? null)
    .setDescription(
      `${bar}\n\`${queue.formattedCurrentTime} / ${song.formattedDuration}\``
    )
    .addFields(
      { name: "요청자", value: `${song.user ?? "알 수 없음"}`, inline: true },
      { name: "볼륨", value: `${queue.volume}%`, inline: true },
      { name: "대기열", value: `${queue.songs.length - 1}곡`, inline: true }
    );
}

function addedSongEmbed(song) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: "✅ 대기열에 추가됨" })
    .setTitle(song.name)
    .setURL(song.url)
    .setThumbnail(song.thumbnail ?? null)
    .addFields(
      { name: "길이", value: `${song.formattedDuration}`, inline: true },
      { name: "요청자", value: `${song.user ?? "알 수 없음"}`, inline: true }
    );
}

function queueEmbed(queue) {
  const list = queue.songs
    .slice(0, 10)
    .map((song, i) => `${i === 0 ? "▶️" : `${i}.`} **${song.name}** \`${song.formattedDuration}\` - ${song.user}`)
    .join("\n");
  const more = queue.songs.length > 10 ? `\n...외 ${queue.songs.length - 10}곡` : "";
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: "📜 현재 대기열" })
    .setDescription(list + more)
    .setFooter({ text: `총 ${queue.songs.length}곡 · 볼륨 ${queue.volume}%` });
}

module.exports = { nowPlayingEmbed, addedSongEmbed, queueEmbed, progressBar };
