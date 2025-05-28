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
const activeJobs = {};

// Define notification times from the image
const NOTIFICATION_TIMES = [
  { label: '00:00 น.', value: '00:00', cronTime: '0 0 * * *', earlyWarningCron: '55 23 * * *' },
  { label: '01:30 น.', value: '01:30', cronTime: '30 1 * * *', earlyWarningCron: '25 1 * * *' },
  { label: '03:00 น.', value: '03:00', cronTime: '0 3 * * *', earlyWarningCron: '55 2 * * *' },
  { label: '04:30 น.', value: '04:30', cronTime: '30 4 * * *', earlyWarningCron: '25 4 * * *' },
  { label: '06:00 น.', value: '06:00', cronTime: '0 6 * * *', earlyWarningCron: '55 5 * * *' },
  { label: '07:30 น.', value: '07:30', cronTime: '30 7 * * *', earlyWarningCron: '25 7 * * *' },
  { label: '09:00 น.', value: '09:00', cronTime: '0 9 * * *', earlyWarningCron: '55 8 * * *' },
  { label: '10:30 น.', value: '10:30', cronTime: '30 10 * * *', earlyWarningCron: '25 10 * * *' },
  { label: '12:00 น.', value: '12:00', cronTime: '0 12 * * *', earlyWarningCron: '55 11 * * *' },
  { label: '13:30 น.', value: '13:30', cronTime: '30 13 * * *', earlyWarningCron: '25 13 * * *' },
  { label: '15:00 น.', value: '15:00', cronTime: '0 15 * * *', earlyWarningCron: '55 14 * * *' },
  { label: '16:30 น.', value: '16:30', cronTime: '30 16 * * *', earlyWarningCron: '25 16 * * *' },
  { label: '18:00 น.', value: '18:00', cronTime: '0 18 * * *', earlyWarningCron: '55 17 * * *' },
  { label: '19:30 น.', value: '19:30', cronTime: '30 19 * * *', earlyWarningCron: '25 19 * * *' },
  { label: '21:00 น.', value: '21:00', cronTime: '0 21 * * *', earlyWarningCron: '55 20 * * *' },
  { label: '22:30 น.', value: '22:30', cronTime: '30 22 * * *', earlyWarningCron: '25 22 * * *' },
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

// Function to convert cron time to a specific timezone
function convertCronToTimezone(cronExpression, timezone) {
  // If no timezone specified, use default
  if (!timezone) return cronExpression;
  
  // Parse the cron expression
  const parts = cronExpression.split(' ');
  if (parts.length !== 5) return cronExpression; // Invalid cron expression
  
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  
  // The NOTIFICATION_TIMES are defined in Bangkok time (Asia/Bangkok)
  // Create a dayjs object for today at the specified hour/minute in Bangkok timezone
  const localTime = dayjs.tz(dayjs().format('YYYY-MM-DD'), DEFAULT_TIMEZONE).hour(hour).minute(minute).second(0);
  
  // Convert to target timezone
  const targetTime = localTime.tz(timezone);
  
  // Return new cron expression with adjusted hour/minute
  return `${targetTime.minute()} ${targetTime.hour()} ${parts[2]} ${parts[3]} ${parts[4]}`;
}

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
      lastSetupMessageId: null,  // ID of the last setup message sent
      timezone: DEFAULT_TIMEZONE  // Default timezone
    };
  }
  return userPrefs[userId];
}

// Function to send a notification to a user
async function sendNotificationToUser(userId, timeLabel) {
  try {
    const userPrefs = await loadUserPreferences();
    
    // Skip if user has paused notifications
    if (userPrefs[userId]?.paused) return;
    
    const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
    if (channel) {
      // Get user's timezone for display
      const userTimezone = userPrefs[userId]?.timezone || DEFAULT_TIMEZONE;
      const currentTime = dayjs().tz(userTimezone).format('HH:mm');
      
      // Convert the MVP time from Bangkok timezone to user's timezone
      // Extract the time from timeLabel (e.g., "18:00 น." -> "18:00")
      const timeMatch = timeLabel.match(/(\d{2}:\d{2})/);
      let mvpTimeInUserTz = timeLabel; // fallback to original label
      
      if (timeMatch) {
        const [hours, minutes] = timeMatch[1].split(':').map(Number);
        // Create time in Bangkok timezone
        const localTime = dayjs.tz(dayjs().format('YYYY-MM-DD'), DEFAULT_TIMEZONE).hour(hours).minute(minutes);
        // Convert to user's timezone
        const userTime = localTime.tz(userTimezone);
        mvpTimeInUserTz = `${userTime.format('HH:mm')} น.`;
      }
      
      // Always send message to channel with user mention
      const message = `<@${userId}>\n⏰ **แจ้งเตือนล่วงหน้า 5 นาที**: MVP กำลังจะเกิดในเวลา ${mvpTimeInUserTz}! อย่าลืมเตรียมตัวให้พร้อมนะ!\n(เวลาท้องถิ่นของคุณ: ${currentTime} - ${userTimezone})`;
      
      await channel.send(message);
    }
  } catch (err) {
    console.error(`Error sending notification to user ${userId}:`, err);
  }
}

// Create notification select menu
function createNotificationMenu(selectedTimes = [], autoApply = false) {
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('notification_times')
        .setPlaceholder(selectedTimes.length > 0 
          ? `แก้ไข ${selectedTimes.length} เวลาที่เลือกไว้` 
          : 'เลือกเวลาการแจ้งเตือน')
        .setMinValues(0)
        .setMaxValues(NOTIFICATION_TIMES.length)
        .addOptions(NOTIFICATION_TIMES.map(time => {
          const isSelected = selectedTimes.includes(time.value);
          return {
            label: isSelected ? `✓ ${time.label}` : time.label,
            value: time.value,
            description: `รับแจ้งเตือนในเวลา ${time.label}`,
            default: isSelected
          };
        }))
    );
  
  const autoApplyRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('auto_apply_yes')
        .setLabel('บันทึกเป็นเวลาเริ่มต้น')
        .setStyle(autoApply ? ButtonStyle.Primary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('auto_apply_no')
        .setLabel('เฉพาะครั้งนี้')
        .setStyle(!autoApply ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  
  return [row, autoApplyRow];
}

// Create timezone selection menu
function createTimezoneMenu(selectedTimezone = DEFAULT_TIMEZONE) {
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('timezone_select')
        .setPlaceholder(`เลือกโซนเวลา (ปัจจุบัน: ${selectedTimezone})`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(COMMON_TIMEZONES.map(tz => {
          return {
            label: tz.label,
            value: tz.value,
            description: `ตั้งค่าโซนเวลาเป็น ${tz.value}`,
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
      ? 'แก้ไขเวลาแจ้งเตือน MVP ด้านล่าง ✓ คือเวลาที่เลือกไว้แล้ว\n\n'
      : 'กรุณาเลือกเวลาที่คุณต้องการรับการแจ้งเตือนสำหรับ MVP\n\n';
    
    if (selectedTimes.length > 0) {
      const timeLabels = selectedTimes.map(timeValue => {
        const time = NOTIFICATION_TIMES.find(t => t.value === timeValue);
        return time ? `• ${time.label}` : `• ${timeValue}`;
      }).join('\n');
      
      embedDescription += `**เวลาการแจ้งเตือนที่คุณเลือกไว้:**\n${timeLabels}\n\n`;
      
      // Show auto-apply preference if available
      if (userId && userPrefs[userId]) {
        embedDescription += `**การตั้งค่าของคุณ:**\n`;
        embedDescription += `• ${userPrefs[userId].autoApply ? '✅ ใช้เวลานี้เป็นค่าตั้งต้น' : '⏱️ แจ้งเตือนเฉพาะครั้งนี้'}\n`;
        embedDescription += `• ${userPrefs[userId].paused ? '⏸️ การแจ้งเตือนถูกพักไว้' : '▶️ กำลังแจ้งเตือนตามปกติ'}\n`;
        embedDescription += `• 🌐 โซนเวลา: ${userPrefs[userId].timezone || DEFAULT_TIMEZONE}\n\n`;
      }
    }
    
    embedDescription += 'คุณสามารถเลือกบันทึกเวลาเหล่านี้เป็นค่าตั้งต้น หรือใช้สำหรับวันนี้เท่านั้น\n\nการตั้งค่าของคุณจะเป็นแบบส่วนตัว และการแจ้งเตือนจะถูกส่งเฉพาะถึงคุณ';
    
    const embed = new EmbedBuilder()
      .setTitle(isEditing ? '🔄 แก้ไขเวลาแจ้งเตือน MVP - ROMC' : '🔔 ตั้งเวลาแจ้งเตือน MVP - ROMC')
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
      .setTitle('🌐 ตั้งค่าโซนเวลา - ROMC MVP Notification')
      .setDescription(`กรุณาเลือกโซนเวลาที่คุณต้องการใช้สำหรับการแจ้งเตือน\n\n**โซนเวลาปัจจุบันของคุณ:** ${userTimezone}\n**เวลาท้องถิ่นของคุณ:** ${currentTime}\n\nการตั้งค่าโซนเวลาจะช่วยให้คุณได้รับแจ้งเตือนในเวลาที่ถูกต้องสำหรับพื้นที่ของคุณ`)
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
    
    // Get user's timezone or use default
    const userTimezone = prefs.timezone || DEFAULT_TIMEZONE;
    
    // Schedule new notifications
    prefs.times.forEach(timeValue => {
      const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
      if (!timeInfo) return;
      
      // Convert cron expressions to user's timezone
      const earlyWarningCronInTz = convertCronToTimezone(timeInfo.earlyWarningCron, userTimezone);
      
      // Schedule 5-minute early warning only
      const earlyWarningJob = cron.schedule(earlyWarningCronInTz, async () => {
        await sendNotificationToUser(userId, timeInfo.label);
      });
      
      // If notifications are paused, stop the job immediately
      if (prefs.paused) {
        if (earlyWarningJob && typeof earlyWarningJob.stop === 'function') {
          earlyWarningJob.stop();
        }
      }
      
      // Store job ID for future reference
      if (earlyWarningJob) {
        const earlyJobId = `${userId}_${timeValue}_early`;
        prefs.scheduledJobs.push(earlyJobId);
        activeJobs[earlyJobId] = earlyWarningJob;
      }
    });
  });
  
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
      // If no specific time was provided, use the current time
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const formattedHours = hours < 10 ? `0${hours}` : hours;
      const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
      const currentTime = `${formattedHours}:${formattedMinutes}`;
      
      await channel.send(`❌ ไม่พบเวลาที่ระบุ: ${timeValue} กรุณาเลือกเวลาที่ถูกต้องจากรายการ`);
      return false;
    }

    // Send early warning notification
    await sendNotificationToUser(userId, timeInfo.label);
    
    return true;
  } catch (err) {
    console.error('Error testing notification:', err);
    await channel.send(`❌ พบข้อผิดพลาดระหว่างทดสอบแจ้งเตือน: ${err.message}`);
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
  });

  // In test mode, also show a notification that daily messages are scheduled
  if (isTestMode) {
    setTimeout(async () => {
      try {
        const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
        if (channel) {
          await channel.send('🧪 **โหมดทดสอบ**: ระบบจะกำหนดแจ้งเตือนรายวันเวลา 8:00 น. คุณสามารถใช้ `!romc-mvp test` เพื่อทดสอบแจ้งเตือนทันที');
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
    
    // Check what changed from previous selections
    const previousTimes = userPrefs[userId]?.times || [];
    const added = selectedTimes.filter(time => !previousTimes.includes(time));
    const removed = previousTimes.filter(time => !selectedTimes.includes(time));
    
    // Initialize user if they don't exist
    if (!userPrefs[userId]) {
      userPrefs[userId] = initUserPreferences(userId, userPrefs);
    }
    
    // Store selected times temporarily (don't set up notifications yet)
    userPrefs[userId].tempTimes = selectedTimes;
    
    // Save preferences (but don't update actual notifications yet)
    await saveUserPreferences(userPrefs);
    
    // Create disabled dropdown with user's selections
    const disabledRow = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('notification_times_disabled')
          .setPlaceholder(selectedTimes.length > 0 
            ? `✅ เลือก ${selectedTimes.length} เวลาเรียบร้อยแล้ว` 
            : 'ยังไม่ได้เลือกเวลาแจ้งเตือน')
          .setDisabled(true)
          .addOptions([{
            label: 'การเลือกเสร็จสิ้น',
            value: 'completed',
            description: 'คุณได้เลือกเวลาแจ้งเตือนแล้ว'
          }])
      );
    
    // Keep the auto-apply buttons active
    const autoApplyRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('auto_apply_yes')
          .setLabel('บันทึกเป็นเวลาเริ่มต้น')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('auto_apply_no')
          .setLabel('เฉพาะครั้งนี้')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Create the embed with the user's selections
    const updatedEmbed = new EmbedBuilder()
      .setTitle('🔔 เวลาแจ้งเตือน')
      .setDescription(`✅ **เลือกเวลาเรียบร้อยแล้ว**\n\nกรุณาเลือกว่าต้องการบันทึกเป็นค่าเริ่มต้นหรือใช้เฉพาะครั้งนี้`)
      .setColor('#5865F2')
      .setFooter({ text: 'การแจ้งเตือนจะเริ่มทำงานหลังจากกดปุ่มด้านล่าง' });
    
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
      timeChangeInfo += `เพิ่มเวลา: ${addedLabels}\n`;
    }
    if (removed.length > 0) {
      const removedLabels = removed.map(timeVal => {
        const time = NOTIFICATION_TIMES.find(t => t.value === timeVal);
        return time ? time.label : timeVal;
      }).join(', ');
      timeChangeInfo += `ลบเวลา: ${removedLabels}\n`;
    }

    // Send a detailed selection confirmation as ephemeral message to the user
    const timesList = selectedTimes.map(t => {
      const time = NOTIFICATION_TIMES.find(nt => nt.value === t);
      return `• ${time ? time.label : t}`;
    }).join('\n');
    
    const userConfirmationEmbed = new EmbedBuilder()
      .setTitle(`🔔 เวลาแจ้งเตือนที่เลือก`)
      .setDescription(
        `**เวลาที่คุณเลือก:**\n${timesList}\n\n` +
        (timeChangeInfo ? `**การเปลี่ยนแปลง:**\n${timeChangeInfo}\n` : '') +
        `**ขั้นตอนถัดไป:**\nกดปุ่ม "บันทึกเป็นเวลาเริ่มต้น" หรือ "เฉพาะครั้งนี้" เพื่อเริ่มการแจ้งเตือน`
      )
      .setColor('#FFA500')
      .setFooter({ text: 'การแจ้งเตือนยังไม่เริ่มทำงาน - รอการยืนยัน' });
    
    await interaction.followUp({ 
      embeds: [userConfirmationEmbed],
      flags: [MessageFlags.Ephemeral] 
    });
  }
  
  // Handle timezone selection
  if (interaction.isStringSelectMenu() && interaction.customId === 'timezone_select') {
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
      
      // Update notifications with new timezone
      await setupNotifications();
      
      // Get local time in the selected timezone for display
      const currentTime = dayjs().tz(selectedTimezone).format('HH:mm');
      
      // Send confirmation
      await interaction.update({
        content: `✅ โซนเวลาของคุณถูกตั้งเป็น **${selectedTimezone}** เรียบร้อยแล้ว\nเวลาปัจจุบันในโซนเวลาของคุณคือ **${currentTime}**`,
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
      await interaction.reply({
        content: '❌ เกิดข้อผิดพลาดในการตั้งค่าโซนเวลา โปรดลองใหม่อีกครั้ง',
        flags: [MessageFlags.Ephemeral]
      });
    }
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
        userPrefs[userId] = initUserPreferences(userId, userPrefs);
      }
      
      // Check if user has temporary times selected
      if (!userPrefs[userId].tempTimes || userPrefs[userId].tempTimes.length === 0) {
        await interaction.reply({
          content: '❌ ไม่พบเวลาที่เลือกไว้ กรุณาเลือกเวลาแจ้งเตือนก่อน',
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
      
      // Set up notifications now
      await setupNotifications();
      
      // Get the selected times for confirmation
      const timesList = userPrefs[userId].times.map(timeValue => {
        const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
        return `• ${timeInfo ? timeInfo.label : timeValue}`;
      }).join('\n');
      
      const confirmationEmbed = new EmbedBuilder()
        .setTitle('✅ ตั้งค่าการแจ้งเตือนเสร็จสิ้น')
        .setDescription(
          `🎉 **การแจ้งเตือนเริ่มทำงานแล้ว!**\n\n` +
          `**เวลาที่ตั้งไว้:**\n${timesList}\n\n` +
          `**การตั้งค่า:**\n` +
          `• ${autoApply ? '✅ บันทึกเป็นค่าเริ่มต้น - จะใช้ทุกวัน' : '⏱️ เฉพาะครั้งนี้ - จะรีเซ็ตพรุ่งนี้'}\n` +
          `• 🌐 โซนเวลา: ${userPrefs[userId].timezone || DEFAULT_TIMEZONE}\n\n` +
          `**คุณจะได้รับ:**\n• ⏰ แจ้งเตือนล่วงหน้า 5 นาที`
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
          content: '⌛ กำลังเปิดเมนูตั้งค่าเวลาแจ้งเตือน...',
          flags: [MessageFlags.Ephemeral]
        });
        
        // Send notification selection menu
        const setupMsg = await sendDailySelector(interaction.channel, interaction.user.id, false);
        
        if (!setupMsg) {
          await interaction.editReply({
            content: '❌ ไม่สามารถตั้งค่าเมนูแจ้งเตือนได้ โปรดลองใหม่อีกครั้ง',
            flags: [MessageFlags.Ephemeral]
          });
          return;
        }
        
        // Update the reply with success message
        await interaction.editReply({
          content: '✅ เปิดเมนูตั้งค่าแล้ว กรุณาเลือกเวลาที่ต้องการรับการแจ้งเตือน',
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
        await interaction.editReply({
          content: '❌ เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง',
          flags: [MessageFlags.Ephemeral]
        });
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
          .setDescription('รายการคำสั่งที่สามารถใช้งานได้:')
          .addFields(
            { name: '`!romc-mvp`', value: 'แสดงคำแนะนำการใช้งาน', inline: false },
            { name: '`!romc-mvp setup`', value: 'ตั้งค่าหรือแก้ไขเวลาแจ้งเตือน', inline: false },
            { name: '`!romc-mvp edit`', value: 'แก้ไขเวลาแจ้งเตือนที่มีอยู่', inline: false },
            { name: '`!romc-mvp me`', value: 'ดูเวลาการแจ้งเตือนของคุณ', inline: false },
            { name: '`!romc-mvp timezone`', value: 'ตั้งค่าโซนเวลาของคุณ', inline: false },
            { name: '`!romc-mvp schedule`', value: 'ดูเวลาการเกิด MVP ถัดไป', inline: false },
            { name: '`!romc-mvp reload`', value: 'รีโหลดการแจ้งเตือนด้วยการแก้ไขโซนเวลาล่าสุด', inline: false },
            { name: '`!romc-mvp stop`', value: 'ยกเลิกการแจ้งเตือนทั้งหมด', inline: false },
            { name: '`!romc-mvp pause`', value: 'หยุดการแจ้งเตือนชั่วคราว', inline: false },
            { name: '`!romc-mvp resume`', value: 'เริ่มการแจ้งเตือนอีกครั้ง', inline: false },
            { name: '`!romc-mvp @user`', value: 'ดูเวลาการแจ้งเตือนของผู้ใช้ที่ถูกกล่าวถึง', inline: false },
            ...(message.member?.permissions?.has('Administrator') ? [
              { name: '`!romc-mvp admin list`', value: '🔒 ดูการแจ้งเตือนทั้งหมดในระบบ (Admin)', inline: false },
              { name: '`!romc-mvp admin remove @user`', value: '🔒 ลบการแจ้งเตือนของผู้ใช้ (Admin)', inline: false },
              { name: '`!romc-mvp admin clear`', value: '🔒 ลบการแจ้งเตือนทั้งหมดในระบบ (Admin)', inline: false }
            ] : []),
            ...(isTestMode ? [{ name: '`!romc-mvp test [เวลา]`', value: 'ทดสอบการแจ้งเตือน (สำหรับโหมดทดสอบเท่านั้น)', inline: false }] : [])
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
            .setTitle(userExists ? '🔄 แก้ไขเวลาแจ้งเตือน MVP - ROMC' : '🔔 ตั้งเวลาแจ้งเตือน MVP - ROMC')
            .setDescription(
              userExists 
                ? 'แก้ไขเวลาแจ้งเตือน MVP ด้านล่าง ✓ คือเวลาที่เลือกไว้แล้ว\n\nกรุณาเลือกเวลาที่คุณต้องการรับการแจ้งเตือนสำหรับ MVP'
                : 'กรุณาเลือกเวลาที่คุณต้องการรับการแจ้งเตือนสำหรับ MVP\n\nการตั้งค่าของคุณจะเป็นแบบส่วนตัว และการแจ้งเตือนจะถูกส่งเฉพาะถึงคุณ'
            )
            .setColor('#5865F2')
            .setFooter({ text: 'เลือกเวลาแล้วกดปุ่ม "บันทึกเป็นเวลาเริ่มต้น" หรือ "เฉพาะครั้งนี้"' });

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
          await message.reply('❌ เกิดข้อผิดพลาดในการตั้งค่าเมนูแจ้งเตือน โปรดลองใหม่อีกครั้ง');
        }
      
      } else if (command === 'edit') {
        try {
          // Check if user has existing preferences
          const userPrefs = await loadUserPreferences();
          const userId = message.author.id;
          
          if (!userPrefs[userId] || !userPrefs[userId].times || userPrefs[userId].times.length === 0) {
            await message.reply('⚠️ คุณยังไม่มีเวลาแจ้งเตือนที่ตั้งไว้ กำลังเปิดเมนูตั้งค่าแทน...');
            
            // Send ephemeral setup menu for new users
            const embed = new EmbedBuilder()
              .setTitle('🔔 ตั้งเวลาแจ้งเตือน MVP - ROMC')
              .setDescription('กรุณาเลือกเวลาที่คุณต้องการรับการแจ้งเตือนสำหรับ MVP\n\nการตั้งค่าของคุณจะเป็นแบบส่วนตัว และการแจ้งเตือนจะถูกส่งเฉพาะถึงคุณ')
              .setColor('#5865F2')
              .setFooter({ text: 'เลือกเวลาแล้วกดปุ่ม "บันทึกเป็นเวลาเริ่มต้น" หรือ "เฉพาะครั้งนี้"' });

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
            .setTitle('🔄 แก้ไขเวลาแจ้งเตือน MVP - ROMC')
            .setDescription('แก้ไขเวลาแจ้งเตือน MVP ด้านล่าง ✓ คือเวลาที่เลือกไว้แล้ว\n\nกรุณาเลือกเวลาที่คุณต้องการรับการแจ้งเตือนสำหรับ MVP')
            .setColor('#5865F2')
            .setFooter({ text: 'เลือกเวลาแล้วกดปุ่ม "บันทึกเป็นเวลาเริ่มต้น" หรือ "เฉพาะครั้งนี้"' });

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
          await message.reply('❌ เกิดข้อผิดพลาดในการแก้ไขเวลาแจ้งเตือน โปรดลองใหม่อีกครั้ง');
        }
       
      } else if (command === 'timezone') {
        try {
          // Send feedback message first so user knows something is happening
          const loadingMsg = await message.reply('⌛ กำลังเปิดเมนูตั้งค่าโซนเวลา...');
          
          // Send timezone selector
          const timezoneMsg = await sendTimezoneSelector(message.channel, message.author.id);
          
          if (!timezoneMsg) {
            await loadingMsg.edit('❌ ไม่สามารถเปิดเมนูตั้งค่าโซนเวลาได้ โปรดลองใหม่อีกครั้ง');
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
          await message.reply('❌ เกิดข้อผิดพลาดในการตั้งค่าโซนเวลา โปรดลองใหม่อีกครั้ง');
        }
      } else if (command === 'test') {
        // Test command only available in test mode
        if (!isTestMode) {
          await message.reply('❌ โหมดทดสอบยังไม่เปิดใช้งาน กรุณารันบอทด้วย `TEST_MODE=true` หรือใช้ flag `--test` เพื่อเปิดโหมดทดสอบ');
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
        const debugInfo = `**🧪 ข้อมูลเซิร์ฟเวอร์ (โหมดทดสอบ):**\n` +
          `• เวลา UTC: ${serverUtcTime}\n` +
          `• เวลาเซิร์ฟเวอร์: ${serverLocalTime}\n` +
          `• โซนเวลาเซิร์ฟเวอร์: ${serverTimezone}\n\n`;
        
        const timeArg = args[2];
        
        // If a specific time is provided, test that time
        if (timeArg) {
          const timeInfo = NOTIFICATION_TIMES.find(t => 
            t.value === timeArg || 
            t.label.toLowerCase() === timeArg.toLowerCase() ||
            t.label.toLowerCase().replace(' ', '') === timeArg.toLowerCase()
          );
          
          if (timeInfo) {
            await message.reply(`🧪 **โหมดทดสอบ**: กำลังส่งแจ้งเตือนทดสอบสำหรับเวลา ${timeInfo.label}...\n\n${debugInfo}`);
            await testNotification(userId, timeInfo.value, message.channel);
          } else {
            const availableTimes = NOTIFICATION_TIMES.map(t => `\`${t.value}\` (${t.label})`).join(', ');
            await message.reply(`❌ เวลาไม่ถูกต้อง กรุณาเลือกจาก: ${availableTimes}\n\n${debugInfo}`);
          }
        } 
        // If no time provided but user has preferences, test their first selected time
        else if (userPrefs[userId]?.times?.length > 0) {
          const timeValue = userPrefs[userId].times[0];
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          
          await message.reply(`🧪 **โหมดทดสอบ**: กำลังทดสอบแจ้งเตือนสำหรับเวลา (${timeInfo ? timeInfo.label : timeValue})...\n\n${debugInfo}`);
          await testNotification(userId, timeValue, message.channel);
        }
        // No time provided and user has no preferences
        else {
          await message.reply(`🧪 **โหมดทดสอบ**: คุณยังไม่มีเวลาที่ตั้งไว้ กำลังทดสอบด้วยเวลาเริ่มต้น 12:00 น.\n\n${debugInfo}`);
          await testNotification(userId, '12:00', message.channel);
        }

      } else if (command === 'testall') {
        // Test all command only available in test mode and for admins
        if (!isTestMode) {
          await message.reply('❌ โหมดทดสอบยังไม่เปิดใช้งาน โปรดเรียกบอทด้วย `TEST_MODE=true` หรือเพิ่ม flag `--test` เพื่อเปิดใช้งาน');
          return;
        }

        // Check if user has admin permissions
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          await message.reply('❌ ต้องมีสิทธิ์ผู้ดูแลระบบเท่านั้นถึงจะทดสอบการแจ้งเตือนได้');
          return;
        }

        const userId = message.author.id;
        await message.reply('🧪 **โหมดทดสอบ**: กำลังทดสอบแจ้งเตือนทั้งหมด...');
        
        // Test each notification time with a delay between them
        for (const timeInfo of NOTIFICATION_TIMES) {
          await testNotification(userId, timeInfo.value, message.channel, false);
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between notifications
        }
        
        await message.reply('✅ ทดสอบแจ้งเตือนทั้งหมดเสร็จเรียบร้อยแล้ว!');
        
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
            content: '❌ คุณยังไม่ได้ตั้งเวลาแจ้งเตือน', 
            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId('setup_now')
                    .setLabel('ตั้งค่าตอนนี้')
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
        let description = `**เวลาที่กำหนดไว้:**\n${timesList}\n\n` +
          `**ตั้งเป็นค่าเริ่มต้น:** ${userSettings.autoApply ? '✅ เปิดใช้งาน' : '❌ ปิดใช้งาน'}\n` +
          `**สถานะ:** ${userSettings.paused ? '⏸️ หยุดชั่วคราว' : '▶️ กำลังทำงาน'}\n` +
          `**โซนเวลา:** ${userTimezone} (เวลาท้องถิ่นของคุณ: ${currentTime})\n\n`;
        
        // Add server time information in test mode
        if (isTestMode) {
          const serverUtcTime = dayjs().utc().format('HH:mm:ss');
          const serverLocalTime = dayjs().format('HH:mm:ss');
          const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
          
          description += `**🧪 ข้อมูลเซิร์ฟเวอร์ (โหมดทดสอบ):**\n` +
            `• เวลา UTC: ${serverUtcTime}\n` +
            `• เวลาเซิร์ฟเวอร์: ${serverLocalTime}\n` +
            `• โซนเวลาเซิร์ฟเวอร์: ${serverTimezone}\n\n`;
        }
        
        description += `**คุณจะได้รับ:**\n• ⏰ แจ้งเตือนล่วงหน้า 5 นาที`;
        
        const userEmbed = new EmbedBuilder()
          .setTitle(`🔔 เวลาแจ้งเตือนของ ${message.author.username}`)
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
          
          return `• ${time.label} (อีก ${hoursUntil} ชม. ${minutesUntil} นาที)`;
        }).join('\n');
        
        // Create description
        let description = `**5 เวลาที่ MVP จะเกิดถัดไป:**\n${timesList}\n\n` +
          `**โซนเวลาของคุณ:** ${userTimezone}\n` + 
          `**เวลาท้องถิ่นของคุณ:** ${dayjs().tz(userTimezone).format('HH:mm')}`;
        
        // Add server time information in test mode
        if (isTestMode) {
          const serverUtcTime = dayjs().utc().format('HH:mm:ss');
          const serverLocalTime = dayjs().format('HH:mm:ss');
          const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
          
          description += `\n\n**🧪 ข้อมูลเซิร์ฟเวอร์ (โหมดทดสอบ):**\n` +
            `• เวลา UTC: ${serverUtcTime}\n` +
            `• เวลาเซิร์ฟเวอร์: ${serverLocalTime}\n` +
            `• โซนเวลาเซิร์ฟเวอร์: ${serverTimezone}`;
        }
        
        const scheduleEmbed = new EmbedBuilder()
          .setTitle('🕒 เวลาเกิด MVP ที่จะมาถึงเร็วๆ นี้')
          .setDescription(description)
          .setColor('#5865F2')
          .setFooter({ text: 'ROMC MVP Notification System' });
        
        await message.reply({ embeds: [scheduleEmbed] });
        
      } else if (command === 'reload') {
        // Reload all notifications with updated timezone logic
        try {
          const loadingMsg = await message.reply('⌛ กำลังรีโหลดการแจ้งเตือนทั้งหมด...');
          
          // Restart all notifications
          await setupNotifications();
          
          const reloadEmbed = new EmbedBuilder()
            .setTitle('🔄 รีโหลดการแจ้งเตือนเสร็จสิ้น')
            .setDescription('✅ การแจ้งเตือนทั้งหมดได้รับการรีโหลดด้วยการแก้ไขโซนเวลาล่าสุดแล้ว\n\nการแจ้งเตือนจะแสดงเวลาที่ถูกต้องตามโซนเวลาของคุณ')
            .setColor('#00FF00')
            .setFooter({ text: 'ROMC MVP Notification System' });
          
          await loadingMsg.edit({ content: '', embeds: [reloadEmbed] });
          
        } catch (err) {
          console.error('Error reloading notifications:', err);
          await message.reply('❌ เกิดข้อผิดพลาดในการรีโหลดการแจ้งเตือน โปรดลองใหม่อีกครั้ง');
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
          .setTitle('🛑 การแจ้งเตือนถูกหยุดแล้ว')
          .setDescription('เวลาการแจ้งเตือนทั้งหมดของคุณถูกลบและการแจ้งเตือนถูกปิดเรียบร้อยแล้ว')
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
          await message.reply('❌ คุณยังไม่ได้ตั้งเวลาแจ้งเตือน โปรดใช้คำสั่ง `!romc-mvp setup` เพื่อกำหนดเวลาของคุณ');
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
          .setTitle('⏸️ หยุดการแจ้งเตือนชั่วคราว')
          .setDescription('⏸️ การแจ้งเตือนถูกหยุดชั่วคราวแล้ว\nใช้คำสั่ง `!romc-mvp resume` เพื่อกลับมาใช้งานอีกครั้ง')
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
          await message.reply('❌ คุณยังไม่ได้ตั้งเวลาแจ้งเตือน โปรดใช้คำสั่ง `!romc-mvp setup` เพื่อกำหนดเวลาของคุณ');
          return;
        }
        
        if (!userPrefs[userId].paused) {
          await message.reply('▶️ เปิดการแจ้งเตือนอีกครั้งเรียบร้อยแล้ว');
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
          .setTitle('▶️ เริ่มการแจ้งเตือนอีกครั้ง')
          .setDescription('การแจ้งเตือนของคุณกลับมาใช้งานได้แล้ว')
          .setColor('#00FF00');
        
        await message.reply({ embeds: [resumeEmbed] });
        
      } else if (message.mentions.users.size > 0) {
        // Show mentioned user's notification times
        const mentionedUser = message.mentions.users.first();
        const userPrefs = await loadUserPreferences();
        const userSettings = userPrefs[mentionedUser.id];
        
        if (!userSettings || !userSettings.times || !userSettings.times.length) {
          await message.reply(`❌ ${mentionedUser.username} ไม่มีเวลาแจ้งเตือนที่ตั้งไว้`);
          return;
        }
        
        const timesList = userSettings.times.map(timeValue => {
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          return `• ${timeInfo ? timeInfo.label : timeValue}`;
        }).join('\n');
        
        // Get user's timezone
        const userTimezone = userSettings.timezone || DEFAULT_TIMEZONE;
        
        const mentionedUserEmbed = new EmbedBuilder()
          .setTitle(`🔔 เวลาแจ้งเตือนของ ${mentionedUser.username}`)
          .setDescription(
            `**เวลาที่ตั้งไว้:**\n${timesList}\n\n` +
            `**ตั้งเป็นค่าเริ่มต้น:** ${userSettings.autoApply ? '✅ เปิดใช้งาน' : '❌ ปิดใช้งาน'}\n` +
            `**สถานะ:** ${userSettings.paused ? '⏸️ หยุดชั่วคราว' : '▶️ กำลังทำงาน'}\n` +
            `**โซนเวลา:** ${userTimezone}`
          )
          .setColor('#FFA500')
          .setThumbnail(mentionedUser.displayAvatarURL());
        
        await message.reply({ embeds: [mentionedUserEmbed] });
        
      } else if (command === 'admin') {
        // Admin commands - require administrator permissions
        if (!message.member?.permissions?.has('Administrator')) {
          await message.reply('❌ คำสั่งนี้ต้องการสิทธิ์ผู้ดูแลระบบเท่านั้น');
          return;
        }
        
        const subCommand = args[2];
        
        if (subCommand === 'list') {
          // List all notifications in the system
          try {
            const userPrefs = await loadUserPreferences();
            const allUsers = Object.entries(userPrefs);
            
            if (allUsers.length === 0) {
              await message.reply('📋 ไม่มีผู้ใช้ที่ตั้งการแจ้งเตือนในระบบ');
              return;
            }
            
            // Filter users who have notifications
            const usersWithNotifications = allUsers.filter(([userId, prefs]) => 
              prefs.times && prefs.times.length > 0
            );
            
            if (usersWithNotifications.length === 0) {
              await message.reply('📋 ไม่มีผู้ใช้ที่มีการแจ้งเตือนที่ใช้งานอยู่');
              return;
            }
            
            // Get page number from args (default to 1)
            const pageArg = args[3];
            const requestedPage = pageArg ? parseInt(pageArg, 10) : 1;
            
            // Create embed with all users and their notifications
            const embed = new EmbedBuilder()
              .setTitle('🔒 การแจ้งเตือนทั้งหมดในระบบ (Admin)')
              .setColor('#FF6B35')
              .setFooter({ text: `รวม ${usersWithNotifications.length} ผู้ใช้ | ROMC MVP Notification System` });
            
            // Split into chunks if too many users
            const maxUsersPerPage = 8;
            const totalPages = Math.ceil(usersWithNotifications.length / maxUsersPerPage);
            const currentPage = Math.max(1, Math.min(requestedPage, totalPages));
            
            const startIndex = (currentPage - 1) * maxUsersPerPage;
            const endIndex = Math.min(startIndex + maxUsersPerPage, usersWithNotifications.length);
            const usersToShow = usersWithNotifications.slice(startIndex, endIndex);
            
            let description = `แสดงหน้า ${currentPage}/${totalPages}\n\n`;
            
            for (const [userId, prefs] of usersToShow) {
              try {
                // Try to get user info
                const user = await client.users.fetch(userId).catch(() => null);
                const username = user ? user.username : `Unknown User (${userId})`;
                
                const timesList = prefs.times.map(timeValue => {
                  const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
                  return timeInfo ? timeInfo.label : timeValue;
                }).join(', ');
                
                const status = prefs.paused ? '⏸️ หยุดชั่วคราว' : '▶️ ใช้งาน';
                const autoApply = prefs.autoApply ? '✅' : '❌';
                const timezone = prefs.timezone || DEFAULT_TIMEZONE;
                
                description += `**${username}** (<@${userId}>)\n`;
                description += `• เวลา: ${timesList}\n`;
                description += `• สถานะ: ${status} | ค่าเริ่มต้น: ${autoApply}\n`;
                description += `• โซนเวลา: ${timezone}\n\n`;
                
              } catch (err) {
                console.error(`Error fetching user ${userId}:`, err);
                description += `**Unknown User** (${userId})\n`;
                description += `• เวลา: ${prefs.times.join(', ')}\n`;
                description += `• สถานะ: ${prefs.paused ? '⏸️ หยุดชั่วคราว' : '▶️ ใช้งาน'}\n\n`;
              }
            }
            
            if (totalPages > 1) {
              description += `\n*หมายเหตุ: ใช้ \`!romc-mvp admin list [หน้า]\` เพื่อดูหน้าอื่น (1-${totalPages})*`;
            }
            
            embed.setDescription(description);
            await message.reply({ embeds: [embed] });
            
          } catch (err) {
            console.error('Error listing all notifications:', err);
            await message.reply('❌ เกิดข้อผิดพลาดในการดึงข้อมูลการแจ้งเตือน');
          }
          
        } else if (subCommand === 'remove') {
          // Remove notifications for a specific user
          if (message.mentions.users.size === 0) {
            await message.reply('❌ กรุณาระบุผู้ใช้ที่ต้องการลบการแจ้งเตือน เช่น `!romc-mvp admin remove @user`');
            return;
          }
          
          const targetUser = message.mentions.users.first();
          const targetUserId = targetUser.id;
          
          try {
            const userPrefs = await loadUserPreferences();
            
            if (!userPrefs[targetUserId] || !userPrefs[targetUserId].times || userPrefs[targetUserId].times.length === 0) {
              await message.reply(`❌ ${targetUser.username} ไม่มีการแจ้งเตือนที่ตั้งไว้`);
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
              .setTitle('🔒 ลบการแจ้งเตือนเสร็จสิ้น (Admin)')
              .setDescription(
                `✅ ลบการแจ้งเตือนของ **${targetUser.username}** เรียบร้อยแล้ว\n\n` +
                `**เวลาที่ถูกลบ:**\n${removedTimes.map(time => `• ${time}`).join('\n')}`
              )
              .setColor('#FF0000')
              .setThumbnail(targetUser.displayAvatarURL())
              .setFooter({ text: 'ROMC MVP Notification System' });
            
            await message.reply({ embeds: [embed] });
            
          } catch (err) {
            console.error('Error removing user notifications:', err);
            await message.reply('❌ เกิดข้อผิดพลาดในการลบการแจ้งเตือน');
          }
          
        } else if (subCommand === 'clear') {
          // Clear all notifications in the system
          try {
            const userPrefs = await loadUserPreferences();
            const allUsers = Object.entries(userPrefs);
            
            if (allUsers.length === 0) {
              await message.reply('📋 ไม่มีการแจ้งเตือนในระบบที่จะลบ');
              return;
            }
            
            // Count users with notifications before clearing
            const usersWithNotifications = allUsers.filter(([userId, prefs]) => 
              prefs.times && prefs.times.length > 0
            ).length;
            
            if (usersWithNotifications === 0) {
              await message.reply('📋 ไม่มีการแจ้งเตือนที่ใช้งานอยู่ในระบบ');
              return;
            }
            
            // Ask for confirmation
            const confirmEmbed = new EmbedBuilder()
              .setTitle('⚠️ ยืนยันการลบการแจ้งเตือนทั้งหมด')
              .setDescription(
                `คุณกำลังจะลบการแจ้งเตือนของผู้ใช้ทั้งหมด **${usersWithNotifications} คน** ในระบบ\n\n` +
                `**การดำเนินการนี้ไม่สามารถย้อนกลับได้!**\n\n` +
                `กด ✅ เพื่อยืนยัน หรือ ❌ เพื่อยกเลิก`
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
                  .setTitle('❌ ยกเลิกการลบ')
                  .setDescription('การลบการแจ้งเตือนทั้งหมดถูกยกเลิก')
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
              .setTitle('🔒 ลบการแจ้งเตือนทั้งหมดเสร็จสิ้น (Admin)')
              .setDescription(
                `✅ ลบการแจ้งเตือนของผู้ใช้ทั้งหมด **${clearedCount} คน** เรียบร้อยแล้ว\n\n` +
                `ระบบการแจ้งเตือนได้รับการรีเซ็ตเรียบร้อยแล้ว`
              )
              .setColor('#00FF00')
              .setFooter({ text: 'ROMC MVP Notification System' });
            
            await confirmMsg.edit({ embeds: [successEmbed] });
            
          } catch (err) {
            console.error('Error clearing all notifications:', err);
            await message.reply('❌ เกิดข้อผิดพลาดในการลบการแจ้งเตือนทั้งหมด');
          }
          
        } else {
          await message.reply('❌ คำสั่ง admin ไม่ถูกต้อง\nใช้: `!romc-mvp admin list`, `!romc-mvp admin remove @user`, หรือ `!romc-mvp admin clear`');
        }
        
      } else {
        // Unknown command
        await message.reply('❌ ไม่พบคำสั่งนี้\nกรุณาใช้คำสั่ง `!romc-mvp` เพื่อดูรายการคำสั่งที่สามารถใช้งานได้ทั้งหมด');
      }
      
    } catch (err) {
      console.error('Error handling notifications command:', err);
      await message.reply('❌ เกิดข้อผิดพลาดในการประมวลผลคำสั่งของคุณ');
    }
  }
});

// Login to Discord with a check for disabled status
client.login(process.env.BOT_TOKEN);