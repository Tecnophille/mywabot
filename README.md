# Autobot – WhatsApp AI Assistant

An intelligent WhatsApp automation bot powered by [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) with AI-powered reply generation using Google Gemini. Automate your WhatsApp conversations with smart auto-replies, status tracking, and comprehensive command support.

## ✨ Key Features

### 🤖 AI-Powered Intelligence
- **Smart Reply Generation** - Uses Google Gemini AI to analyze messages and generate contextual, natural replies
- **Status Reply Detection** - Automatically detects when someone replies to your status updates and responds intelligently
- **Context-Aware Responses** - Understands conversation context, including status updates and previous messages
- **Multi-Provider Support** - Supports Google Gemini (default), OpenAI, and Anthropic Claude APIs

### 📱 Status Management
- **Auto-View Status Updates** - Automatically marks all contact statuses as viewed
- **Status Tracking** - Tracks all your posted status updates (text, images, videos)
- **Status Sharing** - Share your latest status with `.status` command or when requested
- **Smart Status Replies** - Detects replies to your status and responds contextually

### 💬 Intelligent Auto-Replies (35+ Contexts)
The bot automatically responds to messages in direct chats with natural, contextual replies:

**Greetings & Check-ins:**
- Greetings (Hi, Hello, Hey, etc.)
- What's up variations (Sup, Wassup, etc.)
- Casual check-ins (How's it going?, What's new?, etc.)
- Time-based greetings (Good morning, Good afternoon, Good evening, Good night)

**Social Interactions:**
- Thank you messages
- Goodbyes and farewells
- Compliments and congratulations
- Apologies and acknowledgments
- Excitement and enthusiasm
- Agreement and disagreement

**Conversational:**
- Casual reactions (Lol, Haha, Lmao, etc.)
- Casual slang (Bet, Fr, Ngl, Tbh, etc.)
- Casual expressions (Oh ok, Ah, Hmm, etc.)
- Casual compliments (Nice, Sweet, Cool, Dope, Fire, etc.)
- Casual small talk (Nice weather, Having a good day, etc.)

**Support & Inquiries:**
- Help requests
- Time/availability inquiries
- Contact/communication inquiries
- Identity questions
- Business/service inquiries
- Questions (What, When, How, etc.)

**Emotional States:**
- Confusion/clarification requests
- Surprise/disbelief
- Encouragement/motivation
- Frustration/annoyance
- Relief/satisfaction
- Boredom
- Busy status

**Activity & Engagement:**
- Activity updates (What are you doing?, etc.)
- Interest/engagement (Tell me more, Go on, etc.)
- Permission requests
- Presence checks (Are you there?, etc.)

### 🎮 Commands

#### Fun Commands
- `.joke` - Get a random joke
- `.8ball <question>` - Ask the magic 8-ball a question
- `.dice` - Roll a dice (1-6)
- `.flip` - Flip a coin (heads/tails)
- `.random <min> <max>` - Generate a random number between min and max

#### Group Commands
- `.tagall [message]` - Tag all group members (optionally with a custom message)
- `.info` - Get group or user information
- `.kick @user` - Kick a user from the group (admin only)
- `.promote @user` - Promote a user to admin (admin only)
- `.demote @user` - Demote an admin (admin only)
- `.poll <question> | <option1> | <option2> | ...` - Create a poll with 2-12 options

#### Utility Commands
- `.time` - Get current date and time
- `.quote` - Quote a replied message
- `.sticker` - Convert an image to sticker (reply to an image)
- `.ping` - Test bot response (also responds to just `ping`)
- `.status` - Share your latest status update

#### Personal Commands
- `.intro` - Share your configured personal intro
- `.greet` - Send a random greeting from your list
- `.away <on/off/status> [message]` - Toggle automatic away replies (personal chats only)
- `.back` - Quick way to disable away replies

#### Business Commands
- `.hours` - Share your hours, location, contact info
- `.services` / `.catalog` - Show the configured service list
- `.price <service>` - Return price/details for a service key or keyword
- `.order <service>` - Send booking steps plus your order/contact link
- `.invoice <client> | <service> | <amount>` - Draft a quick invoice text block
- `.faq` - Send common QA entries
- `.contact` - Send a mini contact card

## 🚀 Setup

### Prerequisites

- Node.js 18+ and npm
- WhatsApp account you can pair via QR code
- (Optional) Google Gemini API key for AI features

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp env.example .env
   ```

   Edit `.env` and configure:
   - **AI Configuration** (Optional but recommended):
     ```env
     AI_ENABLED=true
     AI_API_KEY=your_gemini_api_key_here
     AI_MODEL=gemini-pro
     AI_PROVIDER=gemini
     ```
     Get your Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   
   - **Business Information** (Optional):
     ```env
     BUSINESS_NAME=Your Business Name
     BUSINESS_HOURS=Mon-Fri · 9:00–17:00
     BUSINESS_LOCATION=Your Location
     BUSINESS_PHONE=+1 (555) 010-0000
     BUSINESS_EMAIL=hello@example.com
     BUSINESS_SITE=https://example.com
     BUSINESS_ORDER_LINK=https://example.com/contact
     ```
   
   - **Personal Settings** (Optional):
     ```env
     PERSONAL_INTRO=Hey! I'm usually online here but reply faster on WhatsApp.
     PERSONAL_AWAY_MESSAGE=Hey! I'm away from my phone right now. I'll get back to you ASAP.
     PERSONAL_AWAY_COOLDOWN_MINUTES=60
     PERSONAL_GREETINGS=Hey there!|Yo!|What's good?|Hello hello 👋|Peace ✌️
     ```

3. **Start the bot:**
   ```bash
   npm start
   ```

4. **Pair with WhatsApp:**
   - Scan the QR code shown in the terminal with WhatsApp → Linked Devices
   - Once paired, the bot stays online and automatically reconnects whenever possible
   - Delete the `auth_info` folder to force a fresh login

## 📖 Usage Examples

### Commands
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

You: .status
Bot: 📱 Latest Status Update
     "Just launched a new project! 🚀"
     Posted: 12/25/2024, 3:45:00 PM
```

### Auto-Replies
```
Friend: Hi
Bot: Hey there! 👋

Friend: How's it going?
Bot: All good here! How about you?

Friend: Thanks!
Bot: You're welcome! 😊

Friend: Lol
Bot: Haha! 😄

Friend: What are you doing?
Bot: Just here helping out! What about you?

Friend: Can you send me the status?
Bot: Here's the status you asked about:
     "Just launched a new project! 🚀"
```

### AI-Powered Replies
When AI is enabled, the bot generates intelligent, contextual replies:
```
Friend: That's amazing! How did you do it?
Bot: [AI generates a contextual reply based on the conversation]

Friend: [Replying to your status] This looks great!
Bot: [AI understands it's a reply to your status and responds accordingly]
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_FOLDER` | Where Baileys stores session files | `./auth_info` |
| `LOG_LEVEL` | Logging level (info, debug, etc.) | `info` |
| `AI_ENABLED` | Enable AI-powered replies | `false` |
| `AI_API_KEY` | Your Gemini/OpenAI/Anthropic API key | - |
| `AI_MODEL` | AI model to use | `gemini-pro` |
| `AI_PROVIDER` | AI provider (gemini/openai/anthropic) | `gemini` |

### AI Providers

**Google Gemini (Default):**
- Models: `gemini-pro`, `gemini-pro-vision`, `gemini-ultra`
- Get API key: [Google AI Studio](https://makersuite.google.com/app/apikey)

**OpenAI:**
- Models: `gpt-3.5-turbo`, `gpt-4`
- Get API key: [OpenAI Platform](https://platform.openai.com/api-keys)

**Anthropic Claude:**
- Models: `claude-3-haiku-20240307`, `claude-3-sonnet-20240229`
- Get API key: [Anthropic Console](https://console.anthropic.com/)

## 🌐 Deployment

The bot includes an HTTP server for deployment platforms like Render, Heroku, Railway, etc.

### Render Deployment

1. Connect your GitHub repository
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables in Render dashboard
5. The bot will automatically bind to the `PORT` environment variable

### Health Check

The bot exposes a health check endpoint:
- `GET /health` or `GET /` - Returns service status

## 📝 Notes

- All commands start with a dot (`.`) except `ping`
- Group management commands (kick, promote, demote) require admin privileges
- The bot ignores messages sent by you and empty messages
- Status auto-viewing works automatically - no command needed
- Auto-replies only work in direct chats (not groups)
- AI features require an API key and `AI_ENABLED=true`
- Pattern-based auto-replies work even without AI enabled

## 🔧 Troubleshooting

### Bot not responding
- Check if the bot is connected (look for "WhatsApp connection is ready 🎉" in logs)
- Verify commands start with `.` (dot)
- Check if you're in a group (some features only work in direct chats)

### AI not working
- Verify `AI_ENABLED=true` in `.env`
- Check that `AI_API_KEY` is set correctly
- Ensure you have API credits/quota
- Check logs for API errors

### Status tracking not working
- Status tracking only works for statuses posted after the bot started
- The bot tracks up to 100 recent statuses

### Port timeout on deployment
- The bot automatically binds to `PORT` environment variable
- Health check endpoint is available at `/health`
- If issues persist, check deployment platform logs

## 🤝 Contributing

Feel free to expand the logic inside `src/index.js` with your own routing, command handling, or integrations. Refer to the [Baileys documentation](https://github.com/WhiskeySockets/Baileys) for advanced features (media, buttons, groups, etc.).

## 📄 License

ISC

---

**Made with ❤️ using Baileys and Google Gemini**
