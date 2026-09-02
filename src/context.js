// 텍스트 명령어(Message)와 슬래시 명령어(Interaction)를 같은 방식으로 다루기 위한 래퍼.
function fromMessage(message) {
  return {
    guildId: message.guildId,
    guild: message.guild,
    member: message.member,
    channel: message.channel,
    voiceChannel: message.member?.voice?.channel ?? null,
    reply: (content) => message.reply(content),
  };
}

function fromInteraction(interaction) {
  return {
    guildId: interaction.guildId,
    guild: interaction.guild,
    member: interaction.member,
    channel: interaction.channel,
    voiceChannel: interaction.member?.voice?.channel ?? null,
    reply: (content) =>
      interaction.replied || interaction.deferred
        ? interaction.followUp(content)
        : interaction.reply(content),
  };
}

module.exports = { fromMessage, fromInteraction };
