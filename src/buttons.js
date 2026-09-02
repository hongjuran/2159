const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function controlRow(queue) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:pauseresume")
      .setEmoji(queue.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("music:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:queue").setEmoji("📜").setStyle(ButtonStyle.Secondary)
  );
}

module.exports = { controlRow };
