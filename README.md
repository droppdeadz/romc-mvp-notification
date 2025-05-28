# ROMC MVP Discord Notification Bot

A Discord bot that sends timed notifications to users based on their preferences for ROMC MVP, with full timezone support and customizable scheduling.

## 🌟 Features

- **Personal Notification Setup**: Individual users can set their own notification preferences
- **16 Available Time Slots**: Comprehensive coverage throughout the day with 1.5-hour intervals
- **Timezone Support**: Customizable timezone settings with automatic time conversion
- **5-Minute Early Warnings**: Notifications sent 5 minutes before each MVP spawn
- **Auto-Apply Option**: Users can save preferences to automatically apply daily
- **Pause/Resume**: Temporarily disable notifications without losing settings
- **Admin Controls**: Administrative commands for managing all users
- **Test Mode**: Built-in testing functionality for development and debugging

## 📋 Available Notification Times

The bot supports 16 notification times throughout the day:
- **00:00** (12:00 AM), **01:30** (1:30 AM), **03:00** (3:00 AM), **04:30** (4:30 AM)
- **06:00** (6:00 AM), **07:30** (7:30 AM), **09:00** (9:00 AM), **10:30** (10:30 AM)
- **12:00** (12:00 PM), **13:30** (1:30 PM), **15:00** (3:00 PM), **16:30** (4:30 PM)
- **18:00** (6:00 PM), **19:30** (7:30 PM), **21:00** (9:00 PM), **22:30** (10:30 PM)

*All times are displayed in Thai format (น.) and automatically converted to your local timezone.*

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
git clone <repository-url>
cd discord-bot
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:

```env
# Discord Bot Configuration (REQUIRED)
BOT_TOKEN=your_discord_bot_token_here
NOTIFICATION_CHANNEL_ID=your_channel_id_here

# Timezone Setting (Optional - defaults to Asia/Bangkok)
DEFAULT_TIMEZONE=Asia/Bangkok

# Test Mode (Optional - for development)
# TEST_MODE=true
```

### 3. Getting Required Values

#### Discord Bot Token
1. Visit the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Navigate to the "Bot" section
4. Copy the bot token
5. **Important**: Enable "Message Content Intent" in the Bot settings

#### Channel ID
1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
2. Right-click on your target notification channel
3. Select "Copy ID"
4. Use this ID as your `NOTIFICATION_CHANNEL_ID`

#### Bot Permissions
Ensure your bot has these permissions in the notification channel:
- View Channel
- Send Messages
- Use External Emojis
- Add Reactions

### 4. Start the Bot
```bash
# Production
npm start

# Development (with auto-restart)
npm run dev

# Test mode
npm run test-mode
```

## 🌍 Timezone Configuration

### Setting Your Timezone
Use the following command in Discord:
```
!romc-mvp timezone
```

This opens a dropdown menu with common timezone options. All notifications and time displays will respect your configured timezone.

### Supported Timezones
- `Asia/Bangkok` - Thailand (ICT) - **Default**
- `Asia/Tokyo` - Japan (JST)
- `Asia/Singapore` - Singapore (SGT)
- `Asia/Seoul` - South Korea (KST)
- `Europe/London` - UK (GMT/BST)
- `Europe/Paris` - France (CET/CEST)
- `America/New_York` - Eastern US (EST/EDT)
- `America/Los_Angeles` - Pacific US (PST/PDT)
- `Australia/Sydney` - Australia Eastern (AEST/AEDT)
- `UTC` - Universal Coordinated Time

For additional timezones, refer to the [IANA Time Zone Database](https://www.iana.org/time-zones).

## 💬 Bot Commands

### User Commands
| Command | Description |
|---------|-------------|
| `!romc-mvp` | Show help message with all available commands |
| `!romc-mvp setup` | Set up or modify your notification times |
| `!romc-mvp edit` | Edit your existing notification times |
| `!romc-mvp me` | View your current notification settings |
| `!romc-mvp timezone` | Set your preferred timezone |
| `!romc-mvp schedule` | View upcoming MVP spawn times |
| `!romc-mvp reload` | Reload notifications with updated timezone |
| `!romc-mvp stop` | Remove all your notifications |
| `!romc-mvp pause` | Temporarily pause your notifications |
| `!romc-mvp resume` | Resume paused notifications |
| `!romc-mvp @user` | View another user's notification settings |

### Admin Commands (Requires Administrator Permission)
| Command | Description |
|---------|-------------|
| `!romc-mvp admin list [page]` | View all users with notifications |
| `!romc-mvp admin remove @user` | Remove a specific user's notifications |
| `!romc-mvp admin clear` | Clear all notifications in the system |

### Test Commands (Test Mode Only)
| Command | Description |
|---------|-------------|
| `!romc-mvp test [time]` | Test notification for specific time |
| `!romc-mvp debug` | Show debug information |

## 🔧 Technical Details

- **Framework**: Discord.js v14 with Node.js
- **Timezone Handling**: dayjs library with timezone plugin
- **Scheduling**: node-cron for precise timing
- **Data Storage**: JSON file-based user preferences (`data/user_preferences.json`)
- **User Preferences**: Individual timezone, notification times, auto-apply settings, and pause status
- **Cron Scheduling**: Automatic conversion of cron expressions to match user timezones
- **Early Warnings**: 5-minute early notifications with time conversion display

## 🧪 Testing Your Setup

1. Create your `.env` file with actual values
2. Enable test mode:
   ```bash
   npm run test-mode
   ```
3. Use `!romc-mvp test` in Discord to verify notifications work correctly
4. Check `!romc-mvp debug` for system information

## 🚨 Troubleshooting

### Bot Not Sending Notifications
**Most common issue**: Missing or incorrect environment variables

**Solution**:
1. Verify your `.env` file exists in the project root
2. Check that `BOT_TOKEN` and `NOTIFICATION_CHANNEL_ID` are correctly set
3. Ensure the bot has proper permissions in the target channel
4. Restart the bot after making changes

### Bot Disabled Messages
- `BOT_TOKEN=DISABLED` - Bot will not start
- `NOTIFICATION_CHANNEL_ID=DISABLED` - Notifications will be disabled

### Example Working `.env` File
```env
BOT_TOKEN=YOUR_BOT_TOKEN_HERE
NOTIFICATION_CHANNEL_ID=1234567890123456789
DEFAULT_TIMEZONE=Asia/Bangkok
TEST_MODE=true
```

## 📝 Usage Flow

1. **Setup**: Use `!romc-mvp setup` to configure your notification times
2. **Timezone**: Set your timezone with `!romc-mvp timezone` for accurate local times
3. **Auto-Apply**: Choose whether to save settings as default or one-time use
4. **Notifications**: Receive 5-minute early warnings at your selected times
5. **Management**: Use `!romc-mvp pause`/`resume` to temporarily control notifications
6. **Viewing**: Check upcoming spawns with `!romc-mvp schedule`

## 🔄 Development

### Available Scripts
```bash
npm start          # Production mode
npm run dev        # Development with nodemon
npm run test-mode  # Test mode with manual triggers
```

### Dependencies
- `discord.js` - Discord API wrapper
- `dayjs` - Date/time manipulation with timezone support
- `node-cron` - Task scheduling
- `dotenv` - Environment variable management

### Data Structure
User preferences are stored in `data/user_preferences.json`:
```json
{
  "userId": {
    "times": ["18:00", "21:00"],
    "autoApply": true,
    "paused": false,
    "timezone": "Asia/Bangkok",
    "scheduledJobs": [],
    "lastSetupMessageId": null
  }
}
```

The bot includes comprehensive logging and error handling for easier debugging and maintenance.