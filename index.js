const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

client.commands = new Collection();

// ─── Load Commands ───────────────────────────────────────────────────────────
const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const exports = require(`./commands/${file}`);
  // Support both single export { name, execute } and multi export { cmd1, cmd2 }
  if (exports.name) {
    client.commands.set(exports.name, exports);
  } else {
    for (const command of Object.values(exports)) {
      if (command.name) client.commands.set(command.name, command);
    }
  }
}

// ─── In-memory data stores ───────────────────────────────────────────────────
const xpData = {};          // { userId: { xp, level } }
const giveaways = {};       // { messageId: { prize, endsAt, entries, channelId } }
const polls = {};           // { messageId: { question, options, votes } }

const PREFIX = '!';

// ─── Auto-Mod Config (customize these) ───────────────────────────────────────
const BAD_WORDS = ['badword1', 'badword2', 'spam'];  // Add your bad words here
const MAX_MENTIONS = 5;
const MAX_CAPS_PERCENT = 70;

// ─── Welcome message channel name ────────────────────────────────────────────
const WELCOME_CHANNEL_NAME = 'welcome'; // Change to your welcome channel name

// ─── Ready Event ─────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  client.user.setActivity('the server | !help', { type: 'WATCHING' });

  // Check giveaways every 10 seconds
  setInterval(() => checkGiveaways(client, giveaways), 10000);
});

// ─── New Member Welcome ───────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const channel = member.guild.channels.cache.find(c => c.name === WELCOME_CHANNEL_NAME);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('👋 Welcome to the server!')
    .setDescription(`Hey ${member}, welcome to **${member.guild.name}**! We're glad to have you here. 🎉`)
    .addFields(
      { name: '📜 Rules', value: 'Please read #rules to get started.' },
      { name: '🎮 Have fun!', value: 'Hang out, chat, and enjoy your stay.' }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  channel.send({ embeds: [embed] });
});

// ─── Message Handler ──────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // XP System
  handleXP(message, xpData);

  // Auto-Mod
  const deleted = await handleAutoMod(message, BAD_WORDS, MAX_MENTIONS, MAX_CAPS_PERCENT);
  if (deleted) return;

  // Commands
  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(message, args, { xpData, giveaways, polls, client });
  } catch (err) {
    console.error(err);
    message.reply('❌ An error occurred while running that command.');
  }
});

// ─── Reaction Handler (Polls & Giveaways) ─────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();

  const msgId = reaction.message.id;

  // Giveaway entry
  if (giveaways[msgId]) {
    if (reaction.emoji.name === '🎉') {
      if (!giveaways[msgId].entries.includes(user.id)) {
        giveaways[msgId].entries.push(user.id);
      }
    }
  }
});

// ─── XP Handler ──────────────────────────────────────────────────────────────
function handleXP(message, xpData) {
  const userId = message.author.id;
  if (!xpData[userId]) xpData[userId] = { xp: 0, level: 1 };

  const gained = Math.floor(Math.random() * 10) + 5;
  xpData[userId].xp += gained;

  const xpNeeded = xpData[userId].level * 100;
  if (xpData[userId].xp >= xpNeeded) {
    xpData[userId].xp -= xpNeeded;
    xpData[userId].level++;
    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🎉 Level Up!')
      .setDescription(`${message.author} leveled up to **Level ${xpData[userId].level}**!`);
    message.channel.send({ embeds: [embed] });
  }
}

// ─── Auto-Mod Handler ─────────────────────────────────────────────────────────
async function handleAutoMod(message, badWords, maxMentions, maxCapsPercent) {
  const content = message.content.toLowerCase();
  const member = message.member;

  // Skip mods/admins
  if (member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return false;

  // Bad words
  if (badWords.some(word => content.includes(word))) {
    await message.delete();
    const warn = await message.channel.send(`⚠️ ${message.author}, that language is not allowed here!`);
    setTimeout(() => warn.delete(), 5000);
    return true;
  }

  // Too many mentions
  if (message.mentions.users.size > maxMentions) {
    await message.delete();
    const warn = await message.channel.send(`⚠️ ${message.author}, please don't mass-mention users!`);
    setTimeout(() => warn.delete(), 5000);
    return true;
  }

  // Caps lock spam
  const letters = message.content.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 10) {
    const caps = letters.replace(/[^A-Z]/g, '').length;
    if ((caps / letters.length) * 100 > maxCapsPercent) {
      await message.delete();
      const warn = await message.channel.send(`⚠️ ${message.author}, please don't spam caps!`);
      setTimeout(() => warn.delete(), 5000);
      return true;
    }
  }

  return false;
}

// ─── Giveaway Checker ─────────────────────────────────────────────────────────
async function checkGiveaways(client, giveaways) {
  const now = Date.now();
  for (const [msgId, giveaway] of Object.entries(giveaways)) {
    if (now >= giveaway.endsAt) {
      const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel) { delete giveaways[msgId]; continue; }

      const message = await channel.messages.fetch(msgId).catch(() => null);
      if (!message) { delete giveaways[msgId]; continue; }

      if (giveaway.entries.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🎉 Giveaway Ended')
          .setDescription(`**Prize:** ${giveaway.prize}\n\nNo one entered the giveaway!`);
        await message.edit({ embeds: [embed] });
      } else {
        const winnerId = giveaway.entries[Math.floor(Math.random() * giveaway.entries.length)];
        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🎉 Giveaway Ended!')
          .setDescription(`**Prize:** ${giveaway.prize}\n\n🏆 Winner: <@${winnerId}>`);
        await message.edit({ embeds: [embed] });
        channel.send(`🎉 Congratulations <@${winnerId}>! You won **${giveaway.prize}**!`);
      }

      delete giveaways[msgId];
    }
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);
