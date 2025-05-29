require('dotenv').config();

// Check if essential environment variables are disabled
const isBotDisabled = process.env.BOT_TOKEN === 'DISABLED';
const isChannelDisabled = process.env.NOTIFICATION_CHANNEL_ID === 'DISABLED';
const isTestMode = process.env.TEST_MODE === 'true' || process.argv.includes('--test');

// Set default timezone if not defined in environment variables
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Asia/Bangkok';

// Log test mode status
if (isTestMode) {
  console.log('🧪 Running bot in TEST MODE - notifications can be triggered manually');
}

if (isBotDisabled) {
  console.log('Bot is disabled (BOT_TOKEN=DISABLED). Exiting...');
  process.exit(0);
}

if (isChannelDisabled) {
  console.log('Notifications disabled (NOTIFICATION_CHANNEL_ID=DISABLED). Exiting...');
  process.exit(0);
}

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
// For timezone handling
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Initialize dayjs plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// Database path for storing user preferences
const DB_PATH = path.join(__dirname, '..', 'data');
const USER_PREFS_FILE = path.join(DB_PATH, 'user_preferences.json');

// Track active scheduled jobs
let activeJobs = {};

// Debounce mechanism for setupNotifications
let setupNotificationsTimeout = null;

// Function to clear all active jobs globally
function clearAllActiveJobs() {
  console.log(`🧹 Clearing all active jobs. Current count: ${Object.keys(activeJobs).length}`);
  
  Object.entries(activeJobs).forEach(([jobId, job]) => {
    try {
      if (job && typeof job.cancel === 'function') {
        job.cancel();
        console.log(`   🗑️ Cancelled job: ${jobId}`);
      } else if (job && typeof job.destroy === 'function') {
        job.destroy();
        console.log(`   🗑️ Destroyed job: ${jobId}`);
      }
    } catch (err) {
      console.error(`   ❌ Error cancelling job ${jobId}:`, err);
    }
  });
  
  // Clear the activeJobs object by removing all properties
  Object.keys(activeJobs).forEach(key => delete activeJobs[key]);
  console.log(`✅ All jobs cleared. Active jobs count: ${Object.keys(activeJobs).length}`);
}

// Debounced version of setupNotifications to prevent rapid successive calls
async function setupNotificationsDebounced() {
  // Clear any existing timeout
  if (setupNotificationsTimeout) {
    clearTimeout(setupNotificationsTimeout);
  }
  
  // Set a new timeout to call setupNotifications after a short delay
  setupNotificationsTimeout = setTimeout(async () => {
    await setupNotifications();
    setupNotificationsTimeout = null;
  }, 100); // 100ms delay to prevent rapid successive calls
}

// Define notification times from the image
const NOTIFICATION_TIMES = [
  { label: '00:00', value: '00:00', earlyWarningCron: '55 23 * * *' },
  { label: '01:30', value: '01:30', earlyWarningCron: '25 1 * * *' },
  { label: '03:00', value: '03:00', earlyWarningCron: '55 2 * * *' },
  { label: '04:30', value: '04:30', earlyWarningCron: '25 4 * * *' },
  { label: '06:00', value: '06:00', earlyWarningCron: '55 5 * * *' },
  { label: '07:30', value: '07:30', earlyWarningCron: '25 7 * * *' },
  { label: '09:00', value: '09:00', earlyWarningCron: '55 8 * * *' },
  { label: '10:30', value: '10:30', earlyWarningCron: '25 10 * * *' },
  { label: '12:00', value: '12:00', earlyWarningCron: '55 11 * * *' },
  { label: '13:30', value: '13:30', earlyWarningCron: '25 13 * * *' },
  { label: '15:00', value: '15:00', earlyWarningCron: '55 14 * * *' },
  { label: '16:30', value: '16:30', earlyWarningCron: '25 16 * * *' },
  { label: '18:00', value: '18:00', earlyWarningCron: '55 17 * * *' },
  { label: '19:30', value: '19:30', earlyWarningCron: '25 19 * * *' },
  { label: '21:00', value: '21:00', earlyWarningCron: '55 20 * * *' },
  { label: '22:30', value: '22:30', earlyWarningCron: '25 22 * * *' },
];

// List of common timezones for selection menu
const COMMON_TIMEZONES = [
  { label: 'Asia/Bangkok (ICT)', value: 'Asia/Bangkok' },
  { label: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
  { label: 'Europe/London (GMT/BST)', value: 'Europe/London' },
  { label: 'America/New_York (EST/EDT)', value: 'America/New_York' },
  { label: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
  { label: 'Australia/Sydney (AEST/AEDT)', value: 'Australia/Sydney' },
  { label: 'Asia/Singapore (SGT)', value: 'Asia/Singapore' },
  { label: 'Asia/Seoul (KST)', value: 'Asia/Seoul' },
  { label: 'Europe/Paris (CET/CEST)', value: 'Europe/Paris' },
  { label: 'UTC', value: 'UTC' }
];

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
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
      lastSetupMessageId: null,  // ID of the last setup message sent
      timezone: DEFAULT_TIMEZONE  // Default timezone
    };
  }
  return userPrefs[userId];
}

// Function to send a notification to a user
async function sendNotificationToUser(userId, timeLabel) {
  try {
    console.log(`📤 Attempting to send notification to user ${userId} for ${timeLabel}`);
    console.log(`🔍 Environment check - NOTIFICATION_CHANNEL_ID: ${process.env.NOTIFICATION_CHANNEL_ID}`);
    console.log(`🔍 Environment check - BOT_TOKEN exists: ${!!process.env.BOT_TOKEN}`);
    console.log(`🔍 Client ready state: ${client.readyAt ? 'Ready' : 'Not ready'}`);
    
    const userPrefs = await loadUserPreferences();
    console.log(`📋 User preferences loaded for ${userId}: ${JSON.stringify(userPrefs[userId] || 'No preferences found')}`);
    
    // Skip if user has paused notifications
    if (userPrefs[userId]?.paused) {
      console.log(`⏸️ Skipping notification for user ${userId} - notifications are paused`);
      return;
    }
    
    console.log(`🔍 Fetching channel ${process.env.NOTIFICATION_CHANNEL_ID}`);
    const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
    if (channel) {
      console.log(`✅ Channel found: ${channel.name} (${channel.id}) - Type: ${channel.type}`);
      console.log(`🔍 Channel permissions - Can send messages: ${channel.permissionsFor(client.user)?.has('SendMessages')}`);
      
      // Get user's timezone for display
      const userTimezone = userPrefs[userId]?.timezone || DEFAULT_TIMEZONE;
      const currentTime = dayjs().tz(userTimezone).format('HH:mm');
      console.log(`🌐 User timezone: ${userTimezone}, Current time: ${currentTime}`);
      
      // Convert the MVP time from Bangkok timezone to user's timezone
      // Extract the time from timeLabel (e.g., "18:00" -> "18:00")
      const timeMatch = timeLabel.match(/(\d{2}:\d{2})/);
      let mvpTimeInUserTz = timeLabel; // fallback to original label
      
      if (timeMatch) {
        const [hours, minutes] = timeMatch[1].split(':').map(Number);
        console.log(`🕐 Extracted time from label: ${hours}:${minutes}`);
        // Create time in Bangkok timezone
        const localTime = dayjs.tz(dayjs().format('YYYY-MM-DD'), DEFAULT_TIMEZONE).hour(hours).minute(minutes);
        // Convert to user's timezone
        const userTime = localTime.tz(userTimezone);
        mvpTimeInUserTz = userTime.format('HH:mm');
        console.log(`🔄 Time conversion: ${localTime.format('HH:mm')} (${DEFAULT_TIMEZONE}) → ${userTime.format('HH:mm')} (${userTimezone})`);
      }
      
      // Always send message to channel with user mention
      const message = `<@${userId}>\n⏰ **5-Minute Warning**: MVP will spawn at ${mvpTimeInUserTz}! Get ready!\n(Your local time: ${currentTime} - ${userTimezone})`;
      
      console.log(`📝 Sending message: ${message.substring(0, 100)}...`);
      console.log(`📝 Full message length: ${message.length} characters`);
      
      const sentMessage = await channel.send(message);
      console.log(`✅ Notification sent successfully! Message ID: ${sentMessage.id}`);
      console.log(`✅ Message URL: https://discord.com/channels/${channel.guild?.id || '@me'}/${channel.id}/${sentMessage.id}`);
    } else {
      console.error(`❌ Channel not found: ${process.env.NOTIFICATION_CHANNEL_ID}`);
      console.error(`❌ Available channels: ${client.channels.cache.map(c => `${c.name} (${c.id})`).join(', ')}`);
    }
  } catch (err) {
    console.error(`❌ Error sending notification to user ${userId}:`, err);
    console.error(`   Error details:`, {
      name: err.name,
      message: err.message,
      code: err.code,
      status: err.status,
      stack: err.stack?.split('\n').slice(0, 5).join('\n')
    });
    
    // Additional debugging for common Discord API errors
    if (err.code === 50013) {
      console.error(`❌ Missing permissions to send messages in channel ${process.env.NOTIFICATION_CHANNEL_ID}`);
    } else if (err.code === 10003) {
      console.error(`❌ Channel ${process.env.NOTIFICATION_CHANNEL_ID} not found or bot doesn't have access`);
    } else if (err.code === 50001) {
      console.error(`❌ Bot missing access to channel ${process.env.NOTIFICATION_CHANNEL_ID}`);
    }
  }
}

// Create notification select menu
function createNotificationMenu(selectedTimes = [], autoApply = false) {
  // Discord has a limit of 25 options per select menu
  const maxOptionsPerMenu = 25;
  const maxSelectableValues = Math.min(25, NOTIFICATION_TIMES.length);
  
  // Split notification times into chunks if needed
  const timeChunks = [];
  for (let i = 0; i < NOTIFICATION_TIMES.length; i += maxOptionsPerMenu) {
    timeChunks.push(NOTIFICATION_TIMES.slice(i, i + maxOptionsPerMenu));
  }
  
  const rows = [];
  
  // Create select menus for each chunk
  timeChunks.forEach((chunk, index) => {
    const customId = timeChunks.length > 1 ? `notification_times_${index}` : 'notification_times';
    const placeholder = timeChunks.length > 1 
      ? `Select notification times (Set ${index + 1}/${timeChunks.length})`
      : (selectedTimes.length > 0 
        ? `Edit ${selectedTimes.length} selected times` 
        : 'Select notification times');
    
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder(placeholder)
          .setMinValues(0)
          .setMaxValues(Math.min(chunk.length, maxSelectableValues))
          .addOptions(chunk.map(time => {
            const isSelected = selectedTimes.includes(time.value);
            return {
              label: isSelected ? `✓ ${time.label}` : time.label,
              value: time.value,
              description: `Get notified at ${time.label}`,
              default: isSelected
            };
          }))
      );
    
    rows.push(row);
  });
  
  const autoApplyRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('auto_apply_yes')
        .setLabel('Save as default')
        .setStyle(autoApply ? ButtonStyle.Primary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('auto_apply_no')
        .setLabel('One-time only')
        .setStyle(!autoApply ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  
  rows.push(autoApplyRow);
  
  return rows;
}

// Create timezone selection menu
function createTimezoneMenu(selectedTimezone = DEFAULT_TIMEZONE) {
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('timezone_select')
        .setPlaceholder(`Select timezone (Current: ${selectedTimezone})`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(COMMON_TIMEZONES.map(tz => {
          return {
            label: tz.label,
            value: tz.value,
            description: `Set timezone to ${tz.value}`,
            default: tz.value === selectedTimezone
          };
        }))
    );
  
  return [row];
}

// Send daily notification selector
async function sendDailySelector(channel, userId = null, isEditing = false) {
  try {
    // Default to empty selection
    let selectedTimes = [];
    let autoApply = false;
    let userTimezone = DEFAULT_TIMEZONE;
    
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
        userTimezone = userPrefs[userId].timezone || DEFAULT_TIMEZONE;
      }
      // console.log(userPrefs[userId], userPrefs[userId].lastSetupMessageId);
      
      // Check for previous setup message and delete it
      if (userPrefs[userId].lastSetupMessageId) {
        try {
          const previousMessage = await channel.messages.fetch(userPrefs[userId].lastSetupMessageId)
            .catch(err => {
              console.log(`Could not fetch previous setup message: ${err.message}`);
              return null;
            });
          
          if (previousMessage && previousMessage.deletable) {
            await previousMessage.delete().catch(err => {
              console.log(`Could not delete previous setup message: ${err.message}`);
              // Continue execution even if delete fails
            });
          }
        } catch (err) {
          // Message might not exist anymore, just continue
          console.log(`Error handling previous setup message: ${err.message}`);
          // Don't stop execution due to this error
        }
      }
    }
    
    let embedDescription = isEditing 
      ? 'Edit MVP notification times below. ✓ indicates already selected times\n\n'
      : 'Please select the times you want to receive MVP notifications\n\n';
    
    if (selectedTimes.length > 0) {
      const timeLabels = selectedTimes.map(timeValue => {
        const time = NOTIFICATION_TIMES.find(t => t.value === timeValue);
        return time ? `• ${time.label}` : `• ${timeValue}`;
      }).join('\n');
      
      embedDescription += `**Your selected notification times:**\n${timeLabels}\n\n`;
      
      // Show auto-apply preference if available
      if (userId && userPrefs[userId]) {
        embedDescription += `**Your settings:**\n`;
        embedDescription += `• ${userPrefs[userId].autoApply ? '✅ Use as default times' : '⏱️ One-time notification only'}\n`;
        embedDescription += `• ${userPrefs[userId].paused ? '⏸️ Notifications paused' : '▶️ Notifications active'}\n`;
        embedDescription += `• 🌐 Timezone: ${userPrefs[userId].timezone || DEFAULT_TIMEZONE}\n\n`;
      }
    }
    
    embedDescription += 'You can save these times as default or use them for today only\n\nYour settings are private and notifications will be sent only to you';
    
    const embed = new EmbedBuilder()
      .setTitle(isEditing ? '🔄 Edit MVP Notification Times - ROMC' : '🔔 Set MVP Notification Times - ROMC')
      .setDescription(embedDescription)
      .setColor('#5865F2');

    const sentMessage = await channel.send({
      embeds: [embed],
      components: createNotificationMenu(selectedTimes, autoApply)
    }).catch(err => {
      console.error(`Error sending selector message: ${err}`);
      return null;
    });
    
    if (!sentMessage) {
      console.error(`Failed to send setup message for user ${userId}`);
      return null;
    }
    
    // If userId is provided, update the user's lastSetupMessageId
    if (userId) {
      try {
        const userPrefs = await loadUserPreferences();
        if (userPrefs[userId]) {
          userPrefs[userId].lastSetupMessageId = sentMessage.id;
          await saveUserPreferences(userPrefs);
        }
      } catch (err) {
        console.error(`Error updating user preferences with new setup message ID: ${err}`);
        // Continue execution even if this fails
      }
    }
    
    return sentMessage;
  } catch (err) {
    console.error(`Error in sendDailySelector: ${err}`);
    return null;
  }
}

// Send timezone selector menu
async function sendTimezoneSelector(channel, userId) {
  try {
    const userPrefs = await loadUserPreferences();
    
    // Initialize user if they don't exist
    if (!userPrefs[userId]) {
      userPrefs[userId] = initUserPreferences(userId, userPrefs);
      await saveUserPreferences(userPrefs);
    }
    
    const userTimezone = userPrefs[userId].timezone || DEFAULT_TIMEZONE;
    const currentTime = dayjs().tz(userTimezone).format('HH:mm');
    
    const embed = new EmbedBuilder()
      .setTitle('🌐 Set Timezone - ROMC MVP Notification')
      .setDescription(`Please select the timezone you want to use for notifications\n\n**Your current timezone:** ${userTimezone}\n**Your local time:** ${currentTime}\n\nSetting your timezone will help you receive notifications at the correct time for your location`)
      .setColor('#5865F2');
    
    const sentMessage = await channel.send({
      embeds: [embed],
      components: createTimezoneMenu(userTimezone)
    });
    
    return sentMessage;
  } catch (err) {
    console.error(`Error sending timezone selector: ${err}`);
    return null;
  }
}

// Set up notification schedules
async function setupNotifications() {
  try {
    // Clear ALL existing jobs first to prevent duplicates
    clearAllActiveJobs();
    
    const userPrefs = await loadUserPreferences();
    
    console.log('🔧 Setting up notifications...');
    console.log(`📊 Server timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`🕐 Server UTC time: ${dayjs().utc().format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`🕐 Server local time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`👥 Total users in preferences: ${Object.keys(userPrefs).length}`);
    
    let totalScheduledJobs = 0;
    
    // Schedule notifications for each user and their selected times
    Object.entries(userPrefs).forEach(([userId, prefs]) => {
    if (!prefs.times || !prefs.times.length) {
      console.log(`⏭️ Skipping user ${userId} - no notification times set`);
      return;
    }
    
    console.log(`👤 Setting up notifications for user ${userId}:`);
    console.log(`   📅 Selected times: ${prefs.times.join(', ')}`);
    console.log(`   🌐 User timezone: ${prefs.timezone || DEFAULT_TIMEZONE}`);
    console.log(`   ⏸️ Paused: ${prefs.paused}`);
    
    // Clear the user's scheduled jobs array since we cleared all jobs globally
    prefs.scheduledJobs = [];
    
    // Get user's timezone or use default
    const userTimezone = prefs.timezone || DEFAULT_TIMEZONE;
    
    // Schedule new notifications
    prefs.times.forEach(timeValue => {
      const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
      if (!timeInfo) {
        console.log(`   ❌ Time info not found for: ${timeValue}`);
        return;
      }
      
      // Use original Bangkok time cron expression since we're specifying user timezone in cron options
      const originalCron = timeInfo.earlyWarningCron;
      
      console.log(`   ⏰ Setting up notification for ${timeInfo.label}:`);
      console.log(`      Bangkok time cron: ${originalCron}`);
      console.log(`      Will run in timezone: ${userTimezone}`);
      
      // Schedule 5-minute early warning only
      const earlyWarningJob = cron.schedule(originalCron, async () => {
        console.log(`🔔 Triggering notification for user ${userId} at ${timeInfo.label}`);
        console.log(`   🕐 Current server time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`   🌐 User timezone: ${userTimezone}`);
        console.log(`   🕐 User local time: ${dayjs().tz(userTimezone).format('YYYY-MM-DD HH:mm:ss')}`);
        await sendNotificationToUser(userId, timeInfo.label);
      }, {
        scheduled: true,
        timezone: userTimezone // Use user's timezone instead of forcing UTC
      });
      
      // If notifications are paused, stop the job immediately
      if (prefs.paused) {
        if (earlyWarningJob && typeof earlyWarningJob.stop === 'function') {
          earlyWarningJob.stop();
          console.log(`   ⏸️ Job paused for ${timeInfo.label}`);
        }
      } else {
        console.log(`   ✅ Job scheduled for ${timeInfo.label}`);
        totalScheduledJobs++;
      }
      
      // Store job ID for future reference
      if (earlyWarningJob) {
        const earlyJobId = `${userId}_${timeValue}_early`;
        prefs.scheduledJobs.push(earlyJobId);
        activeJobs[earlyJobId] = earlyWarningJob;
      }
    });
  });
  
  console.log(`✅ Notification setup complete. Total active jobs: ${totalScheduledJobs}`);
  console.log(`📋 Active job IDs: ${Object.keys(activeJobs).join(', ')}`);
  
  // Save updated preferences
  await saveUserPreferences(userPrefs);
  } catch (err) {
    console.error('Error setting up notifications:', err);
  }
}

// Test notification function
async function testNotification(userId, timeValue, channel) {
  try {
    const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
    if (!timeInfo) {
      await channel.send(`❌ Time not found: ${timeValue}. Please select a valid time from the list`);
      return false;
    }

    // Send early warning notification
    await sendNotificationToUser(userId, timeInfo.label);
    
    return true;
  } catch (err) {
    console.error('Error testing notification:', err);
    await channel.send(`❌ Error occurred while testing notification: ${err.message}`);
    return false;
  }
}

// Schedule the daily 8 AM message
function scheduleDailyMessage() {
  if (isChannelDisabled) {
    console.log('Daily message scheduling disabled (NOTIFICATION_CHANNEL_ID=DISABLED)');
    return;
  }

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
  }, {
    timezone: DEFAULT_TIMEZONE // Use default timezone (Bangkok) instead of server timezone
  });

  // In test mode, also show a notification that daily messages are scheduled
  if (isTestMode) {
    setTimeout(async () => {
      try {
        const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
        if (channel) {
          await channel.send('🧪 **Test Mode**: System will schedule daily notifications at 8:00 AM. You can use `!romc-mvp test` to test notifications immediately');
        }
      } catch (err) {
        console.error('Error sending test mode notification:', err);
      }
    }, 3000); // Wait 3 seconds after bot starts
  }
}

// Apply saved preferences for users who opted in to auto-apply
async function applyAutoPreferences() {
  if (isChannelDisabled) {
    console.log('Auto preferences disabled (NOTIFICATION_CHANNEL_ID=DISABLED)');
    return;
  }

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
      await setupNotificationsDebounced();
    }
  } catch (err) {
    console.error('Error applying auto preferences:', err);
  }
}

// Function to restart all cron jobs (useful after updates)
async function restartAllCronJobs() {
  try {
    console.log('🔄 Restarting all cron jobs...');
    
    // Clear all existing jobs first
    clearAllActiveJobs();
    
    // Wait a moment to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Reload user preferences and setup notifications fresh
    await setupNotifications();
    
    console.log('✅ All cron jobs restarted successfully');
    return true;
  } catch (err) {
    console.error('❌ Error restarting cron jobs:', err);
    return false;
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
  
  // Send update notification to the notification channel (if not disabled)
  if (!isChannelDisabled) {
    setTimeout(async () => {
      try {
        const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
        if (channel) {
          const updateEmbed = new EmbedBuilder()
            .setTitle('🔄 ROMC MVP Bot Updated!')
            .setDescription(
              `✅ **Duplicate notification issue fixed!**\n\n` +
              `**What was fixed:**\n` +
              `• 🔧 Fixed duplicate notification issue\n` +
              `• ⚡ Improved cron job management system\n` +
              `• 🛡️ Added race condition protection\n` +
              `• 🔄 Added new refresh commands\n\n` +
              `**New commands:**\n` +
              `• \`!romc-mvp refresh\` - Refresh your notifications\n` +
              `• \`!romc-mvp admin restart\` - Restart entire system (Admin)\n\n` +
              `**Recommendation:** If you previously had duplicate notification issues, please use \`!romc-mvp refresh\` to refresh your settings`
            )
            .setColor('#00FF00')
            .setFooter({ text: 'ROMC MVP Notification System - Update v2.1' })
            .setTimestamp();
          
          await channel.send({ embeds: [updateEmbed] });
        }
      } catch (err) {
        console.error('Error sending update notification:', err);
      }
    }, 5000); // Wait 5 seconds after bot starts
  }
});

// Interaction handling for select menu and buttons
client.on('interactionCreate', async interaction => {
  try {
    // Handle select menu interactions for notification times (including multiple menus)
    if (interaction.isStringSelectMenu() && (interaction.customId === 'notification_times' || interaction.customId.startsWith('notification_times_'))) {
      // Check if interaction is already acknowledged
      if (interaction.replied || interaction.deferred) {
        console.log('Interaction already acknowledged, skipping...');
        return;
      }

      const userId = interaction.user.id;
      const selectedTimes = interaction.values;
      
      // Load current preferences
      const userPrefs = await loadUserPreferences();
      
      // Initialize user if they don't exist
      if (!userPrefs[userId]) {
        userPrefs[userId] = initUserPreferences(userId, userPrefs);
      }
      
      // Get existing temporary times or current times
      let allSelectedTimes = userPrefs[userId].tempTimes || userPrefs[userId].times || [];
      
      // If this is a multi-menu setup, we need to merge selections from all menus
      if (interaction.customId.startsWith('notification_times_')) {
        // Remove any previous selections from this specific menu chunk
        const menuIndex = parseInt(interaction.customId.split('_')[2]);
        const maxOptionsPerMenu = 25;
        const chunkStart = menuIndex * maxOptionsPerMenu;
        const chunkEnd = chunkStart + maxOptionsPerMenu;
        const chunkTimes = NOTIFICATION_TIMES.slice(chunkStart, chunkEnd).map(t => t.value);
        
        // Remove old selections from this chunk
        allSelectedTimes = allSelectedTimes.filter(time => !chunkTimes.includes(time));
        
        // Add new selections from this chunk
        allSelectedTimes = [...allSelectedTimes, ...selectedTimes];
      } else {
        // Single menu, replace all selections
        allSelectedTimes = selectedTimes;
      }
      
      // Check what changed from previous selections
      const previousTimes = userPrefs[userId]?.times || [];
      const added = allSelectedTimes.filter(time => !previousTimes.includes(time));
      const removed = previousTimes.filter(time => !allSelectedTimes.includes(time));
      
      // Store selected times temporarily (don't set up notifications yet)
      userPrefs[userId].tempTimes = allSelectedTimes;
      
      // Save preferences (but don't update actual notifications yet)
      await saveUserPreferences(userPrefs);
      
      // Create disabled dropdown with user's selections
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('notification_times_disabled')
            .setPlaceholder(allSelectedTimes.length > 0 
              ? `✅ Selected ${allSelectedTimes.length} times successfully` 
              : 'No notification times selected')
            .setDisabled(true)
            .addOptions([{
              label: 'Selection completed',
              value: 'completed',
              description: 'You have selected notification times'
            }])
        );
      
      // Keep the auto-apply buttons active
      const autoApplyRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('auto_apply_yes')
            .setLabel('Save as default')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('auto_apply_no')
            .setLabel('One-time only')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Create the embed with the user's selections
      const updatedEmbed = new EmbedBuilder()
        .setTitle('🔔 Notification Times')
        .setDescription(`✅ **Times selected successfully**\n\nPlease choose whether to save as default or use for one-time only`)
        .setColor('#5865F2')
        .setFooter({ text: 'Notifications will start after clicking a button below' });
      
      // Update the original message
      await interaction.update({
        embeds: [updatedEmbed],
        components: [disabledRow, autoApplyRow]
      });
      
      // Build a more detailed feedback message
      let timeChangeInfo = '';
      if (added.length > 0) {
        const addedLabels = added.map(timeVal => {
          const time = NOTIFICATION_TIMES.find(t => t.value === timeVal);
          return time ? time.label : timeVal;
        }).join(', ');
        timeChangeInfo += `Added times: ${addedLabels}\n`;
      }
      if (removed.length > 0) {
        const removedLabels = removed.map(timeVal => {
          const time = NOTIFICATION_TIMES.find(t => t.value === timeVal);
          return time ? time.label : timeVal;
        }).join(', ');
        timeChangeInfo += `Removed times: ${removedLabels}\n`;
      }

      // Send a detailed selection confirmation as ephemeral message to the user
      const timesList = allSelectedTimes.map(t => {
        const time = NOTIFICATION_TIMES.find(nt => nt.value === t);
        return `• ${time ? time.label : t}`;
      }).join('\n');
      
      const userConfirmationEmbed = new EmbedBuilder()
        .setTitle(`🔔 Selected Notification Times`)
        .setDescription(
          `**Selected times:**\n${timesList}\n\n` +
          (timeChangeInfo ? `**Changes:**\n${timeChangeInfo}\n` : '') +
          `**Next steps:**\nClick "Save as default" or "One-time only" to start receiving notifications`
        )
        .setColor('#FFA500')
        .setFooter({ text: 'Notifications will start after clicking a button below' });
      
      await interaction.followUp({ 
        embeds: [userConfirmationEmbed],
        flags: [MessageFlags.Ephemeral] 
      });
    }
    
    // Handle timezone selection
    if (interaction.isStringSelectMenu() && interaction.customId === 'timezone_select') {
      // Check if interaction is already acknowledged
      if (interaction.replied || interaction.deferred) {
        console.log('Timezone interaction already acknowledged, skipping...');
        return;
      }

      const userId = interaction.user.id;
      const selectedTimezone = interaction.values[0];
      
      try {
        // Load current preferences
        const userPrefs = await loadUserPreferences();
        
        // Ensure user exists in preferences
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
        }
        
        // Update timezone setting
        userPrefs[userId].timezone = selectedTimezone;
        
        // Save preferences
        await saveUserPreferences(userPrefs);
        
        // Update notifications with new timezone (use debounced version)
        await setupNotificationsDebounced();
        
        // Get local time in the selected timezone for display
        const currentTime = dayjs().tz(selectedTimezone).format('HH:mm');
        
        // Send confirmation
        await interaction.update({
          content: `✅ Timezone set to **${selectedTimezone}** successfully\nCurrent time in your timezone: **${currentTime}**`,
          embeds: [],
          components: []
        });
        
        setTimeout(async () => {
          try {
            // Try to delete the message after a delay
            const message = await interaction.channel.messages.fetch(interaction.message.id);
            if (message && message.deletable) {
              await message.delete();
            }
          } catch (err) {
            console.error(`Error deleting timezone message: ${err}`);
          }
        }, 10000); // Delete after 10 seconds
        
      } catch (err) {
        console.error(`Error updating timezone: ${err}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ Failed to update timezone. Please try again.',
            flags: [MessageFlags.Ephemeral]
          });
        }
      }
    }
    
    // Handle button interactions for auto-apply
    if (interaction.isButton()) {
      // Check if interaction is already acknowledged
      if (interaction.replied || interaction.deferred) {
        console.log('Button interaction already acknowledged, skipping...');
        return;
      }

      if (interaction.customId === 'auto_apply_yes' || interaction.customId === 'auto_apply_no') {
        const userId = interaction.user.id;
        const autoApply = interaction.customId === 'auto_apply_yes';
        
        // Load current preferences
        const userPrefs = await loadUserPreferences();
        
        // Ensure user exists in preferences
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
        }
        
        // Check if user has temporary times selected
        if (!userPrefs[userId].tempTimes || userPrefs[userId].tempTimes.length === 0) {
          await interaction.reply({
            content: '❌ No times selected yet. Please select times first.',
            flags: [MessageFlags.Ephemeral]
          });
          return;
        }
        
        // Move temporary times to actual times
        userPrefs[userId].times = userPrefs[userId].tempTimes;
        userPrefs[userId].autoApply = autoApply;
        
        // Clear temporary times
        delete userPrefs[userId].tempTimes;
        
        // Save preferences
        await saveUserPreferences(userPrefs);
        
        // Set up notifications now (use debounced version)
        await setupNotificationsDebounced();
        
        // Get the selected times for confirmation
        const timesList = userPrefs[userId].times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        const confirmationEmbed = new EmbedBuilder()
          .setTitle('✅ Notification Times Set')
          .setDescription(
            `🎉 **Notifications started!**\n\n` +
            `**Selected times:**\n${timesList}\n\n` +
            `**Settings:**\n` +
            `• ${autoApply ? '✅ Save as default times' : '⏱️ One-time notification only'}\n` +
            `• 🌐 Timezone: ${userPrefs[userId].timezone || DEFAULT_TIMEZONE}\n\n` +
            `**You will receive:**\n• ⏰ 5-minute early warning`
          )
          .setColor('#00FF00')
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await interaction.reply({ 
          embeds: [confirmationEmbed],
          flags: [MessageFlags.Ephemeral] 
        });
        
        // Delete the setup message after a short delay
        setTimeout(async () => {
          try {
            if (interaction.message && interaction.message.deletable) {
              await interaction.message.delete();
            }
          } catch (err) {
            console.error(`Error deleting message after selection: ${err}`);
          }
        }, 5000); // Delete after 5 seconds
      } else if (interaction.customId === 'setup_now') {
        try {
          // Send feedback message first so user knows something is happening
          await interaction.reply({
            content: '⌛ Setting up notification settings...',
            flags: [MessageFlags.Ephemeral]
          });
          
          // Send notification selection menu
          const setupMsg = await sendDailySelector(interaction.channel, interaction.user.id, false);
          
          if (!setupMsg) {
            await interaction.editReply({
              content: '❌ Failed to set up notifications. Please try again.',
              flags: [MessageFlags.Ephemeral]
            });
            return;
          }
          
          // Update the reply with success message
          await interaction.editReply({
            content: '✅ Notification settings set up successfully! Please select notification times and auto-apply preference.',
            flags: [MessageFlags.Ephemeral]
          });
          
          // Try to delete original message
          try {
            if (interaction.message && interaction.message.deletable) {
              await interaction.message.delete();
            }
          } catch (err) {
            console.error(`Error deleting message after button click: ${err}`);
          }
        } catch (err) {
          console.error(`Error handling setup_now button: ${err}`);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.editReply({
              content: '❌ Failed to set up notifications. Please try again.',
              flags: [MessageFlags.Ephemeral]
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Error handling interaction:', err);
    // Only try to respond if we haven't already responded
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: '❌ Failed to handle interaction. Please try again.',
          flags: [MessageFlags.Ephemeral]
        });
      } catch (replyErr) {
        console.error('Error sending error reply:', replyErr);
      }
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
            { name: '`!romc-mvp`', value: 'Show help and usage instructions', inline: false },
            { name: '`!romc-mvp setup`', value: 'Set up or edit notification times', inline: false },
            { name: '`!romc-mvp edit`', value: 'Edit existing notification times', inline: false },
            { name: '`!romc-mvp me`', value: 'View your notification times', inline: false },
            { name: '`!romc-mvp timezone`', value: 'Set your timezone', inline: false },
            { name: '`!romc-mvp schedule`', value: 'View upcoming MVP spawn times', inline: false },
            { name: '`!romc-mvp diagnose`', value: '🔍 Diagnose notification issues (recommended when having problems)', inline: false },
            { name: '`!romc-mvp refresh`', value: '🔄 Refresh your notifications (recommended after updates)', inline: false },
            { name: '`!romc-mvp reload`', value: 'Reload notifications with latest timezone fixes', inline: false },
            { name: '`!romc-mvp stop`', value: 'Cancel all notifications', inline: false },
            { name: '`!romc-mvp pause`', value: 'Temporarily pause notifications', inline: false },
            { name: '`!romc-mvp resume`', value: 'Resume notifications', inline: false },
            { name: '`!romc-mvp @user`', value: 'View notification times of mentioned user', inline: false },
            ...(message.member?.permissions?.has('Administrator') ? [
              { name: '`!romc-mvp admin list`', value: '🔒 View all notifications in system (Admin)', inline: false },
              { name: '`!romc-mvp admin remove @user`', value: '🔒 Remove user notifications (Admin)', inline: false },
              { name: '`!romc-mvp admin clear`', value: '🔒 Clear all notifications in system (Admin)', inline: false },
              { name: '`!romc-mvp admin restart`', value: '🔒 Restart entire notification system (Admin)', inline: false }
            ] : []),
            ...(isTestMode ? [{ name: '`!romc-mvp test [time]`', value: 'Test notifications (Test mode only)', inline: false }] : [])
          )
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await message.reply({ embeds: [helpEmbed] });
        
      } else if (command === 'setup' || command === 'setting') {
        try {
          // Check if user already has preferences
          const userPrefs = await loadUserPreferences();
          const userId = message.author.id;
          const userExists = userPrefs[userId] && userPrefs[userId].times && userPrefs[userId].times.length > 0;
          
          // Send ephemeral (private) setup menu
          const embed = new EmbedBuilder()
            .setTitle(userExists ? '🔄 Edit MVP Notification Times - ROMC' : '🔔 Set MVP Notification Times - ROMC')
            .setDescription(
              userExists 
                ? 'Edit MVP notification times below. ✓ indicates already selected times\n\nPlease select the times you want to receive MVP notifications'
                : 'Please select the times you want to receive MVP notifications\n\nYour settings are private and notifications will be sent only to you'
            )
            .setColor('#5865F2')
            .setFooter({ text: 'Select times then click "Save as default" or "One-time only"' });

          // Get user's current selections if they exist
          let selectedTimes = [];
          let autoApply = false;
          if (userExists) {
            selectedTimes = userPrefs[userId].times || [];
            autoApply = userPrefs[userId].autoApply || false;
          }

          // Send ephemeral reply with setup menu
          await message.reply({
            embeds: [embed],
            components: createNotificationMenu(selectedTimes, autoApply),
            flags: ['Ephemeral']
          });
          
          // Delete the command message to keep the channel clean
          await message.delete().catch(err => {
            console.error(`Error deleting command message: ${err}`);
            // Continue execution even if delete fails
          });
        } catch (err) {
          console.error(`Error in setup command: ${err}`);
          await message.reply('❌ Failed to set up notification menu. Please try again.');
        }
      
      } else if (command === 'edit') {
        try {
          // Check if user has existing preferences
          const userPrefs = await loadUserPreferences();
          const userId = message.author.id;
          
          if (!userPrefs[userId] || !userPrefs[userId].times || userPrefs[userId].times.length === 0) {
            await message.reply('⚠️ You don\'t have any notification times set. Opening setup menu instead...');
            
            // Send ephemeral setup menu for new users
            const embed = new EmbedBuilder()
              .setTitle('🔔 Set MVP Notification Times - ROMC')
              .setDescription('Please select the times you want to receive MVP notifications\n\nYour settings are private and notifications will be sent only to you')
              .setColor('#5865F2')
              .setFooter({ text: 'Select times then click "Save as default" or "One-time only"' });

            await message.reply({
              embeds: [embed],
              components: createNotificationMenu([], false),
              flags: ['Ephemeral']
            });
            
            // Delete the command message to keep the channel clean
            await message.delete().catch(err => {
              console.error(`Error deleting command message: ${err}`);
            });
            
            return;
          }
          
          // Send ephemeral edit menu for existing users
          const embed = new EmbedBuilder()
            .setTitle('🔄 Edit MVP Notification Times - ROMC')
            .setDescription('Edit MVP notification times below. ✓ indicates already selected times\n\nPlease select the times you want to receive MVP notifications')
            .setColor('#5865F2')
            .setFooter({ text: 'Select times then click "Save as default" or "One-time only"' });

          // Get user's current selections
          const selectedTimes = userPrefs[userId].times || [];
          const autoApply = userPrefs[userId].autoApply || false;

          await message.reply({
            embeds: [embed],
            components: createNotificationMenu(selectedTimes, autoApply),
            flags: [MessageFlags.Ephemeral]
          });
          
          // Delete the command message to keep the channel clean
          await message.delete().catch(err => {
            console.error(`Error deleting command message: ${err}`);
            // Continue execution even if delete fails
          });
        } catch (err) {
          console.error(`Error in edit command: ${err}`);
          await message.reply('❌ Failed to edit notification times. Please try again.');
        }
       
      } else if (command === 'timezone') {
        try {
          // Send feedback message first so user knows something is happening
          const loadingMsg = await message.reply('⌛ Opening timezone settings menu...');
          
          // Send timezone selector
          const timezoneMsg = await sendTimezoneSelector(message.channel, message.author.id);
          
          if (!timezoneMsg) {
            await loadingMsg.edit('❌ Failed to open timezone settings menu. Please try again.');
            return;
          }
          
          // Delete the loading message after setup is complete
          await loadingMsg.delete().catch(err => {
            console.error(`Error deleting loading message: ${err}`);
            // Continue execution even if delete fails
          });
          
          // Delete the command message to keep the channel clean
          await message.delete().catch(err => {
            console.error(`Error deleting command message: ${err}`);
            // Continue execution even if delete fails
          });
        } catch (err) {
          console.error(`Error in timezone command: ${err}`);
          await message.reply('❌ Failed to set timezone. Please try again.');
        }
      } else if (command === 'test') {
        // Test command only available in test mode
        if (!isTestMode) {
          await message.reply('❌ Test mode is not enabled. Please run the bot with `TEST_MODE=true` or use the `--test` flag to enable test mode.');
          return;
        }

        // Get user preferences
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        
        // Initialize user if they don't exist yet
        if (!userPrefs[userId]) {
          userPrefs[userId] = initUserPreferences(userId, userPrefs);
          await saveUserPreferences(userPrefs);
        }
        
        // Get server time information for debugging
        const serverUtcTime = dayjs().utc().format('HH:mm:ss');
        const serverLocalTime = dayjs().format('HH:mm:ss');
        const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
        const debugInfo = `**🧪 Server Information (Test Mode):**\n` +
          `• UTC time: ${serverUtcTime}\n` +
          `• Server time: ${serverLocalTime}\n` +
          `• Server timezone: ${serverTimezone}\n\n`;
        
        const timeArg = args[2];
        
        // If a specific time is provided, test that time
        if (timeArg) {
          const timeInfo = NOTIFICATION_TIMES.find(t => 
            t.value === timeArg || 
            t.label.toLowerCase() === timeArg.toLowerCase() ||
            t.label.toLowerCase().replace(' ', '') === timeArg.toLowerCase()
          );
          
          if (timeInfo) {
            await message.reply(`🧪 **Test Mode**: Sending test notification for time ${timeInfo.label}...\n\n${debugInfo}`);
            await testNotification(userId, timeInfo.value, message.channel);
          } else {
            const availableTimes = NOTIFICATION_TIMES.map(t => `\`${t.value}\` (${t.label})`).join(', ');
            await message.reply(`❌ Invalid time. Please select from: ${availableTimes}\n\n${debugInfo}`);
          }
        } 
        // If no time provided but user has preferences, test their first selected time
        else if (userPrefs[userId]?.times?.length > 0) {
          const timeValue = userPrefs[userId].times[0];
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          
          await message.reply(`🧪 **Test Mode**: Testing notification for time (${timeInfo ? timeInfo.label : timeValue})...\n\n${debugInfo}`);
          await testNotification(userId, timeValue, message.channel);
        }
        // No time provided and user has no preferences
        else {
          await message.reply(`🧪 **Test Mode**: You don't have any times set. Testing with default time 12:00.\n\n${debugInfo}`);
          await testNotification(userId, '12:00', message.channel);
        }

      } else if (command === 'testall') {
        // Test all command only available in test mode and for admins
        if (!isTestMode) {
          await message.reply('❌ Test mode is not enabled. Please run the bot with `TEST_MODE=true` or add the `--test` flag to enable it.');
          return;
        }

        // Check if user has admin permissions
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          await message.reply('❌ Administrator permissions required to test all notifications.');
          return;
        }

        const userId = message.author.id;
        await message.reply('🧪 **Test Mode**: Testing all notifications...');
        
        // Test each notification time with a delay between them
        for (const timeInfo of NOTIFICATION_TIMES) {
          await testNotification(userId, timeInfo.value, message.channel);
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between notifications
        }
        
        await message.reply('✅ All notification tests completed successfully!');
        
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
          await message.reply({
            content: '❌ You haven\'t set any notification times yet', 
            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId('setup_now')
                    .setLabel('Set up now')
                    .setStyle(ButtonStyle.Success)
                )
            ]
          });
          return;
        }
        
        const timesList = userSettings.times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        // Get user's local time
        const userTimezone = userSettings.timezone || DEFAULT_TIMEZONE;
        const currentTime = dayjs().tz(userTimezone).format('HH:mm');
        
        // Create description with timezone info
        let description = `**Your notification times:**\n${timesList}\n\n` +
          `**Save as default:** ${userSettings.autoApply ? '✅ Enabled' : '❌ Disabled'}\n` +
          `**Status:** ${userSettings.paused ? '⏸️ Paused' : '▶️ Active'}\n` +
          `**Timezone:** ${userTimezone} (Your local time: ${currentTime})\n\n`;
        
        // Add server time information in test mode
        if (isTestMode) {
          const serverUtcTime = dayjs().utc().format('HH:mm:ss');
          const serverLocalTime = dayjs().format('HH:mm:ss');
          const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
          
          description += `**🧪 Server Information (Test Mode):**\n` +
            `• UTC time: ${serverUtcTime}\n` +
            `• Server time: ${serverLocalTime}\n` +
            `• Server timezone: ${serverTimezone}\n\n`;
        }
        
        description += `**You will receive:**\n• ⏰ 5-minute early warning`;
        
        const userEmbed = new EmbedBuilder()
          .setTitle(`🔔 ${message.author.username}'s Notification Times`)
          .setDescription(description)
          .setColor('#00FF00')
          .setThumbnail(message.author.displayAvatarURL());
        
        await message.reply({ embeds: [userEmbed] });
        
      } else if (command === 'schedule') {
        // Show upcoming MVP times
        // Get user's timezone or use default
        const userPrefs = await loadUserPreferences();
        const userId = message.author.id;
        const userTimezone = userPrefs[userId]?.timezone || DEFAULT_TIMEZONE;
        
        // Get current time in user's timezone
        const userLocalTime = dayjs().tz(userTimezone);
        const tzCurrentHour = userLocalTime.hour();
        const tzCurrentMinute = userLocalTime.minute();
        
        // Sort times by how soon they'll occur
        const sortedTimes = [...NOTIFICATION_TIMES].sort((a, b) => {
          const [aHour, aMinute] = a.value.split(':').map(Number);
          const [bHour, bMinute] = b.value.split(':').map(Number);
          
          // Convert to minutes since midnight for easier comparison
          let aMinSinceMidnight = aHour * 60 + aMinute;
          let bMinSinceMidnight = bHour * 60 + bMinute;
          let currentMinSinceMidnight = tzCurrentHour * 60 + tzCurrentMinute;
          
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
          let timeUntil = (hour * 60 + minute) - (tzCurrentHour * 60 + tzCurrentMinute);
          if (timeUntil <= 0) timeUntil += 24 * 60; // If it's tomorrow
          
          const hoursUntil = Math.floor(timeUntil / 60);
          const minutesUntil = timeUntil % 60;
          
          return `• ${time.label} (in ${hoursUntil}h ${minutesUntil}m)`;
        }).join('\n');
        
        // Create description
        let description = `**Next 5 MVP spawn times:**\n${timesList}\n\n` +
          `**Your timezone:** ${userTimezone}\n` + 
          `**Your local time:** ${dayjs().tz(userTimezone).format('HH:mm')}`;
        
        // Add server time information in test mode
        if (isTestMode) {
          const serverUtcTime = dayjs().utc().format('HH:mm:ss');
          const serverLocalTime = dayjs().format('HH:mm:ss');
          const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
          
          description += `\n\n**🧪 Server Information (Test Mode):**\n` +
            `• UTC time: ${serverUtcTime}\n` +
            `• Server time: ${serverLocalTime}\n` +
            `• Server timezone: ${serverTimezone}`;
        }
        
        const scheduleEmbed = new EmbedBuilder()
          .setTitle('🕒 Upcoming MVP Spawn Times')
          .setDescription(description)
          .setColor('#5865F2')
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await message.reply({ embeds: [scheduleEmbed] });
        
      } else if (command === 'reload') {
        // Reload all notifications with updated timezone logic
        try {
          const loadingMsg = await message.reply('⌛ Reloading all notifications...');
          
          // Restart all notifications
          await setupNotifications();
          
          const reloadEmbed = new EmbedBuilder()
            .setTitle('🔄 Notification Reload Complete')
            .setDescription('✅ All notifications have been reloaded with the latest timezone fixes\n\nNotifications will now display the correct time according to your timezone')
            .setColor('#00FF00')
            .setFooter({ text: 'ROMC MVP Notification System' });
          
          await loadingMsg.edit({ content: '', embeds: [reloadEmbed] });
          
        } catch (err) {
          console.error('Error reloading notifications:', err);
          await message.reply('❌ Failed to reload notifications. Please try again.');
        }
        
      } else if (command === 'refresh') {
        // Refresh user's notification settings (recommended after updates)
        try {
          const userId = message.author.id;
          const userPrefs = await loadUserPreferences();
          
          // Check if user has any notification settings
          if (!userPrefs[userId] || !userPrefs[userId].times || userPrefs[userId].times.length === 0) {
            const noSettingsEmbed = new EmbedBuilder()
              .setTitle('🔄 Refresh Notifications')
              .setDescription('❌ You don\'t have any notification settings\n\nPlease use `!romc-mvp setup` to configure your notifications first')
              .setColor('#FFA500')
              .setFooter({ text: 'ROMC MVP Notification System' });
            
            await message.reply({ embeds: [noSettingsEmbed] });
            return;
          }
          
          const loadingMsg = await message.reply('⌛ Refreshing your notifications...');
          
          // Force refresh the user's notifications using the debounced version
          await setupNotificationsDebounced();
          
          // Get user's current settings for display
          const timesList = userPrefs[userId].times.map(timeValue => {
            const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
            return `• ${timeInfo ? timeInfo.label : timeValue}`;
          }).join('\n');
          
          const userTimezone = userPrefs[userId].timezone || DEFAULT_TIMEZONE;
          const currentTime = dayjs().tz(userTimezone).format('HH:mm');
          
          const refreshEmbed = new EmbedBuilder()
            .setTitle('🔄 Notification Refresh Complete')
            .setDescription(
              `✅ **Your notifications have been refreshed!**\n\n` +
              `**Your notification times:**\n${timesList}\n\n` +
              `**Current settings:**\n` +
              `• ${userPrefs[userId].autoApply ? '✅ Save as default' : '⏱️ One-time only'}\n` +
              `• ${userPrefs[userId].paused ? '⏸️ Paused' : '▶️ Active'}\n` +
              `• 🌐 Timezone: ${userTimezone} (${currentTime})\n\n` +
              `**Benefits of refreshing:**\n` +
              `• Fixes duplicate notification issues\n` +
              `• Updates timezone settings\n` +
              `• Resets notification system to work correctly`
            )
            .setColor('#00FF00')
            .setFooter({ text: 'Recommended to use this command after bot updates' });
          
          await loadingMsg.edit({ content: '', embeds: [refreshEmbed] });
          
        } catch (err) {
          console.error('Error refreshing user notifications:', err);
          await message.reply('❌ Failed to refresh notifications. Please try again.');
        }
        
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
          .setDescription('All your notification times have been deleted and notifications have been turned off')
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
          await message.reply('❌ You haven\'t set any notification times yet. Please use `!romc-mvp setup` to configure your times first.');
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
          .setDescription('⏸️ Notifications have been temporarily paused\nUse `!romc-mvp resume` to resume notifications')
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
          await message.reply('❌ You haven\'t set any notification times yet. Please use `!romc-mvp setup` to configure your times first.');
          return;
        }
        
        if (!userPrefs[userId].paused) {
          await message.reply('▶️ Notifications are already active');
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
          .setDescription('Your notifications are now active again')
          .setColor('#00FF00');
        
        await message.reply({ embeds: [resumeEmbed] });
        
      } else if (message.mentions.users.size > 0) {
        // Show mentioned user's notification times
        const mentionedUser = message.mentions.users.first();
        const userPrefs = await loadUserPreferences();
        const userSettings = userPrefs[mentionedUser.id];
        
        if (!userSettings || !userSettings.times || !userSettings.times.length) {
          await message.reply(`❌ ${mentionedUser.username} doesn't have any notification times set`);
          return;
        }
        
        const timesList = userSettings.times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        // Get user's timezone
        const userTimezone = userSettings.timezone || DEFAULT_TIMEZONE;
        
        const mentionedUserEmbed = new EmbedBuilder()
          .setTitle(`🔔 ${mentionedUser.username}'s Notification Times`)
          .setDescription(
            `**Notification times:**\n${timesList}\n\n` +
            `**Save as default:** ${userSettings.autoApply ? '✅ Enabled' : '❌ Disabled'}\n` +
            `**Status:** ${userSettings.paused ? '⏸️ Paused' : '▶️ Active'}\n` +
            `**Timezone:** ${userTimezone}`
          )
          .setColor('#FFA500')
          .setThumbnail(mentionedUser.displayAvatarURL());
        
        await message.reply({ embeds: [mentionedUserEmbed] });
        
      } else if (command === 'admin') {
        // Admin commands - require administrator permissions
        if (!message.member?.permissions?.has('Administrator')) {
          await message.reply('❌ This command requires administrator permissions only');
          return;
        }
        
        const subCommand = args[2];
        
        if (subCommand === 'list') {
          // List all notifications in the system
          try {
            const userPrefs = await loadUserPreferences();
            const allUsers = Object.entries(userPrefs);
            
            if (allUsers.length === 0) {
              await message.reply('📋 No users have set up notifications in the system');
              return;
            }
            
            // Filter users who have notifications
            const usersWithNotifications = allUsers.filter(([userId, prefs]) => 
              prefs.times && prefs.times.length > 0
            );
            
            if (usersWithNotifications.length === 0) {
              await message.reply('📋 No users have active notifications');
              return;
            }
            
            // Get page number from args (default to 1)
            const pageArg = args[3];
            const requestedPage = pageArg ? parseInt(pageArg, 10) : 1;
            
            // Create embed with all users and their notifications
            const embed = new EmbedBuilder()
              .setTitle('🔒 All System Notifications (Admin)')
              .setColor('#FF6B35')
              .setFooter({ text: `Total ${usersWithNotifications.length} users | ROMC MVP Notification System` });
            
            // Split into chunks if too many users
            const maxUsersPerPage = 8;
            const totalPages = Math.ceil(usersWithNotifications.length / maxUsersPerPage);
            const currentPage = Math.max(1, Math.min(requestedPage, totalPages));
            
            const startIndex = (currentPage - 1) * maxUsersPerPage;
            const endIndex = Math.min(startIndex + maxUsersPerPage, usersWithNotifications.length);
            const usersToShow = usersWithNotifications.slice(startIndex, endIndex);
            
            let description = `Showing page ${currentPage}/${totalPages}\n\n`;
            
            for (const [userId, prefs] of usersToShow) {
              try {
                // Try to get user info
                const user = await client.users.fetch(userId).catch(() => null);
                const username = user ? user.username : `Unknown User (${userId})`;
                
                const timesList = prefs.times.map(timeValue => {
                  const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
                  return timeInfo ? timeInfo.label : timeValue;
                }).join(', ');
                
                const status = prefs.paused ? '⏸️ Paused' : '▶️ Active';
                const autoApply = prefs.autoApply ? '✅' : '❌';
                const timezone = prefs.timezone || DEFAULT_TIMEZONE;
                
                description += `**${username}** (<@${userId}>)\n`;
                description += `• Times: ${timesList}\n`;
                description += `• Status: ${status} | Default: ${autoApply}\n`;
                description += `• Timezone: ${timezone}\n\n`;
                
              } catch (err) {
                console.error(`Error fetching user ${userId}:`, err);
                description += `**Unknown User** (${userId})\n`;
                description += `• Times: ${prefs.times.join(', ')}\n`;
                description += `• Status: ${prefs.paused ? '⏸️ Paused' : '▶️ Active'}\n\n`;
              }
            }
            
            if (totalPages > 1) {
              description += `\n*Note: Use \`!romc-mvp admin list [page]\` to view other pages (1-${totalPages})*`;
            }
            
            embed.setDescription(description);
            await message.reply({ embeds: [embed] });
            
          } catch (err) {
            console.error('Error listing all notifications:', err);
            await message.reply('❌ Error occurred while retrieving notification data');
          }
          
        } else if (subCommand === 'remove') {
          // Remove notifications for a specific user
          if (message.mentions.users.size === 0) {
            await message.reply('❌ Please specify the user whose notifications you want to remove, e.g. `!romc-mvp admin remove @user`');
            return;
          }
          
          const targetUser = message.mentions.users.first();
          const targetUserId = targetUser.id;
          
          try {
            const userPrefs = await loadUserPreferences();
            
            if (!userPrefs[targetUserId] || !userPrefs[targetUserId].times || userPrefs[targetUserId].times.length === 0) {
              await message.reply(`❌ ${targetUser.username} doesn't have any notifications set`);
              return;
            }
            
            // Store the times for confirmation message
            const removedTimes = userPrefs[targetUserId].times.map(timeValue => {
              const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
              return timeInfo ? timeInfo.label : timeValue;
            });
            
            // Clear user's notifications
            userPrefs[targetUserId].times = [];
            userPrefs[targetUserId].autoApply = false;
            userPrefs[targetUserId].paused = false;
            
            // Clear any scheduled jobs
            if (userPrefs[targetUserId].scheduledJobs) {
              userPrefs[targetUserId].scheduledJobs.forEach(jobId => {
                const job = activeJobs[jobId];
                if (job && typeof job.cancel === 'function') {
                  job.cancel();
                  delete activeJobs[jobId];
                }
              });
              userPrefs[targetUserId].scheduledJobs = [];
            }
            
            // Save preferences
            await saveUserPreferences(userPrefs);
            
            const embed = new EmbedBuilder()
              .setTitle('🔒 User Notifications Removed (Admin)')
              .setDescription(
                `✅ Successfully removed notifications for **${targetUser.username}**\n\n` +
                `**Removed times:**\n${removedTimes.map(time => `• ${time}`).join('\n')}`
              )
              .setColor('#FF0000')
              .setThumbnail(targetUser.displayAvatarURL())
              .setFooter({ text: 'ROMC MVP Notification System' });
            
            await message.reply({ embeds: [embed] });
            
          } catch (err) {
            console.error('Error removing user notifications:', err);
            await message.reply('❌ Failed to remove notifications');
          }
          
        } else if (subCommand === 'clear') {
          // Clear all notifications in the system
          try {
            const userPrefs = await loadUserPreferences();
            const allUsers = Object.entries(userPrefs);
            
            if (allUsers.length === 0) {
              await message.reply('📋 No notifications in system to clear');
              return;
            }
            
            // Count users with notifications before clearing
            const usersWithNotifications = allUsers.filter(([userId, prefs]) => 
              prefs.times && prefs.times.length > 0
            ).length;
            
            if (usersWithNotifications === 0) {
              await message.reply('📋 No active notifications in system');
              return;
            }
            
            // Ask for confirmation
            const confirmEmbed = new EmbedBuilder()
              .setTitle('⚠️ Confirm Clear All Notifications')
              .setDescription(
                `You are about to clear notifications for all **${usersWithNotifications} users** in the system\n\n` +
                `**This action cannot be undone!**\n\n` +
                `Click ✅ to confirm or ❌ to cancel`
              )
              .setColor('#FF6B35');
            
            const confirmMsg = await message.reply({ embeds: [confirmEmbed] });
            
            // Add reactions for confirmation
            await confirmMsg.react('✅');
            await confirmMsg.react('❌');
            
            // Wait for reaction
            const filter = (reaction, user) => {
              return ['✅', '❌'].includes(reaction.emoji.name) && user.id === message.author.id;
            };
            
            const collected = await confirmMsg.awaitReactions({ 
              filter, 
              max: 1, 
              time: 30000,
              errors: ['time'] 
            }).catch(() => null);
            
            if (!collected || collected.first().emoji.name === '❌') {
              await confirmMsg.edit({
                embeds: [new EmbedBuilder()
                  .setTitle('❌ Clear Cancelled')
                  .setDescription('Clear all notifications operation was cancelled')
                  .setColor('#808080')
                ],
                components: []
              });
              return;
            }
            
            // Clear all notifications
            let clearedCount = 0;
            for (const [userId, prefs] of allUsers) {
              if (prefs.times && prefs.times.length > 0) {
                // Clear user's notifications
                prefs.times = [];
                prefs.autoApply = false;
                prefs.paused = false;
                
                // Clear any scheduled jobs
                if (prefs.scheduledJobs) {
                  prefs.scheduledJobs.forEach(jobId => {
                    const job = activeJobs[jobId];
                    if (job && typeof job.cancel === 'function') {
                      job.cancel();
                      delete activeJobs[jobId];
                    }
                  });
                  prefs.scheduledJobs = [];
                }
                
                clearedCount++;
              }
            }
            
            // Save preferences
            await saveUserPreferences(userPrefs);
            
            const successEmbed = new EmbedBuilder()
              .setTitle('🔒 Clear All Notifications Complete (Admin)')
              .setDescription(
                `✅ Successfully cleared notifications for all **${clearedCount} users**\n\n` +
                `Notification system has been reset successfully`
              )
              .setColor('#00FF00')
              .setFooter({ text: 'ROMC MVP Notification System' });
            
            await confirmMsg.edit({ embeds: [successEmbed] });
            
          } catch (err) {
            console.error('Error clearing all notifications:', err);
            await message.reply('❌ Error occurred while clearing all notifications');
          }
          
        } else if (subCommand === 'restart') {
          // Restart all cron jobs in the system (admin only)
          try {
            const loadingMsg = await message.reply('⌛ Restarting entire notification system...');
            
            // Use the restart function
            const success = await restartAllCronJobs();
            
            if (success) {
              // Get current system status for display
              const userPrefs = await loadUserPreferences();
              const usersWithNotifications = Object.entries(userPrefs).filter(([userId, prefs]) => 
                prefs.times && prefs.times.length > 0
              );
              
              const restartEmbed = new EmbedBuilder()
                .setTitle('🔒 Notification System Restart Complete (Admin)')
                .setDescription(
                  `✅ **Notification system has been restarted successfully!**\n\n` +
                  `**System Status:**\n` +
                  `• Users with notifications: ${usersWithNotifications.length} users\n` +
                  `• Active jobs: ${Object.keys(activeJobs).length} jobs\n` +
                  `• Server time: ${dayjs().format('HH:mm:ss')}\n\n` +
                  `**Benefits of restart:**\n` +
                  `• Fixes duplicate notification issues\n` +
                  `• Resets all cron jobs\n` +
                  `• Updates latest settings\n\n` +
                  `**Recommendation:** Notify users to use \`!romc-mvp refresh\` if they still have issues`
                )
                .setColor('#00FF00')
                .setFooter({ text: 'ROMC MVP Notification System - Admin' });
              
              await loadingMsg.edit({ content: '', embeds: [restartEmbed] });
            } else {
              const errorEmbed = new EmbedBuilder()
                .setTitle('❌ System Restart Failed (Admin)')
                .setDescription('Error occurred while restarting notification system. Please check console logs')
                .setColor('#FF0000')
                .setFooter({ text: 'ROMC MVP Notification System - Admin' });
              
              await loadingMsg.edit({ content: '', embeds: [errorEmbed] });
            }
            
          } catch (err) {
            console.error('Error restarting all cron jobs:', err);
            await message.reply('❌ Error occurred while restarting notification system');
          }
          
        } else {
          await message.reply('❌ Invalid admin command\nUse: `!romc-mvp admin list`, `!romc-mvp admin remove @user`, `!romc-mvp admin clear`, or `!romc-mvp admin restart`');
        }
        
      } else if (command === 'debug') {
        // Debug command to show server and job status
        if (!message.member?.permissions?.has('Administrator')) {
          await message.reply('❌ This command requires administrator permissions only');
          return;
        }
        
        try {
          const userPrefs = await loadUserPreferences();
          const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const serverUtcTime = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
          const serverLocalTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
          
          let description = `**🖥️ Server Information:**\n`;
          description += `• Server timezone: ${serverTimezone}\n`;
          description += `• Server UTC time: ${serverUtcTime}\n`;
          description += `• Server local time: ${serverLocalTime}\n`;
          description += `• Default timezone: ${DEFAULT_TIMEZONE}\n`;
          description += `• Test mode: ${isTestMode ? '✅ Enabled' : '❌ Disabled'}\n\n`;
          
          description += `**📊 Job Status:**\n`;
          description += `• Total active jobs: ${Object.keys(activeJobs).length}\n`;
          description += `• Active job IDs: ${Object.keys(activeJobs).join(', ') || 'None'}\n\n`;
          
          description += `**👥 User Status:**\n`;
          const usersWithNotifications = Object.entries(userPrefs).filter(([userId, prefs]) => 
            prefs.times && prefs.times.length > 0
          );
          description += `• Users with notifications: ${usersWithNotifications.length}\n`;
          
          if (usersWithNotifications.length > 0) {
            description += `\n**📋 User Details:**\n`;
            for (const [userId, prefs] of usersWithNotifications.slice(0, 5)) { // Show max 5 users
              try {
                const user = await client.users.fetch(userId).catch(() => null);
                const username = user ? user.username : `Unknown (${userId})`;
                description += `• **${username}**: ${prefs.times.length} times, `;
                description += `${prefs.timezone || DEFAULT_TIMEZONE}, `;
                description += `${prefs.paused ? 'Paused' : 'Active'}\n`;
              } catch (err) {
                description += `• **Unknown (${userId})**: ${prefs.times.length} times\n`;
              }
            }
            if (usersWithNotifications.length > 5) {
              description += `• ... and ${usersWithNotifications.length - 5} more users\n`;
            }
          }
          
          const debugEmbed = new EmbedBuilder()
            .setTitle('🔧 Debug Information')
            .setDescription(description)
            .setColor('#FF6B35')
            .setFooter({ text: 'ROMC MVP Notification System Debug' });
          
          await message.reply({ embeds: [debugEmbed] });
          
        } catch (err) {
          console.error('Error in debug command:', err);
          await message.reply('❌ Error occurred while retrieving debug data');
        }
      } else if (command === 'diagnose' || command === 'diagnostic') {
        // Diagnostic command to help troubleshoot notification issues
        try {
          const userId = message.author.id;
          const userPrefs = await loadUserPreferences();
          const allUsers = Object.entries(userPrefs);
          const usersWithNotifications = allUsers.filter(([_, prefs]) => prefs.times && prefs.times.length > 0);
          const activeJobCount = Object.keys(activeJobs).length;
          
          // Check user's specific settings
          const userSettings = userPrefs[userId];
          const hasSettings = userSettings && userSettings.times && userSettings.times.length > 0;
          
          // Get current time info
          const currentTime = dayjs().format('HH:mm:ss');
          const bangkokTime = dayjs().tz(DEFAULT_TIMEZONE).format('HH:mm:ss');
          
          const diagnosticEmbed = new EmbedBuilder()
            .setTitle('🔍 Notification System Diagnosis')
            .setDescription(
              `**Overall System Status:**\n` +
              `• 🤖 Bot online: ${client.readyAt ? '✅ Yes' : '❌ No'}\n` +
              `• 📊 Total users in system: ${allUsers.length} users\n` +
              `• 🔔 Users with notifications: ${usersWithNotifications.length} users\n` +
              `• ⚙️ Active jobs: ${activeJobCount} jobs\n` +
              `• 🕐 Server time: ${currentTime}\n` +
              `• 🌐 Bangkok time: ${bangkokTime}\n\n` +
              
              `**Your Settings:**\n` +
              (hasSettings ? 
                `• ✅ Notification settings configured\n` +
                `• 📅 Selected times: ${userSettings.times.length} times\n` +
                `• ${userSettings.autoApply ? '✅ Save as default' : '⏱️ One-time only'}\n` +
                `• ${userSettings.paused ? '⏸️ Temporarily paused' : '▶️ Currently active'}\n` +
                `• 🌐 Timezone: ${userSettings.timezone || DEFAULT_TIMEZONE}`
                :
                `• ❌ No notification settings configured yet\n` +
                `• 📝 Need to set up after update`
              ) +
              `\n\n**Troubleshooting:**\n` +
              (usersWithNotifications.length === 0 ? 
                `🚨 **Main Issue**: No users have notification settings\n\n` +
                `**Solution:**\n` +
                `1. Use \`!romc-mvp setup\` to configure new settings\n` +
                `2. Select times you want to receive notifications\n` +
                `3. Choose "Save as default" to work daily\n` +
                `4. Use \`!romc-mvp test <time>\` to test`
                :
                !hasSettings ?
                `🔧 **You need to reconfigure**\n\n` +
                `**Solution:**\n` +
                `1. Use \`!romc-mvp setup\` to configure new settings\n` +
                `2. Or use \`!romc-mvp refresh\` to refresh`
                :
                `✅ **Your settings look normal**\n\n` +
                `If you're still not receiving notifications:\n` +
                `1. Use \`!romc-mvp refresh\` to refresh\n` +
                `2. Use \`!romc-mvp test <time>\` to test\n` +
                `3. Check that you haven't clicked "pause"`
              )
            )
            .setColor(usersWithNotifications.length === 0 ? '#FF0000' : hasSettings ? '#00FF00' : '#FFA500')
            .setFooter({ text: 'Use !romc-mvp help to see all commands' })
            .setTimestamp();
          
          await message.reply({ embeds: [diagnosticEmbed] });
          
        } catch (err) {
          console.error('Error in diagnostic command:', err);
          await message.reply('❌ Error occurred while diagnosing system. Please try again');
        }
      } else {
        // Unknown command
        await message.reply('❌ Command not found\nPlease use `!romc-mvp` to see all available commands');
      }
      
    } catch (err) {
      console.error('Error handling notifications command:', err);
      await message.reply('❌ An error occurred while processing your command');
    }
  }
});

// Login to Discord with a check for disabled status
client.login(process.env.BOT_TOKEN);