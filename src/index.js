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

// Initialize user preferences with default values
function initUserPreferences(userId, userPrefs) {
  if (!userPrefs[userId]) {
    userPrefs[userId] = { 
      times: [],          // Selected notification times
      autoApply: false,   // Whether to apply preferences automatically each day
      paused: false,      // Whether notifications are temporarily paused
      scheduledJobs: [],  // IDs of active scheduled jobs
      lastSetupMessageId: null  // ID of the last setup message sent
    };
  }
  return userPrefs[userId];
}

// Create notification select menu
function createNotificationMenu(selectedTimes = [], autoApply = false) {
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('notification_times')
        .setPlaceholder(selectedTimes.length > 0 
          ? `Modify your ${selectedTimes.length} selected time(s)` 
          : 'Select notification times')
        .setMinValues(0)
        .setMaxValues(NOTIFICATION_TIMES.length)
        .addOptions(NOTIFICATION_TIMES.map(time => ({
          label: time.label,
          value: time.value,
          description: `Get notified at ${time.label}`,
          default: selectedTimes.includes(time.value)
        })))
    );
  
  const autoApplyRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('auto_apply_yes')
        .setLabel('Save as default times')
        .setStyle(autoApply ? ButtonStyle.Primary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('auto_apply_no')
        .setLabel('One-time only')
        .setStyle(!autoApply ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  
  return [row, autoApplyRow];
}

// Send daily notification selector
async function sendDailySelector(channel, userId = null) {
  try {
    // Default to empty selection
    let selectedTimes = [];
    let autoApply = false;
    
    // If userId is provided, try to delete the previous setup message and get selected times
    if (userId) {
      const userPrefs = await loadUserPreferences();
      
      // Initialize user if they don't exist
      if (!userPrefs[userId]) {
        userPrefs[userId] = initUserPreferences(userId, userPrefs);
      } else if (userPrefs[userId].times) {
        // Get the user's current selected times
        selectedTimes = userPrefs[userId].times;
        autoApply = userPrefs[userId].autoApply;
      }
      
      // Check for previous setup message and delete it
      if (userPrefs[userId].lastSetupMessageId) {
        try {
          const previousMessage = await channel.messages.fetch(userPrefs[userId].lastSetupMessageId);
          if (previousMessage) {
            await previousMessage.delete().catch(err => console.error(`Error deleting previous setup message: ${err}`));
          }
        } catch (err) {
          // Message might not exist anymore, just continue
          console.log(`Could not find previous setup message to delete: ${err}`);
        }
      }
    }
    
    let embedDescription = 'Select the times you want to be notified.\n\n';
    
    if (selectedTimes.length > 0) {
      const timeLabels = selectedTimes.map(timeValue => {
        const time = NOTIFICATION_TIMES.find(t => t.value === timeValue);
        return time ? `• ${time.label}` : `• ${timeValue}`;
      }).join('\n');
      
      embedDescription += `**Your Current Notifications:**\n${timeLabels}\n\n`;
      
      // Show auto-apply preference if available
      if (userId && userPrefs[userId]) {
        embedDescription += `**Settings:**\n`;
        embedDescription += `• ${userPrefs[userId].autoApply ? '✅ Saved as default times' : '⏱️ One-time only'}\n`;
        embedDescription += `• ${userPrefs[userId].paused ? '⏸️ Notifications paused' : '▶️ Notifications active'}\n\n`;
      }
    }
    
    embedDescription += 'You can choose to save these as your default times or use them just for today.\n\nYour selections will be private and notifications will be sent only to you.';
    
    const embed = new EmbedBuilder()
      .setTitle('🔔 ROMC MVP Notification Times')
      .setDescription(embedDescription)
      .setColor('#5865F2');

    const sentMessage = await channel.send({
      embeds: [embed],
      components: createNotificationMenu(selectedTimes, autoApply)
    });
    
    // If userId is provided, update the user's lastSetupMessageId
    if (userId) {
      const userPrefs = await loadUserPreferences();
      if (userPrefs[userId]) {
        userPrefs[userId].lastSetupMessageId = sentMessage.id;
        await saveUserPreferences(userPrefs);
      }
    }
    
    return sentMessage;
  } catch (err) {
    console.error(`Error in sendDailySelector: ${err}`);
    return null;
  }
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
          // Skip if user has paused notifications
          if (prefs.paused) return;
          
          const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
          if (channel) {
            const user = await client.users.fetch(userId);
            if (user) {
              try {
                await user.send(`⏰ **5-minute reminder**: Your notification for ${timeInfo.label} is coming up soon!`);
              } catch (dmErr) {
                // If DM fails, fall back to channel message that only mentions the user
                channel.send(`<@${userId}> ⏰ **5-minute reminder**: Your notification for ${timeInfo.label} is coming up soon!`);
              }
            }
          }
        } catch (err) {
          console.error(`Error sending early warning to user ${userId}:`, err);
        }
      });
      
      // Schedule main notification
      const mainJob = cron.schedule(timeInfo.cronTime, async () => {
        try {
          // Skip if user has paused notifications
          if (prefs.paused) return;
          
          const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
          if (channel) {
            const user = await client.users.fetch(userId);
            if (user) {
              try {
                await user.send(`🔔 **Time's up!** This is your notification for ${timeInfo.label}`);
              } catch (dmErr) {
                // If DM fails, fall back to channel message that only mentions the user
                channel.send(`<@${userId}> 🔔 **Time's up!** This is your notification for ${timeInfo.label}`);
              }
            }
          }
        } catch (err) {
          console.error(`Error sending notification to user ${userId}:`, err);
        }
      });
      
      // If notifications are paused, stop the job immediately
      if (prefs.paused) {
        if (earlyWarningJob && typeof earlyWarningJob.stop === 'function') {
          earlyWarningJob.stop();
        }
        if (mainJob && typeof mainJob.stop === 'function') {
          mainJob.stop();
        }
      }
      
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
        
        // Send daily selection message (no userId since it's not tied to a specific user)
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
        // Keep their preferences the same, just maintain their current paused state
        updated = true;
      } else {
        // Reset preferences for users who didn't opt in, but maintain their paused state
        const wasPaused = prefs.paused; // Remember paused state
        if (prefs.times && prefs.times.length > 0) {
          prefs.times = [];
          updated = true;
          prefs.paused = wasPaused; // Restore paused state
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
      userPrefs[userId] = initUserPreferences(userId, userPrefs);
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
          .setLabel('Save as default times')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('auto_apply_no')
          .setLabel('One-time only')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Create the embed with the user's selections
    const updatedEmbed = new EmbedBuilder()
      .setTitle('🔔 Notification Times')
      .setDescription(`✅ **Selection Menu**\n\nSelect your notification times using the dropdown below.`)
      .setColor('#5865F2');
    
    // Update the original message with a generic notice
    await interaction.update({
      embeds: [updatedEmbed],
      components: [disabledRow, autoApplyRow]
    });
    
    // Send a detailed selection confirmation as ephemeral message to the user
    const timesList = selectedTimes.map(t => {
      const time = NOTIFICATION_TIMES.find(nt => nt.value === t);
      return `• ${time ? time.label : t}`;
    }).join('\n');
    
    const userConfirmationEmbed = new EmbedBuilder()
      .setTitle(`🔔 Your Notification Times`)
      .setDescription(`**Your selected times:**\n${timesList}\n\n**You'll receive:**\n• ⏰ 5-minute reminders\n• 🔔 Main notifications\n\nSelect either "Save as default times" or "One-time only" in the channel.`)
      .setColor('#00FF00')
      .setFooter({ text: 'ROMC MVP Notification System' });
    
    await interaction.followUp({ 
      embeds: [userConfirmationEmbed],
      ephemeral: true 
    });

    // Set a timeout to delete the message if no button is clicked
    // Store the timeout ID in a global object so it can be cancelled if a button is clicked
    const messageTimeouts = activeJobs.messageTimeouts || (activeJobs.messageTimeouts = {});
    const messageId = interaction.message.id;
    messageTimeouts[messageId] = setTimeout(async () => {
      try {
        // Try to fetch and delete the message
        const channel = interaction.message.channel;
        const message = await channel.messages.fetch(messageId);
        if (message && message.deletable) {
          await message.delete();
        }
        // Clean up the timeout reference
        delete messageTimeouts[messageId];
      } catch (err) {
        console.error(`Error auto-deleting setup message: ${err}`);
      }
    }, 60000); // Delete after 1 minute if no button is clicked
  }
  
  // Handle button interactions for auto-apply
  if (interaction.isButton()) {
    if (interaction.customId === 'auto_apply_yes' || interaction.customId === 'auto_apply_no') {
      const userId = interaction.user.id;
      const autoApply = interaction.customId === 'auto_apply_yes';
      
      // Clear any auto-delete timeout for this message
      const messageTimeouts = activeJobs.messageTimeouts || {};
      const messageId = interaction.message.id;
      if (messageTimeouts[messageId]) {
        clearTimeout(messageTimeouts[messageId]);
        delete messageTimeouts[messageId];
      }
      
      // Load current preferences
      const userPrefs = await loadUserPreferences();
      
      // Ensure user exists in preferences
      if (!userPrefs[userId]) {
        userPrefs[userId] = initUserPreferences(userId, userPrefs);
      }
      
      // Update auto-apply setting
      userPrefs[userId].autoApply = autoApply;
      
      // Save preferences
      await saveUserPreferences(userPrefs);
      
      await interaction.reply({ 
        content: autoApply 
          ? 'Your notification settings have been saved as your default times. They will be automatically applied each day.' 
          : 'Your notification settings will only apply for today and will be reset tomorrow.',
        ephemeral: true 
      });
      
      // Delete the setup message after a short delay to allow the user to see the confirmation
      setTimeout(async () => {
        try {
          if (interaction.message && interaction.message.deletable) {
            await interaction.message.delete();
          }
        } catch (err) {
          console.error(`Error deleting message after selection: ${err}`);
        }
      }, 5000); // Delete after 5 seconds
    }
  }
});

client.on('messageCreate', async message => {
  // Skip bot messages
  if (message.author.bot) return;
  
  // Handle !romc-mvp commands (changed from !notifications)
  if (message.content.startsWith('!romc-mvp')) {
    const args = message.content.split(' ');
    const command = args[1];
    
    try {
      if (!command) {
        // Show help message
        const helpEmbed = new EmbedBuilder()
          .setTitle('🔔 ROMC MVP Notification Bot - Help')
          .setDescription('Available commands:')
          .addFields(
            { name: '`!romc-mvp`', value: 'Show this help message', inline: false },
            { name: '`!romc-mvp setup`', value: 'Open notification time selection menu', inline: false },
            { name: '`!romc-mvp me`', value: 'Show your current notification times', inline: false },
            { name: '`!romc-mvp schedule`', value: 'Preview upcoming MVP times', inline: false },
            { name: '`!romc-mvp stop`', value: 'Clear times and stop all notifications', inline: false },
            { name: '`!romc-mvp pause`', value: 'Temporarily disable notifications', inline: false },
            { name: '`!romc-mvp resume`', value: 'Re-enable paused notifications', inline: false },
            { name: '`!romc-mvp @user`', value: 'Show notification times for mentioned user', inline: false }
          )
          .setColor('#5865F2')
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await message.reply({ embeds: [helpEmbed] });
        
      } else if (command === 'setup' || command === 'setting') {
        // Send notification selection menu
        await sendDailySelector(message.channel, message.author.id);
        
        // Delete the command message to keep the channel clean
        await message.delete().catch(err => console.error(`Error deleting command message: ${err}`));
        
      } else if (command === 'me') {
        // Show current user's notification times
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        
        // Initialize user if they don't exist yet
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
          await saveUserPreferences(userPrefs);
        }
        
        const userSettings = userPrefs[userId];
        
        if (!userSettings.times || userSettings.times.length === 0) {
          await message.reply('❌ You have no notification times set. Use `!romc-mvp setup` to configure them.');
          return;
        }
        
        const timesList = userSettings.times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        const userEmbed = new EmbedBuilder()
          .setTitle(`🔔 ${message.author.username}'s Notification Times`)
          .setDescription(`**Your scheduled times:**\n${timesList}\n\n**Auto-apply:** ${userSettings.autoApply ? '✅ Enabled' : '❌ Disabled'}\n**Status:** ${userSettings.paused ? '⏸️ Paused' : '▶️ Active'}\n\n**You'll receive:**\n• ⏰ 5-minute reminders\n• 🔔 Main notifications`)
          .setColor('#00FF00')
          .setThumbnail(message.author.displayAvatarURL());
        
        await message.reply({ embeds: [userEmbed] });
        
      } else if (command === 'schedule') {
        // Show upcoming MVP times
        const currentTime = new Date();
        const currentHour = currentTime.getHours();
        const currentMinute = currentTime.getMinutes();
        
        // Sort times by how soon they'll occur
        const sortedTimes = [...NOTIFICATION_TIMES].sort((a, b) => {
          const [aHour, aMinute] = a.value.split(':').map(Number);
          const [bHour, bMinute] = b.value.split(':').map(Number);
          
          // Convert to minutes since midnight for easier comparison
          let aMinSinceMidnight = aHour * 60 + aMinute;
          let bMinSinceMidnight = bHour * 60 + bMinute;
          let currentMinSinceMidnight = currentHour * 60 + currentMinute;
          
          // Calculate minutes until each time occurs
          let aMinUntil = aMinSinceMidnight - currentMinSinceMidnight;
          let bMinUntil = bMinSinceMidnight - currentMinSinceMidnight;
          
          // If the time has passed today, it will happen tomorrow (add 24 hours)
          if (aMinUntil <= 0) aMinUntil += 24 * 60;
          if (bMinUntil <= 0) bMinUntil += 24 * 60;
          
          return aMinUntil - bMinUntil;
        });
        
        // Get the next 5 times
        const upcomingTimes = sortedTimes.slice(0, 5);
        const timesList = upcomingTimes.map(time => {
          const [hour, minute] = time.value.split(':').map(Number);
          let timeUntil = (hour * 60 + minute) - (currentHour * 60 + currentMinute);
          if (timeUntil <= 0) timeUntil += 24 * 60; // If it's tomorrow
          
          const hoursUntil = Math.floor(timeUntil / 60);
          const minutesUntil = timeUntil % 60;
          
          return `• ${time.label} (in ${hoursUntil}h ${minutesUntil}m)`;
        }).join('\n');
        
        const scheduleEmbed = new EmbedBuilder()
          .setTitle('🕒 Upcoming MVP Times')
          .setDescription(`**Next 5 MVP times:**\n${timesList}`)
          .setColor('#5865F2')
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await message.reply({ embeds: [scheduleEmbed] });
        
      } else if (command === 'stop') {
        // Clear times and stop all notifications
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
        } else {
          userPrefs[userId].times = [];
          userPrefs[userId].autoApply = false;
          userPrefs[userId].paused = false;
          
          // Clear any scheduled jobs
          if (userPrefs[userId].scheduledJobs) {
            userPrefs[userId].scheduledJobs.forEach(jobId => {
              const job = activeJobs[jobId];
              if (job && typeof job.cancel === 'function') {
                job.cancel();
                delete activeJobs[jobId];
              }
            });
            userPrefs[userId].scheduledJobs = [];
          }
        }
        
        // Save preferences
        await saveUserPreferences(userPrefs);
        
        const stopEmbed = new EmbedBuilder()
          .setTitle('🛑 Notifications Stopped')
          .setDescription('All your notification times have been cleared and notifications have been stopped.')
          .setColor('#FF0000');
        
        await message.reply({ embeds: [stopEmbed] });
        
      } else if (command === 'pause') {
        // Temporarily disable notifications
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        
        // Initialize user if they don't exist yet
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
        }
        
        if (!userPrefs[userId].times || userPrefs[userId].times.length === 0) {
          await message.reply('❌ You have no notification times set. Use `!romc-mvp setup` to configure them.');
          return;
        }
        
        userPrefs[userId].paused = true;
        
        // Save preferences
        await saveUserPreferences(userPrefs);
        
        // Pause any active jobs
        if (userPrefs[userId].scheduledJobs) {
          userPrefs[userId].scheduledJobs.forEach(jobId => {
            const job = activeJobs[jobId];
            if (job && typeof job.stop === 'function') {
              job.stop();
            }
          });
        }
        
        const pauseEmbed = new EmbedBuilder()
          .setTitle('⏸️ Notifications Paused')
          .setDescription('Your notifications have been temporarily paused. Use `!romc-mvp resume` to resume them.')
          .setColor('#FFA500');
        
        await message.reply({ embeds: [pauseEmbed] });
        
      } else if (command === 'resume') {
        // Re-enable paused notifications
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        
        // Initialize user if they don't exist yet
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
        }
        
        if (!userPrefs[userId].times || userPrefs[userId].times.length === 0) {
          await message.reply('❌ You have no notification times set. Use `!romc-mvp setup` to configure them.');
          return;
        }
        
        if (!userPrefs[userId].paused) {
          await message.reply('ℹ️ Your notifications are already active.');
          return;
        }
        
        userPrefs[userId].paused = false;
        
        // Save preferences
        await saveUserPreferences(userPrefs);
        
        // Resume any paused jobs
        if (userPrefs[userId].scheduledJobs) {
          userPrefs[userId].scheduledJobs.forEach(jobId => {
            const job = activeJobs[jobId];
            if (job && typeof job.start === 'function') {
              job.start();
            }
          });
        }
        
        const resumeEmbed = new EmbedBuilder()
          .setTitle('▶️ Notifications Resumed')
          .setDescription('Your notifications have been resumed.')
          .setColor('#00FF00');
        
        await message.reply({ embeds: [resumeEmbed] });
        
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
          .setDescription(`**Scheduled times:**\n${timesList}\n\n**Auto-apply:** ${userSettings.autoApply ? '✅ Enabled' : '❌ Disabled'}\n**Status:** ${userSettings.paused ? '⏸️ Paused' : '▶️ Active'}`)
          .setColor('#FFA500')
          .setThumbnail(mentionedUser.displayAvatarURL());
        
        await message.reply({ embeds: [mentionedUserEmbed] });
        
      } else {
        // Unknown command
        await message.reply('❌ Unknown command. Use `!romc-mvp` to see available commands.');
      }
      
    } catch (err) {
      console.error('Error handling notifications command:', err);
      await message.reply('❌ An error occurred while processing your command.');
    }
  }
});

// Login to Discord
client.login(process.env.BOT_TOKEN); 