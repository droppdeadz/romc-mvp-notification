# Timezone Support Added

The bot now supports customizable timezones:

1. Use `!romc-mvp timezone` to set your timezone
2. Default timezone is Asia/Bangkok (can be changed in .env file via DEFAULT_TIMEZONE variable)
3. Notifications will be sent according to your configured timezone
4. Time calculations in schedule view also respect your timezone

## Usage

```
!romc-mvp timezone
```

This command will open a dropdown menu allowing you to select from common timezones. 
If your timezone is not in the list, you can add it to the COMMON_TIMEZONES array in the code.

## Technical Details

- Uses dayjs for timezone handling
- Timezone is stored in user preferences
- Cron expressions are converted to match the user's timezone
- The 5-minute early warning notifications will display the user's local time
- Requires the dayjs package and its timezone plugin

## Environment Variables

You can set a default timezone by adding to your .env file:

```
# Bot Configuration
BOT_TOKEN=your_discord_bot_token_here
NOTIFICATION_CHANNEL_ID=your_channel_id_here

# Timezone Setting (NEW)
DEFAULT_TIMEZONE=Asia/Bangkok

# Test Mode (optional)
# TEST_MODE=true
```

Replace Asia/Bangkok with any valid IANA timezone identifier.

## Common Timezone Values

- `Asia/Bangkok` - Thailand (ICT)
- `Asia/Tokyo` - Japan (JST)
- `Europe/London` - UK (GMT/BST)
- `America/New_York` - Eastern US (EST/EDT)
- `America/Los_Angeles` - Pacific US (PST/PDT)
- `Australia/Sydney` - Australia Eastern (AEST/AEDT)
- `Asia/Singapore` - Singapore (SGT)
- `UTC` - Universal Coordinated Time

For a complete list of timezone identifiers, see the [IANA Time Zone Database](https://www.iana.org/time-zones). 