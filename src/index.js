require('dotenv').config();

// Check if essential environment variables are disabled
const isBotDisabled = process.env.BOT_TOKEN === 'DISABLED';
const isChannelDisabled = process.env.NOTIFICATION_CHANNEL_ID === 'DISABLED';
const isTestMode = process.env.TEST_MODE === 'true' || process.argv.includes('--test');

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
  { label: '00:00 น.', value: '00:00', cronTime: '0 0 * * *', earlyWarningCron: '55 23 * * *' },
  { label: '01:30 น.', value: '01:30', cronTime: '30 1 * * *', earlyWarningCron: '25 1 * * *' },
  { label: '03:00 น.', value: '03:00', cronTime: '0 3 * * *', earlyWarningCron: '55 2 * * *' },
  { label: '04:30 น.', value: '04:30', cronTime: '30 4 * * *', earlyWarningCron: '25 4 * * *' },
  { label: '06:00 น.', value: '06:00', cronTime: '0 6 * * *', earlyWarningCron: '55 5 * * *' },
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

// Function to send a notification to a user
async function sendNotificationToUser(userId, timeLabel, isEarlyWarning = true) {
  try {
    const userPrefs = await loadUserPreferences();
    
    // Skip if user has paused notifications
    if (userPrefs[userId]?.paused) return;
    
    const channel = await client.channels.fetch(process.env.NOTIFICATION_CHANNEL_ID);
    if (channel) {
      // Always send message to channel with user mention
      const message = `<@${userId}>\n⏰ **แจ้งเตือนล่วงหน้า 5 นาที**: MVP กำลังจะเกิดในเวลา ${timeLabel}! อย่าลืมเตรียมตัวให้พร้อมนะ!`;
      
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

// Send daily notification selector
async function sendDailySelector(channel, userId = null, isEditing = false) {
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
        embedDescription += `• ${userPrefs[userId].paused ? '⏸️ การแจ้งเตือนถูกพักไว้' : '▶️ กำลังแจ้งเตือนตามปกติ'}\n\n`;
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
      
      // Schedule 5-minute early warning only
      const earlyWarningJob = cron.schedule(timeInfo.earlyWarningCron, async () => {
        await sendNotificationToUser(userId, timeInfo.label, true);
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
    await sendNotificationToUser(userId, timeInfo.label, true);
    
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
      .setDescription(`✅ **เมนูเลือกเวลา**\n\nเลือกเวลาการแจ้งเตือนของคุณโดยเลือกจากรายการด้านล่าง`)
      .setColor('#5865F2');
    
    // Update the original message with a generic notice
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
      .setTitle(`🔔 เวลาแจ้งเตือนของคุณ`)
      .setDescription(
        `**เวลาที่คุณเลือก:**\n${timesList}\n\n` +
        (timeChangeInfo ? `**การเปลี่ยนแปลง:**\n${timeChangeInfo}\n` : '') +
        `**คุณจะได้รับ:**\n• ⏰ แจ้งเตือนล่วงหน้า 5 นาที\n\nเลือกระหว่าง "บันทึกเป็นเวลาเริ่มต้น" หรือ "เฉพาะครั้งนี้" ในช่องที่คุณส่งข้อความ`
      )
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
          ? '✅ บันทึกการตั้งค่าของคุณเป็นค่าเริ่มต้นเรียบร้อยแล้ว ระบบจะใช้เวลาเหล่านี้ในการแจ้งเตือนทุกวัน' 
          : '✅ บันทึกการตั้งค่าของคุณสำหรับวันนี้เรียบร้อยแล้ว การตั้งค่าจะถูกรีเซ็ตในวันพรุ่งนี้',
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
    } else if (interaction.customId === 'setup_now') {
      try {
        // Send feedback message first so user knows something is happening
        await interaction.reply({
          content: '⌛ กำลังเปิดเมนูตั้งค่าเวลาแจ้งเตือน...',
          ephemeral: true
        });
        
        // Send notification selection menu
        const setupMsg = await sendDailySelector(interaction.channel, interaction.user.id, false);
        
        if (!setupMsg) {
          await interaction.editReply({
            content: '❌ ไม่สามารถตั้งค่าเมนูแจ้งเตือนได้ โปรดลองใหม่อีกครั้ง',
            ephemeral: true
          });
          return;
        }
        
        // Update the reply with success message
        await interaction.editReply({
          content: '✅ เปิดเมนูตั้งค่าแล้ว กรุณาเลือกเวลาที่ต้องการรับการแจ้งเตือน',
          ephemeral: true
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
          ephemeral: true
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
            { name: '`!romc-mvp schedule`', value: 'ดูเวลาการเกิด MVP ถัดไป', inline: false },
            { name: '`!romc-mvp stop`', value: 'ยกเลิกการแจ้งเตือนทั้งหมด', inline: false },
            { name: '`!romc-mvp pause`', value: 'หยุดการแจ้งเตือนชั่วคราว', inline: false },
            { name: '`!romc-mvp resume`', value: 'เริ่มการแจ้งเตือนอีกครั้ง', inline: false },
            { name: '`!romc-mvp @user`', value: 'ดูเวลาการแจ้งเตือนของผู้ใช้ที่ถูกกล่าวถึง', inline: false },
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
          
          // Send different loading message based on whether user exists
          const loadingMsg = await message.reply(
            userExists 
              ? '⌛ กำลังเปิดเมนูแก้ไขเวลาแจ้งเตือนของคุณ...' 
              : '⌛ กำลังตั้งค่าเมนูแจ้งเตือน...'
          );

          // Send notification selection menu with isEditing flag if user exists
          const setupMsg = await sendDailySelector(message.channel, message.author.id, userExists);
          
          if (!setupMsg) {
            await loadingMsg.edit('❌ ไม่สามารถตั้งค่าเมนูแจ้งเตือนได้ โปรดลองใหม่อีกครั้ง');
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
            
            // Open setup menu instead
            const setupMsg = await sendDailySelector(message.channel, message.author.id);
            
            if (!setupMsg) {
              await message.reply('❌ ไม่สามารถตั้งค่าเมนูแจ้งเตือนได้ โปรดลองใหม่อีกครั้ง');
            }
            
            // Delete the command message to keep the channel clean
            await message.delete().catch(err => {
              console.error(`Error deleting command message: ${err}`);
            });
            
            return;
          }
          
          // Send feedback message first so user knows something is happening
          const loadingMsg = await message.reply('⌛ กำลังเปิดเมนูแก้ไขเวลาแจ้งเตือน...');
          
          // Send edit selector with isEditing flag set to true
          const editMsg = await sendDailySelector(message.channel, message.author.id, true);
          
          if (!editMsg) {
            await loadingMsg.edit('❌ ไม่สามารถเปิดเมนูแก้ไขได้ โปรดลองใหม่อีกครั้ง');
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
          console.error(`Error in edit command: ${err}`);
          await message.reply('❌ เกิดข้อผิดพลาดในการแก้ไขเวลาแจ้งเตือน โปรดลองใหม่อีกครั้ง');
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
        
        const timeArg = args[2];
        
        // If a specific time is provided, test that time
        if (timeArg) {
          const timeInfo = NOTIFICATION_TIMES.find(t => 
            t.value === timeArg || 
            t.label.toLowerCase() === timeArg.toLowerCase() ||
            t.label.toLowerCase().replace(' ', '') === timeArg.toLowerCase()
          );
          
          if (timeInfo) {
            await message.reply(`🧪 **โหมดทดสอบ**: กำลังส่งแจ้งเตือนทดสอบสำหรับเวลา ${timeInfo.label}...`);
            await testNotification(userId, timeInfo.value, message.channel);
          } else {
            const availableTimes = NOTIFICATION_TIMES.map(t => `\`${t.value}\` (${t.label})`).join(', ');
            await message.reply(`❌ เวลาไม่ถูกต้อง กรุณาเลือกจาก: ${availableTimes}`);
          }
        } 
        // If no time provided but user has preferences, test their first selected time
        else if (userPrefs[userId]?.times?.length > 0) {
          const timeValue = userPrefs[userId].times[0];
          const timeInfo = NOTIFICATION_TIMES.find(t => t.value === timeValue);
          
          await message.reply(`🧪 **โหมดทดสอบ**: กำลังทดสอบแจ้งเตือนสำหรับเวลา (${timeInfo ? timeInfo.label : timeValue})...`);
          await testNotification(userId, timeValue, message.channel);
        }
        // No time provided and user has no preferences
        else {
          await message.reply(`🧪 **โหมดทดสอบ**: คุณยังไม่มีเวลาที่ตั้งไว้ กำลังทดสอบด้วยเวลาเริ่มต้น 12:00 น.`);
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
        
        const userEmbed = new EmbedBuilder()
          .setTitle(`🔔 เวลาแจ้งเตือนของ ${message.author.username}`)
          .setDescription(
            `**เวลาที่กำหนดไว้:**\n${timesList}\n\n` +
            `**ตั้งเป็นค่าเริ่มต้น:** ${userSettings.autoApply ? '✅ เปิดใช้งาน' : '❌ ปิดใช้งาน'}\n` +
            `**สถานะ:** ${userSettings.paused ? '⏸️ หยุดชั่วคราว' : '▶️ กำลังทำงาน'}\n\n` +
            `**คุณจะได้รับ:**\n• ⏰ แจ้งเตือนล่วงหน้า 5 นาที`
          )
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
          
          return `• ${time.label} (อีก ${hoursUntil} ชม. ${minutesUntil} นาที)`;
        }).join('\n');
        
        const scheduleEmbed = new EmbedBuilder()
          .setTitle('🕒 เวลาเกิด MVP ที่จะมาถึงเร็วๆ นี้')
          .setDescription(`**5 เวลาที่ MVP จะเกิดถัดไป:**\n${timesList}`)
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
        
        const mentionedUserEmbed = new EmbedBuilder()
          .setTitle(`🔔 เวลาแจ้งเตือนของ ${mentionedUser.username}`)
          .setDescription(`**เวลาที่ตั้งไว้:**\n${timesList}\n\n**ตั้งเป็นค่าเริ่มต้น:** ${userSettings.autoApply ? '✅ เปิดใช้งาน' : '❌ ปิดใช้งาน'}\n**สถานะ:** ${userSettings.paused ? '⏸️ หยุดชั่วคราว' : '▶️ กำลังทำงาน'}`)
          .setColor('#FFA500')
          .setThumbnail(mentionedUser.displayAvatarURL());
        
        await message.reply({ embeds: [mentionedUserEmbed] });
        
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