require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

// Database path for storing user preferences
const DB_PATH = path.join(__dirname, '..', 'data');
const USER_PREFS_FILE = path.join(DB_PATH, 'user_preferences.json');

// Track active scheduled jobs
const activeJobs = {};

// Define notification times from the image
const NOTIFICATION_TIMES = [
  { label: '10:30 AM', value: '10:30', cronTime: '30 10 * * *', earlyWarningCron: '25 10 * * *' },
  { label: '12:00 PM', value: '12:00', cronTime: '0 12 * * *', earlyWarningCron: '55 11 * * *' },
  { label: '1:30 PM', value: '13:30', cronTime: '30 13 * * *', earlyWarningCron: '25 13 * * *' },
  { label: '3:00 PM', value: '15:00', cronTime: '0 15 * * *', earlyWarningCron: '55 14 * * *' },
  { label: '4:30 PM', value: '16:30', cronTime: '30 16 * * *', earlyWarningCron: '25 16 * * *' },
  { label: '6:00 PM', value: '18:00', cronTime: '0 18 * * *', earlyWarningCron: '55 17 * * *' },
  { label: '7:30 PM', value: '19:30', cronTime: '30 19 * * *', earlyWarningCron: '25 19 * * *' },
  { label: '9:00 PM', value: '21:00', cronTime: '0 21 * * *', earlyWarningCron: '55 20 * * *' },
  { label: '10:30 PM', value: '22:30', cronTime: '30 22 * * *', earlyWarningCron: '25 22 * * *' },
  { label: '12:00 AM', value: '00:00', cronTime: '0 0 * * *', earlyWarningCron: '55 23 * * *' },
  { label: '1:30 AM', value: '01:30', cronTime: '30 1 * * *', earlyWarningCron: '25 1 * * *' },
  { label: '3:00 AM', value: '03:00', cronTime: '0 3 * * *', earlyWarningCron: '55 2 * * *' },
  { label: '4:30 AM', value: '04:30', cronTime: '30 4 * * *', earlyWarningCron: '25 4 * * *' },
  { label: '6:00 AM', value: '06:00', cronTime: '0 6 * * *', earlyWarningCron: '55 5 * * *' },
  { label: '7:30 AM', value: '07:30', cronTime: '30 7 * * *', earlyWarningCron: '25 7 * * *' },
  { label: '9:00 AM', value: '09:00', cronTime: '0 9 * * *', earlyWarningCron: '55 8 * * *' }
];

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DB_PATH, { recursive: true });
    
    try {
      await fs.access(USER_PREFS_FILE);
    } catch (err) {
      // File doesn't exist, create it with empty object
      await fs.writeFile(USER_PREFS_FILE, JSON.stringify({}, null, 2));
    }
  } catch (err) {
    console.error('Error setting up data directory:', err);
  }
}

// Load user preferences
async function loadUserPreferences() {
  try {
    const data = await fs.readFile(USER_PREFS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading user preferences:', err);
    return {};
  }
}

// Save user preferences
async function saveUserPreferences(prefs) {
  try {
    await fs.writeFile(USER_PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch (err) {
    console.error('Error saving user preferences:', err);
  }
}

// Create notification select menu
function createNotificationMenu() {
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('notification_times')
        .setPlaceholder('Select notification times')
        .setMinValues(0)
        .setMaxValues(NOTIFICATION_TIMES.length)
        .addOptions(NOTIFICATION_TIMES.map(time => ({
          label: time.label,
          value: time.value,
          description: `Get notified at ${time.label}`
        })))
    );
  
  const autoApplyRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('auto_apply_yes')
        .setLabel('Auto-apply for next day')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('auto_apply_no')
        .setLabel('Just for today')
        .setStyle(ButtonStyle.Secondary)
    );
  
  return [row, autoApplyRow];
}

// Send daily notification selector
async function sendDailySelector(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🔔 Notification Times')
    .setDescription('Select the times you want to be notified today')
    .setColor('#5865F2');

  await channel.send({
    embeds: [embed],
    components: createNotificationMenu()
  });
}

// Set up notification schedules
async function setupNotifications() {
  try {
    const userPrefs = await loadUserPreferences();
    
    // Schedule notifications for each user and their selected times
    Object.entries(userPrefs).forEach(([userId, prefs]) => {
    if (!prefs.times || !prefs.times.length) return;
    
    // Clear existing schedules if any
    if (prefs.scheduledJobs) {
      prefs.scheduledJobs.forEach(jobId => {
        const job = activeJobs[jobId];
        if (job && typeof job.cancel === 'function') {
          job.cancel();
          delete activeJobs[jobId];
        }
      });
    }
    
    prefs.scheduledJobs = [];
    
    // Schedule new notifications
    prefs.times.forEach(timeValue => {
      const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
      if (!timeInfo) return;
      
      // Schedule 5-minute early warning
      const earlyWarningJob = cron.schedule(timeInfo.earlyWarningCron, async () => {
        try {
          const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
          if (channel) {
            channel.send(`<@${userId}> ⏰ **5-minute reminder**: Your notification for ${timeInfo.label} is coming up soon!`);
          }
        } catch (err) {
          console.error(`Error sending early warning to user ${userId}:`, err);
        }
      });
      
      // Schedule main notification
      const mainJob = cron.schedule(timeInfo.cronTime, async () => {
        try {
          const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
          if (channel) {
            channel.send(`<@${userId}> 🔔 **Time's up!** This is your notification for ${timeInfo.label}`);
          }
        } catch (err) {
          console.error(`Error sending notification to user ${userId}:`, err);
        }
      });
      
      // Store job IDs for future reference
      if (earlyWarningJob) {
        const earlyJobId = `${userId}_${timeValue}_early`;
        prefs.scheduledJobs.push(earlyJobId);
        activeJobs[earlyJobId] = earlyWarningJob;
      }
      
      if (mainJob) {
        const mainJobId = `${userId}_${timeValue}_main`;
        prefs.scheduledJobs.push(mainJobId);
        activeJobs[mainJobId] = mainJob;
      }
    });
  });
  
  // Save updated preferences
  await saveUserPreferences(userPrefs);
  } catch (err) {
    console.error('Error setting up notifications:', err);
  }
}

// Schedule the daily 8 AM message
function scheduleDailyMessage() {
  cron.schedule('0 8 * * *', async () => {
    try {
      const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
      if (channel) {
        // Apply saved preferences from previous day for users who opted in
        await applyAutoPreferences();
        
        // Send daily selection message
        await sendDailySelector(channel);
      }
    } catch (err) {
      console.error('Error sending daily selector:', err);
    }
  });
}

// Apply saved preferences for users who opted in to auto-apply
async function applyAutoPreferences() {
  try {
    const userPrefs = await loadUserPreferences();
    let updated = false;
    
    // For each user who has opted in for auto-apply
    Object.entries(userPrefs).forEach(([userId, prefs]) => {
      if (prefs.autoApply && prefs.times && prefs.times.length > 0) {
        // Keep their preferences the same
        updated = true;
      } else {
        // Reset preferences for users who didn't opt in
        if (prefs.times && prefs.times.length > 0) {
          prefs.times = [];
          updated = true;
        }
      }
    });
    
    // Save if any changes were made
    if (updated) {
      await saveUserPreferences(userPrefs);
      await setupNotifications();
    }
  } catch (err) {
    console.error('Error applying auto preferences:', err);
  }
}

// Client ready event
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Ensure data directory exists
  await ensureDataDir();
  
  // Setup existing notifications
  await setupNotifications();
  
  // Schedule daily message
  scheduleDailyMessage();
});

// Interaction handling for select menu and buttons
client.on('interactionCreate', async interaction => {
  // Handle select menu interactions
  if (interaction.isStringSelectMenu() && interaction.customId === 'notification_times') {
    const userId = interaction.user.id;
    const selectedTimes = interaction.values;
    
    // Load current preferences
    const userPrefs = await loadUserPreferences();
    
    // Update user's selected times
    if (!userPrefs[userId]) {
      userPrefs[userId] = { times: [], autoApply: false };
    }
    
    userPrefs[userId].times = selectedTimes;
    
    // Save preferences
    await saveUserPreferences(userPrefs);
    
    // Update notifications
    await setupNotifications();
    
    // Create disabled dropdown with user's selections
    const disabledRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('notification_times_disabled')
          .setPlaceholder(`✅ Selected: ${selectedTimes.length} time(s)`)
          .setDisabled(true)
          .addOptions([{
            label: 'Selection completed',
            value: 'completed',
            description: 'You have made your selection'
          }])
      );
    
    // Keep the auto-apply buttons active
    const autoApplyRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('auto_apply_yes')
          .setLabel('Auto-apply for next day')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('auto_apply_no')
          .setLabel('Just for today')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Update the original message with disabled dropdown
    const updatedEmbed = new EmbedBuilder()
      .setTitle('🔔 Notification Times')
      .setDescription(`✅ **Selection Complete!**\n\n${interaction.user.username} selected:\n${selectedTimes.map(t => {
        const time = NOTIFICATION_TIMES.find(nt => nt.value === t);
        return `• ${time ? time.label : t}`;
      }).join('\n')}\n\nYou'll receive:\n• ⏰ 5-minute reminders\n• 🔔 Main notifications`)
      .setColor('#00FF00');
    
    await interaction.update({
      embeds: [updatedEmbed],
      components: [disabledRow, autoApplyRow]
    });
    
    // Send ephemeral confirmation
    await interaction.followUp({ 
      content: `Your notification times have been updated! You'll be notified at: ${selectedTimes.map(t => {
        const time = NOTIFICATION_TIMES.find(nt => nt.value === t);
        return time ? time.label : t;
      }).join(', ')}`, 
      ephemeral: true 
    });
  }
  
  // Handle button interactions for auto-apply
  if (interaction.isButton()) {
    if (interaction.customId === 'auto_apply_yes' || interaction.customId === 'auto_apply_no') {
      const userId = interaction.user.id;
      const autoApply = interaction.customId === 'auto_apply_yes';
      
      // Load current preferences
      const userPrefs = await loadUserPreferences();
      
      // Ensure user exists in preferences
      if (!userPrefs[userId]) {
        userPrefs[userId] = { times: [], autoApply: false };
      }
      
      // Update auto-apply setting
      userPrefs[userId].autoApply = autoApply;
      
      // Save preferences
      await saveUserPreferences(userPrefs);
      
      await interaction.reply({ 
        content: autoApply 
          ? 'Your settings will automatically be applied each day.' 
          : 'Your settings will only apply for today.',
        ephemeral: true 
      });
    }
  }
});

client.on('messageCreate', async message => {
  // Skip bot messages
  if (message.author.bot) return;
  
  // Handle !notifications commands
  if (message.content.startsWith('!notifications')) {
    const args = message.content.split(' ');
    const command = args[1];
    
    try {
      if (!command) {
        // Show help message
        const helpEmbed = new EmbedBuilder()
          .setTitle('🔔 ROMC MVP Notification Bot - Help')
          .setDescription('Available commands:')
          .addFields(
            { name: '`!notifications`', value: 'Show this help message', inline: false },
            { name: '`!notifications setting`', value: 'Open notification time selection menu', inline: false },
            { name: '`!notifications me`', value: 'Show your current notification times', inline: false },
            { name: '`!notifications @user`', value: 'Show notification times for mentioned user', inline: false }
          )
          .setColor('#5865F2')
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await message.reply({ embeds: [helpEmbed] });
        
      } else if (command === 'setting') {
        // Send notification selection menu
        await sendDailySelector(message.channel);
        await message.reply('Notification selection menu sent!');
        
      } else if (command === 'me') {
        // Show current user's notification times
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        const userSettings = userPrefs[userId];
        
        if (!userSettings || !userSettings.times || userSettings.times.length === 0) {
          await message.reply('❌ You have no notification times set. Use `!notifications setting` to configure them.');
          return;
        }
        
        const timesList = userSettings.times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        const userEmbed = new EmbedBuilder()
          .setTitle(`🔔 ${message.author.username}'s Notification Times`)
          .setDescription(`**Your scheduled times:**\n${timesList}\n\n**Auto-apply:** ${userSettings.autoApply ? '✅ Enabled' : '❌ Disabled'}\n\n**You'll receive:**\n• ⏰ 5-minute reminders\n• 🔔 Main notifications`)
          .setColor('#00FF00')
          .setThumbnail(message.author.displayAvatarURL());
        
        await message.reply({ embeds: [userEmbed] });
        
      } else if (message.mentions.users.size > 0) {
        // Show mentioned user's notification times
        const mentionedUser = message.mentions.users.first();
        const userPrefs = await loadUserPreferences();
        const userSettings = userPrefs[mentionedUser.id];
        
        if (!userSettings || !userSettings.times || userSettings.times.length === 0) {
          await message.reply(`❌ ${mentionedUser.username} has no notification times set.`);
          return;
        }
        
        const timesList = userSettings.times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        const mentionedUserEmbed = new EmbedBuilder()
          .setTitle(`🔔 ${mentionedUser.username}'s Notification Times`)
          .setDescription(`**Scheduled times:**\n${timesList}\n\n**Auto-apply:** ${userSettings.autoApply ? '✅ Enabled' : '❌ Disabled'}`)
          .setColor('#FFA500')
          .setThumbnail(mentionedUser.displayAvatarURL());
        
        await message.reply({ embeds: [mentionedUserEmbed] });
        
      } else {
        // Unknown command
        await message.reply('❌ Unknown command. Use `!notifications` to see available commands.');
      }
      
    } catch (err) {
      console.error('Error handling notifications command:', err);
      await message.reply('❌ An error occurred while processing your command.');
    }
  }
});

// Login to Discord
client.login(process.env.BOT_TOKEN); 