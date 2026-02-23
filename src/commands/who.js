const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('who')
    .setDescription('Цитирует текст и пингует случайного участника сервера')
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Текст вопроса')
        .setRequired(true),
    ),

  async execute(interaction) {
    const text = interaction.options.getString('text');
    const members = await interaction.guild.members.fetch();
    const nonBots = members.filter(m => !m.user.bot);
    const random = nonBots.random();

    await interaction.reply(`> ${text}\n\n${random}`);
  },
};
