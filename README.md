# Autobot – WhatsApp helper

Simple WhatsApp automation bot powered by [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys). Use it to bootstrap quick automations or prototype conversational flows on top of your WhatsApp account.

## Prerequisites

- Node.js 18+ and npm
- WhatsApp account you can pair via QR code

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the sample env file and tweak values as needed:
   ```bash
   cp env.example .env
   ```
   - `AUTH_FOLDER`: where Baileys stores session files (`./auth_info` by default)
   - `LOG_LEVEL`: `info`, `debug`, etc. forwarded to `pino`
   - `BUSINESS_NAME`, `BUSINESS_HOURS`, `BUSINESS_LOCATION`, `BUSINESS_PHONE`, `BUSINESS_EMAIL`, `BUSINESS_SITE`, `BUSINESS_ORDER_LINK`: optional overrides for business commands
   - `PERSONAL_INTRO`, `PERSONAL_AWAY_MESSAGE`, `PERSONAL_AWAY_COOLDOWN_MINUTES`, `PERSONAL_GREETINGS`: personalize the non-business helpers
3. Start the bot:
   ```bash
   npm start
   ```
4. Scan the QR code shown in the terminal with WhatsApp → Linked Devices. Once paired, the bot stays online and automatically reconnects whenever possible. Delete the `auth_info` folder to force a fresh login.

## Commands

Type `.help` in any chat to see all available commands. Here's what the bot can do:

### Fun Commands
- `.joke` - Get a random joke
- `.8ball <question>` - Ask the magic 8-ball a question
- `.dice` - Roll a dice (1-6)
- `.flip` - Flip a coin (heads/tails)
- `.random <min> <max>` - Generate a random number between min and max

### Group Commands
- `.tagall [message]` - Tag all group members (optionally with a custom message)
- `.info` - Get group or user information
- `.kick @user` - Kick a user from the group (admin only)
- `.promote @user` - Promote a user to admin (admin only)
- `.demote @user` - Demote an admin (admin only)
- `.poll <question> | <option1> | <option2> | ...` - Create a poll with 2-12 options

### Utility Commands
- `.time` - Get current date and time
- `.quote` - Quote a replied message
- `.sticker` - Convert an image to sticker (reply to an image)
- `.ping` - Test bot response (also responds to just `ping`)

### Personal Commands
- `.intro` - Share your configured personal intro
- `.greet` - Send a random greeting from your list
- `.away on/off/status [message]` - Toggle automatic away replies (personal chats only)
- `.back` - Quick way to disable away replies

### Business Commands
- `.hours` - Share your hours, location, contact info
- `.services` / `.catalog` - Show the configured service list
- `.price <service>` - Return price/details for a service key or keyword
- `.order <service>` - Send booking steps plus your order/contact link
- `.invoice <client> | <service> | <amount>` - Draft a quick invoice text block
- `.faq` - Send common QA entries
- `.contact` - Send a mini contact card

### Automatic Features
- **Auto-view status updates** 👀 - Automatically marks all new contact statuses as viewed so they appear as read from your account
- **Personal away replies** 📴 - When `.away on` is active, the bot auto-responds to direct chats every cooldown window so friends know you’re unavailable
- **Auto-greeting replies** 💬 - Instantly responds to common greetings like "Hi", "Hello", "Howfar", "Good morning", etc. in direct chats (not groups)

## Examples

```
You: .joke
Bot: Why don't scientists trust atoms? Because they make up everything! 😂

You: .8ball Will I pass my exam?
Bot: 🎱 Question: Will I pass my exam?
     Answer: It is certain 🎱

You: .poll Favorite color? | Red | Blue | Green
Bot: [Creates a poll with 3 options]

You: .tagall Meeting in 5 minutes!
Bot: [Tags everyone with your message]

Friend: Hi
Bot: Hey there! 👋

Friend: Howfar
Bot: I'm doing great, thanks for asking! How about you? 😊

Friend: Good morning
Bot: Good morning! Hope you have a great day! ☀️
```

## Notes

- All commands start with a dot (`.`) except `ping`
- Group management commands (kick, promote, demote) require admin privileges
- The bot ignores messages sent by you and empty messages
- Status auto-viewing works automatically - no command needed

Feel free to expand the logic inside `src/index.js` with your own routing, command handling, or integrations. Refer to the Baileys documentation for advanced features (media, buttons, groups, etc.).

