const path = require('path')
const fs = require('fs')
const qrcode = require('qrcode-terminal')
const Pino = require('pino')
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  downloadMediaMessage,
  getContentType
} = require('@whiskeysockets/baileys')

require('dotenv').config()

const AUTH_FOLDER = process.env.AUTH_FOLDER || path.join(__dirname, '..', 'auth_info')
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
const STATUS_BROADCAST_JID = 'status@broadcast'
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Autobot Enterprises'
const BUSINESS_HOURS = process.env.BUSINESS_HOURS || 'Mon-Fri · 9:00–17:00'
const BUSINESS_LOCATION = process.env.BUSINESS_LOCATION || 'Online / Remote'
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || '+1 (555) 010-0000'
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || 'hello@autobot.dev'
const BUSINESS_SITE = process.env.BUSINESS_SITE || 'https://example.com'
const BUSINESS_ORDER_LINK = process.env.BUSINESS_ORDER_LINK || 'https://example.com/contact'
const PERSONAL_INTRO = process.env.PERSONAL_INTRO || 'Hey! I\'m usually online here but reply faster on WhatsApp.'
const PERSONAL_AWAY_MESSAGE = process.env.PERSONAL_AWAY_MESSAGE || 'Hey! I\'m away from my phone right now. I\'ll get back to you as soon as I can 🙏'
const PERSONAL_AWAY_COOLDOWN_MINUTES = Number(process.env.PERSONAL_AWAY_COOLDOWN_MINUTES || 60)
const PERSONAL_GREETINGS = (process.env.PERSONAL_GREETINGS || 'Hey there!|Yo!|What\'s good?|Hello hello 👋|Peace ✌️').split('|').map((greet) => greet.trim()).filter(Boolean)

if (!fs.existsSync(AUTH_FOLDER)) {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true })
}

const logger = Pino({ level: LOG_LEVEL })

const getIncomingText = (message) => {
  if (message?.conversation) return message.conversation
  if (message?.extendedTextMessage?.text) return message.extendedTextMessage.text
  if (message?.imageMessage?.caption) return message.imageMessage.caption
  return ''
}

const shouldReconnect = (lastDisconnect) => {
  const statusCode = lastDisconnect?.error?.output?.statusCode
  return statusCode !== DisconnectReason.loggedOut
}

const isGroupJid = (jid = '') => jid.endsWith('@g.us')

const markStatusAsViewed = async (sock, msg) => {
  if (!msg?.key?.id || !msg.key.participant) return

  try {
    await sock.readMessages([
      {
        remoteJid: STATUS_BROADCAST_JID,
        id: msg.key.id,
        participant: msg.key.participant
      }
    ])

    logger.debug(
      { contact: msg.key.participant },
      'Marked status as viewed'
    )
  } catch (err) {
    logger.error({ err }, 'Failed to mark status as viewed')
  }
}

// Helper: Check if user is admin in group
const isAdmin = async (sock, groupJid, userJid) => {
  try {
    const metadata = await sock.groupMetadata(groupJid)
    const participant = metadata.participants.find(p => p.id === userJid)
    return participant?.admin === 'admin' || participant?.admin === 'superadmin'
  } catch {
    return false
  }
}

// Helper: Extract mentioned JIDs from message
const getMentionedJids = (message) => {
  const mentions = []
  if (message?.extendedTextMessage?.contextInfo?.mentionedJid) {
    mentions.push(...message.extendedTextMessage.contextInfo.mentionedJid)
  }
  return mentions.filter(Boolean)
}

// Fun commands data
const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything! 😂",
  "Why did the scarecrow win an award? He was outstanding in his field! 🌾",
  "Why don't eggs tell jokes? They'd crack each other up! 🥚",
  "What do you call a fake noodle? An impasta! 🍝",
  "Why did the math book look so sad? Because it had too many problems! 📚",
  "What's the best thing about Switzerland? I don't know, but the flag is a big plus! 🇨🇭",
  "Why don't skeletons fight each other? They don't have the guts! 💀",
  "What do you call a bear with no teeth? A gummy bear! 🐻"
]

const EIGHT_BALL_ANSWERS = [
  'It is certain 🎱',
  'Without a doubt 🎱',
  'Yes definitely 🎱',
  'You may rely on it 🎱',
  'As I see it, yes 🎱',
  'Most likely 🎱',
  'Outlook good 🎱',
  'Yes 🎱',
  'Signs point to yes 🎱',
  'Reply hazy, try again 🎱',
  'Ask again later 🎱',
  'Better not tell you now 🎱',
  'Cannot predict now 🎱',
  'Concentrate and ask again 🎱',
  "Don't count on it 🎱",
  'My reply is no 🎱',
  'My sources say no 🎱',
  'Outlook not so good 🎱',
  'Very doubtful 🎱'
]

// Common greetings and casual messages that trigger auto-replies
const GREETING_PATTERNS = [
  /^(hi|hello|hey|hiya|heya|yo|sup|what's up|wassup|wadup|howdy|greetings|hola|bonjour)$/i,
  /^(how far|howfar|how are you|how are u|how r u|howru|hwru|how you doing|how u doing|how u dey|how you dey)$/i,
  /^(good morning|good afternoon|good evening|gm|ga|ge|morning|afternoon|evening)$/i,
  /^(what's good|whats good|wassup|wadup|sup|yo)$/i,
  /^(how is it going|how's it going|how it going|hows it going)$/i,
  /^(how do you do|how do u do)$/i,
  /^(nice to meet you|nice meeting you|pleased to meet you)$/i,
  /^(long time|long time no see|ltns)$/i
]

const GREETING_REPLIES = [
  'Hey there! 👋',
  'Hello! How can I help?',
  'Hi! What\'s up?',
  'Hey! Good to hear from you 😊',
  'Hello hello! 👋',
  'Hi! How are you doing?',
  'Hey! What\'s good?',
  'Hello! Nice to hear from you',
  'Hi there! 👋',
  'Hey! How can I assist you?',
  'Hello! Hope you\'re doing well',
  'Hi! Great to hear from you 😊'
]

const HOW_FAR_REPLIES = [
  'I\'m doing great, thanks for asking! How about you? 😊',
  'All good here! How are you doing?',
  'I\'m fine, thanks! How are you?',
  'Doing well! What about you?',
  'All good! How\'s everything with you?',
  'Great! Thanks for asking. How are you?',
  'I\'m good! How are things on your end?',
  'Doing fine! How about yourself?'
]

const MORNING_REPLIES = [
  'Good morning! Hope you have a great day! ☀️',
  'Morning! Have a wonderful day ahead!',
  'Good morning! How can I help you today?',
  'Morning! Wishing you a productive day! ☀️',
  'Good morning! Hope your day goes well!'
]

const AFTERNOON_REPLIES = [
  'Good afternoon! Hope you\'re having a great day!',
  'Afternoon! How can I assist you?',
  'Good afternoon! What can I do for you?',
  'Afternoon! Hope your day is going well!'
]

const EVENING_REPLIES = [
  'Good evening! Hope you had a great day! 🌙',
  'Evening! How can I help you?',
  'Good evening! What\'s on your mind?',
  'Evening! Hope your day went well! 🌙'
]

const detectGreeting = (text) => {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  // Check for "how far" / "how are you" variations
  if (/^(how far|howfar|how are you|how are u|how r u|howru|hwru|how you doing|how u doing|how u dey|how you dey)$/i.test(normalized)) {
    return { type: 'howfar', reply: HOW_FAR_REPLIES[Math.floor(Math.random() * HOW_FAR_REPLIES.length)] }
  }

  // Check for morning greetings
  if (/^(good morning|gm|morning)$/i.test(normalized)) {
    return { type: 'morning', reply: MORNING_REPLIES[Math.floor(Math.random() * MORNING_REPLIES.length)] }
  }

  // Check for afternoon greetings
  if (/^(good afternoon|ga|afternoon)$/i.test(normalized)) {
    return { type: 'afternoon', reply: AFTERNOON_REPLIES[Math.floor(Math.random() * AFTERNOON_REPLIES.length)] }
  }

  // Check for evening greetings
  if (/^(good evening|ge|evening)$/i.test(normalized)) {
    return { type: 'evening', reply: EVENING_REPLIES[Math.floor(Math.random() * EVENING_REPLIES.length)] }
  }

  // Check other greeting patterns
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'greeting', reply: GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)] }
    }
  }

  return null
}

const BUSINESS_SERVICES = [
  {
    key: 'website',
    name: 'Website Launch Kit',
    price: 899,
    description: 'Responsive marketing site, contact form, analytics setup'
  },
  {
    key: 'bot',
    name: 'Automation Bot Sprint',
    price: 650,
    description: 'Custom WhatsApp/Telegram bot with onboarding flow'
  },
  {
    key: 'branding',
    name: 'Brand Refresh Pack',
    price: 450,
    description: 'Logo polish, color palette, typography cheatsheet'
  },
  {
    key: 'ads',
    name: 'Ad Funnel Booster',
    price: 520,
    description: 'Creative copy, landing tweaks, paid campaign review'
  }
]

const BUSINESS_FAQ = [
  {
    q: 'What is your turnaround time?',
    a: 'Most projects kick off within 3 business days and wrap in 2-3 weeks.'
  },
  {
    q: 'Do you require upfront payment?',
    a: 'Yes — 50% deposit to reserve the slot, balance on delivery.'
  },
  {
    q: 'Can you sign an NDA?',
    a: 'Absolutely. We have a standard mutual NDA ready.'
  }
]

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0
})

const formatServiceLine = (service) =>
  `• *${service.name}* (${service.key}) – ${currencyFormatter.format(service.price)}\n  ${service.description}`

const findService = (keyword = '') => {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return null
  return BUSINESS_SERVICES.find(
    (service) =>
      service.key.toLowerCase() === normalized ||
      service.name.toLowerCase().includes(normalized)
  )
}

const AWAY_COOLDOWN_MS = Math.max(1, PERSONAL_AWAY_COOLDOWN_MINUTES) * 60 * 1000
const awayState = {
  enabled: false,
  message: PERSONAL_AWAY_MESSAGE,
  lastNotified: new Map()
}

const shouldSendAwayReply = (senderJid) => {
  if (!awayState.enabled) return false
  const last = awayState.lastNotified.get(senderJid)
  if (!last) return true
  return Date.now() - last > AWAY_COOLDOWN_MS
}

const recordAwayReply = (senderJid) => {
  awayState.lastNotified.set(senderJid, Date.now())
}

async function startBot () {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ['Autobot', 'Desktop', '1.0.0']
  })

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      logger.info('Scan the QR code below with WhatsApp.')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      logger.info('WhatsApp connection is ready 🎉')
    }

    if (connection === 'close') {
      if (shouldReconnect(lastDisconnect)) {
        logger.warn('Connection closed. Reconnecting...')
        startBot().catch((err) => logger.error(err, 'Failed to restart bot'))
      } else {
        logger.error('Logged out from WhatsApp. Delete auth data to relogin.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    const msg = messages[0]
    if (!msg?.message || msg.key.fromMe) return

    const sender = jidNormalizedUser(msg.key.remoteJid)
    const userJid = msg.key.participant || sender

    // Auto-view status updates
    if (sender === STATUS_BROADCAST_JID) {
      await markStatusAsViewed(sock, msg)
      return
    }

    const text = getIncomingText(msg.message).trim()
    const lowerText = text.toLowerCase()
    const command = lowerText.split(' ')[0]
    const isAwayControlCommand = command === '.away' || command === '.back'
    const isCommand = command.startsWith('.') || command === 'ping'

    logger.info({ sender, text }, 'Incoming message')

    // Auto-reply to greetings in direct chats (not groups, not commands)
    if (!isGroupJid(sender) && !isCommand && text) {
      const greeting = detectGreeting(text)
      if (greeting) {
        await sock.sendMessage(sender, { text: greeting.reply })
        return
      }
    }

    if (!isGroupJid(sender) && !isAwayControlCommand && shouldSendAwayReply(sender)) {
      await sock.sendMessage(sender, { text: awayState.message })
      recordAwayReply(sender)
    }

    // Handle image to sticker conversion (reply to image with .sticker)
    if (command === '.sticker') {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const imageMsg = quoted?.imageMessage || msg.message?.imageMessage
      
      if (!imageMsg) {
        await sock.sendMessage(sender, { text: 'Reply to an image with .sticker to convert it!' })
        return
      }

      try {
        const buffer = await downloadMediaMessage(
          quoted ? { message: quoted, key: msg.key } : msg,
          'buffer',
          {},
          { logger }
        )
        await sock.sendMessage(sender, {
          sticker: buffer,
          mimetype: 'image/webp'
        })
      } catch (err) {
        logger.error({ err }, 'Failed to convert image to sticker')
        await sock.sendMessage(sender, { text: 'Failed to convert image to sticker.' })
      }
      return
    }

    // Commands that require text
    if (!text) return

    // .help - Show all commands
    if (command === '.help') {
      const helpText = `🤖 *Autobot Commands*

*Fun Commands:*
• \`.joke\` - Get a random joke
• \`.8ball <question>\` - Ask the magic 8-ball
• \`.dice\` - Roll a dice (1-6)
• \`.flip\` - Flip a coin
• \`.random <min> <max>\` - Random number

*Group Commands:*
• \`.tagall [message]\` - Tag all group members
• \`.info\` - Get group/user info
• \`.kick @user\` - Kick user (admin only)
• \`.promote @user\` - Promote to admin (admin only)
• \`.demote @user\` - Demote admin (admin only)
• \`.poll <question> | <option1> | <option2> | ...\` - Create poll

*Utility Commands:*
• \`.time\` - Current time
• \`.quote\` - Quote replied message
• \`.sticker\` - Convert image to sticker (reply to image)
• \`.ping\` - Test bot response
• \`.intro\` - Share personal intro
• \`.greet\` - Random greeting
• \`.away <on/off/status> [message]\` - Toggle auto replies
• \`.back\` - Shortcut to disable away replies

*Business Commands:*
• \`.hours\` - Hours & location
• \`.services\` / \`.catalog\` - Offer list
• \`.price <service>\` - Pricing lookup
• \`.order <service>\` - Next steps + booking link
• \`.invoice <client> | <service> | <amount>\` - Draft invoice text
• \`.faq\` - Common client answers
• \`.contact\` - Share contact card

*Automatic Features:*
• Auto-views all status updates 👀
• Auto-replies to greetings (Hi, Hello, Howfar, etc.) in direct chats 💬`
      await sock.sendMessage(sender, { text: helpText })
      return
    }

    // .ping
    if (command === 'ping' || command === '.ping') {
      await sock.sendMessage(sender, { text: 'pong 🏓' })
      return
    }

    // .joke
    if (command === '.joke') {
      const joke = JOKES[Math.floor(Math.random() * JOKES.length)]
      await sock.sendMessage(sender, { text: joke })
      return
    }

    // .8ball
    if (command === '.8ball') {
      const question = text.slice('.8ball'.length).trim()
      if (!question) {
        await sock.sendMessage(sender, { text: 'Ask me a question! Usage: .8ball <question>' })
        return
      }
      const answer = EIGHT_BALL_ANSWERS[Math.floor(Math.random() * EIGHT_BALL_ANSWERS.length)]
      await sock.sendMessage(sender, { text: `🎱 *Question:* ${question}\n*Answer:* ${answer}` })
      return
    }

    // .dice
    if (command === '.dice') {
      const roll = Math.floor(Math.random() * 6) + 1
      await sock.sendMessage(sender, { text: `🎲 You rolled: ${roll}` })
      return
    }

    // .flip
    if (command === '.flip') {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails'
      await sock.sendMessage(sender, { text: `🪙 ${result}!` })
      return
    }

    // .random
    if (command === '.random') {
      const args = text.slice('.random'.length).trim().split(/\s+/)
      if (args.length < 2 || isNaN(args[0]) || isNaN(args[1])) {
        await sock.sendMessage(sender, { text: 'Usage: .random <min> <max>\nExample: .random 1 100' })
        return
      }
      const min = parseInt(args[0])
      const max = parseInt(args[1])
      if (min >= max) {
        await sock.sendMessage(sender, { text: 'Min must be less than max!' })
        return
      }
      const random = Math.floor(Math.random() * (max - min + 1)) + min
      await sock.sendMessage(sender, { text: `🎲 Random number: ${random}` })
      return
    }

    // .time
    if (command === '.time') {
      const now = new Date()
      const timeStr = now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      })
      await sock.sendMessage(sender, { text: `🕐 ${timeStr}` })
      return
    }

    // .intro
    if (command === '.intro') {
      await sock.sendMessage(sender, { text: PERSONAL_INTRO })
      return
    }

    // .greet
    if (command === '.greet') {
      const greeting = PERSONAL_GREETINGS[Math.floor(Math.random() * PERSONAL_GREETINGS.length)] || 'Hey!'
      await sock.sendMessage(sender, { text: greeting })
      return
    }

    // .away
    if (command === '.away') {
      const args = text.slice('.away'.length).trim()
      const [subCommand, ...rest] = args.split(' ').filter(Boolean)
      const customMessage = rest.join(' ').trim()

      if (subCommand === 'on') {
        awayState.enabled = true
        awayState.message = customMessage || awayState.message || PERSONAL_AWAY_MESSAGE
        awayState.lastNotified.clear()
        await sock.sendMessage(sender, { text: `🛑 Away replies enabled.\nMessage: ${awayState.message}` })
        return
      }

      if (subCommand === 'off') {
        awayState.enabled = false
        awayState.lastNotified.clear()
        await sock.sendMessage(sender, { text: '✅ Away replies disabled.' })
        return
      }

      const statusText = [
        `Away replies are *${awayState.enabled ? 'ON' : 'OFF'}*.`,
        `Message: ${awayState.message}`
      ].join('\n')
      await sock.sendMessage(sender, { text: statusText })
      return
    }

    if (command === '.back') {
      awayState.enabled = false
      awayState.lastNotified.clear()
      await sock.sendMessage(sender, { text: '👋 Welcome back! Away replies are off.' })
      return
    }

    // .tagall
    if (command === '.tagall') {
      if (!isGroupJid(sender)) {
        await sock.sendMessage(sender, { text: '`.tagall` works only inside group chats.' })
        return
      }

      try {
        const metadata = await sock.groupMetadata(sender)
        const mentions = metadata?.participants?.map((participant) => participant.id).filter(Boolean) || []

        if (!mentions.length) {
          await sock.sendMessage(sender, { text: 'Could not find anyone to tag.' })
          return
        }

        const customMessage = text.slice('.tagall'.length).trim()
        const handles = mentions.map((jid) => `@${jid.split('@')[0]}`).join(' ')
        const tagMessage = customMessage ? `${customMessage}\n\n${handles}` : handles

        await sock.sendMessage(sender, { text: tagMessage, mentions })
      } catch (err) {
        logger.error({ err }, 'Failed to send tagall message')
        await sock.sendMessage(sender, { text: 'Unable to mention everyone right now.' })
      }
      return
    }

    // .info
    if (command === '.info') {
      try {
        if (isGroupJid(sender)) {
          const metadata = await sock.groupMetadata(sender)
          const admins = metadata.participants.filter(p => p.admin).length
          const info = `📊 *Group Info*\n\n` +
            `*Name:* ${metadata.subject}\n` +
            `*Members:* ${metadata.participants.length}\n` +
            `*Admins:* ${admins}\n` +
            `*Created:* ${new Date(metadata.creation * 1000).toLocaleDateString()}\n` +
            `*Description:* ${metadata.desc || 'No description'}`
          await sock.sendMessage(sender, { text: info })
        } else {
          const profile = await sock.onWhatsApp(sender)
          const info = `👤 *Contact Info*\n\n` +
            `*JID:* ${sender}\n` +
            `*WhatsApp:* ${profile?.[0]?.exists ? 'Yes' : 'No'}`
          await sock.sendMessage(sender, { text: info })
        }
      } catch (err) {
        logger.error({ err }, 'Failed to get info')
        await sock.sendMessage(sender, { text: 'Failed to get info.' })
      }
      return
    }

    // .quote - Quote a replied message
    if (command === '.quote') {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted) {
        await sock.sendMessage(sender, { text: 'Reply to a message with .quote to quote it!' })
        return
      }
      const quotedText = getIncomingText(quoted)
      if (!quotedText) {
        await sock.sendMessage(sender, { text: 'Could not extract text from quoted message.' })
        return
      }
      await sock.sendMessage(sender, {
        text: `💬 "${quotedText}"`,
        quoted: msg
      })
      return
    }

    // .poll
    if (command === '.poll') {
      if (!isGroupJid(sender)) {
        await sock.sendMessage(sender, { text: '`.poll` works only inside group chats.' })
        return
      }

      const pollText = text.slice('.poll'.length).trim()
      const parts = pollText.split('|').map(p => p.trim()).filter(Boolean)

      if (parts.length < 3) {
        await sock.sendMessage(sender, {
          text: 'Usage: .poll <question> | <option1> | <option2> | [option3] | ...\nExample: .poll Favorite color? | Red | Blue | Green'
        })
        return
      }

      const question = parts[0]
      const options = parts.slice(1)

      if (options.length < 2 || options.length > 12) {
        await sock.sendMessage(sender, { text: 'Poll must have 2-12 options!' })
        return
      }

      try {
        await sock.sendMessage(sender, {
          poll: {
            name: question,
            values: options
          }
        })
      } catch (err) {
        logger.error({ err }, 'Failed to create poll')
        await sock.sendMessage(sender, { text: 'Failed to create poll.' })
      }
      return
    }

    // .kick
    if (command === '.kick') {
      if (!isGroupJid(sender)) {
        await sock.sendMessage(sender, { text: '`.kick` works only inside group chats.' })
        return
      }

      const userIsAdmin = await isAdmin(sock, sender, userJid)
      if (!userIsAdmin) {
        await sock.sendMessage(sender, { text: 'Only admins can kick members.' })
        return
      }

      const mentionedJids = getMentionedJids(msg.message)
      if (mentionedJids.length === 0) {
        await sock.sendMessage(sender, { text: 'Mention a user to kick! Usage: .kick @user' })
        return
      }

      try {
        for (const jid of mentionedJids) {
          await sock.groupParticipantsUpdate(sender, [jid], 'remove')
        }
        await sock.sendMessage(sender, { text: `✅ Kicked ${mentionedJids.length} member(s)` })
      } catch (err) {
        logger.error({ err }, 'Failed to kick user')
        await sock.sendMessage(sender, { text: 'Failed to kick user(s).' })
      }
      return
    }

    // .promote
    if (command === '.promote') {
      if (!isGroupJid(sender)) {
        await sock.sendMessage(sender, { text: '`.promote` works only inside group chats.' })
        return
      }

      const userIsAdmin = await isAdmin(sock, sender, userJid)
      if (!userIsAdmin) {
        await sock.sendMessage(sender, { text: 'Only admins can promote members.' })
        return
      }

      const mentionedJids = getMentionedJids(msg.message)
      if (mentionedJids.length === 0) {
        await sock.sendMessage(sender, { text: 'Mention a user to promote! Usage: .promote @user' })
        return
      }

      try {
        await sock.groupParticipantsUpdate(sender, mentionedJids, 'promote')
        await sock.sendMessage(sender, { text: `✅ Promoted ${mentionedJids.length} member(s) to admin` })
      } catch (err) {
        logger.error({ err }, 'Failed to promote user')
        await sock.sendMessage(sender, { text: 'Failed to promote user(s).' })
      }
      return
    }

    // .demote
    if (command === '.demote') {
      if (!isGroupJid(sender)) {
        await sock.sendMessage(sender, { text: '`.demote` works only inside group chats.' })
        return
      }

      const userIsAdmin = await isAdmin(sock, sender, userJid)
      if (!userIsAdmin) {
        await sock.sendMessage(sender, { text: 'Only admins can demote members.' })
        return
      }

      const mentionedJids = getMentionedJids(msg.message)
      if (mentionedJids.length === 0) {
        await sock.sendMessage(sender, { text: 'Mention a user to demote! Usage: .demote @user' })
        return
      }

      try {
        await sock.groupParticipantsUpdate(sender, mentionedJids, 'demote')
        await sock.sendMessage(sender, { text: `✅ Demoted ${mentionedJids.length} admin(s)` })
      } catch (err) {
        logger.error({ err }, 'Failed to demote user')
        await sock.sendMessage(sender, { text: 'Failed to demote user(s).' })
      }
      return
    }

    // .hours
    if (command === '.hours') {
      const info = [
        `🏢 *${BUSINESS_NAME}*`,
        `• Hours: ${BUSINESS_HOURS}`,
        `• Location: ${BUSINESS_LOCATION}`,
        `• Phone: ${BUSINESS_PHONE}`,
        `• Email: ${BUSINESS_EMAIL}`,
        `• Website: ${BUSINESS_SITE}`
      ].join('\n')
      await sock.sendMessage(sender, { text: info })
      return
    }

    // .services / .catalog
    if (command === '.services' || command === '.catalog') {
      const servicesText = BUSINESS_SERVICES.map(formatServiceLine).join('\n\n')
      await sock.sendMessage(sender, {
        text: `📋 *${BUSINESS_NAME} — Service Catalog*\n\n${servicesText}\n\nReply with \`.price <service>\` or \`.order <service>\` to proceed.`
      })
      return
    }

    // .price
    if (command === '.price') {
      const keyword = text.slice('.price'.length).trim()
      const service = findService(keyword)
      if (!service) {
        await sock.sendMessage(sender, {
          text: 'Tell me which service to price. Example: `.price website`'
        })
        return
      }
      await sock.sendMessage(sender, {
        text: `💼 *${service.name}*\n${service.description}\n\nRate: ${currencyFormatter.format(service.price)}`
      })
      return
    }

    // .order
    if (command === '.order') {
      const keyword = text.slice('.order'.length).trim()
      const service = findService(keyword)
      const mention = service ? service.name : 'the package you need'
      const orderText = [
        `✅ *Ready to start ${mention}?*`,
        '1) Share timeline + goals',
        '2) Receive proposal & invoice (50% deposit)',
        '3) Kickoff call & delivery updates',
        '',
        `Book here: ${BUSINESS_ORDER_LINK}`,
        `Or reply with details and we'll handle the rest.`
      ].join('\n')
      await sock.sendMessage(sender, { text: orderText })
      return
    }

    // .invoice
    if (command === '.invoice') {
      const details = text.slice('.invoice'.length).split('|').map((part) => part.trim()).filter(Boolean)
      if (details.length < 3) {
        await sock.sendMessage(sender, {
          text: 'Usage: `.invoice Client Name | Service | Amount`\nExample: `.invoice Acme Corp | Website Launch Kit | 1200`'
        })
        return
      }

      const [client, serviceName, amountRaw] = details
      const amountNumber = parseFloat(amountRaw.replace(/[^0-9.]/g, ''))
      const amount = Number.isFinite(amountNumber) ? currencyFormatter.format(amountNumber) : amountRaw

      const invoice = [
        `🧾 *Invoice Draft*`,
        `Client: ${client}`,
        `Service: ${serviceName}`,
        `Amount Due: ${amount}`,
        '',
        `Payable to: ${BUSINESS_NAME}`,
        `Email: ${BUSINESS_EMAIL}`,
        `Notes: 50% deposit to reserve the slot. Remaining balance on delivery.`
      ].join('\n')

      await sock.sendMessage(sender, { text: invoice })
      return
    }

    // .faq
    if (command === '.faq') {
      const faqText = BUSINESS_FAQ.map((entry) => `*Q:* ${entry.q}\n*A:* ${entry.a}`).join('\n\n')
      await sock.sendMessage(sender, { text: `🗂️ *FAQs*\n\n${faqText}` })
      return
    }

    // .contact
    if (command === '.contact') {
      const contactCard = [
        `📇 *${BUSINESS_NAME}*`,
        `Phone: ${BUSINESS_PHONE}`,
        `Email: ${BUSINESS_EMAIL}`,
        `Website: ${BUSINESS_SITE}`,
        `Hours: ${BUSINESS_HOURS}`,
        `Location: ${BUSINESS_LOCATION}`
      ].join('\n')
      await sock.sendMessage(sender, { text: contactCard })
      return
    }
  })

  sock.ev.on('creds.update', saveCreds)
}

startBot().catch((err) => {
  logger.error(err, 'Failed to start bot')
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection')
})

