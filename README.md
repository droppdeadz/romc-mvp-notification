# ROMC MVP Notification

A Discord bot that sends timed notifications to users based on their preferences for ROMC MVP.

## Features

- Daily notification selection message at 8:00 AM
- Users can select multiple notification times
- Option to auto-apply selections for the next day
- Manual trigger for notification selection with `!notifications` command

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   BOT_TOKEN=your_discord_bot_token_here
   NOTIFICATION_CHANNEL_ID=your_channel_id_here
   ```
   - To get a bot token, create a new application at [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable the "Message Content Intent" in the Bot settings
   - Get your channel ID by right-clicking on a channel and selecting "Copy ID" (Developer Mode must be enabled)

4. Start the bot:
   ```
   npm start
   ```
   Or for development with auto-restart:
   ```
   npm run dev
   ```

## Usage

- Every day at 8:00 AM, the bot will send a selection message in the configured channel
- Users can select which times they want to be notified
- Users can choose to auto-apply their selections for the next day
- Type `!notifications` in any channel to manually trigger the selection message

## Notification Times

The bot supports the following notification times:
- 10:30 AM
- 12:00 PM
- 1:30 PM
- 3:00 PM
- 4:30 PM
- 6:00 PM
- 7:30 PM
- 9:00 PM
- 10:30 PM
- 12:00 AM
- 1:30 AM
- 3:00 AM
- 4:30 AM
- 6:00 AM
- 7:30 AM
- 9:00 AM 