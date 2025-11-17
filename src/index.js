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
const AI_ENABLED = process.env.AI_ENABLED === 'true'
const AI_API_KEY = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY
const AI_MODEL = process.env.AI_MODEL || 'gemini-pro'
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini' // 'gemini', 'openai', or 'anthropic'
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

// Status tracking - store posted status updates
const statusStore = new Map() // key: statusId, value: { content, timestamp, media }

// Track status updates when they're posted
const trackStatusUpdate = (statusId, content, media = null) => {
  statusStore.set(statusId, {
    content,
    media,
    timestamp: Date.now()
  })
  // Keep only last 100 statuses
  if (statusStore.size > 100) {
    const firstKey = statusStore.keys().next().value
    statusStore.delete(firstKey)
  }
  logger.debug({ statusId, hasMedia: !!media }, 'Tracked status update')
}

// Get status content by ID
const getStatusContent = (statusId) => {
  return statusStore.get(statusId)
}

// AI-powered reply generation
const generateAIReply = async (incomingMessage, context = {}) => {
  if (!AI_ENABLED || !AI_API_KEY) {
    return null
  }

  try {
    const systemPrompt = `You are a helpful WhatsApp assistant. Generate brief, natural, and friendly replies to messages. Keep responses concise (1-2 sentences max), conversational, and appropriate for WhatsApp. If the user is asking about a status update, acknowledge it naturally.`

    const userPrompt = `Message: "${incomingMessage}"${context.statusContent ? `\n\nContext: This is a reply to a status update that said: "${context.statusContent}"` : ''}${context.previousMessages ? `\n\nPrevious conversation:\n${context.previousMessages}` : ''}\n\nGenerate a natural, brief reply:`

    if (AI_PROVIDER === 'gemini' || !AI_PROVIDER) {
      // Using Google Gemini API
      const https = require('https')
      const modelName = AI_MODEL || 'gemini-pro'
      const data = JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemPrompt}\n\n${userPrompt}`
          }]
        }],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.7
        }
      })

      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${modelName}:generateContent?key=${AI_API_KEY}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        }

        const req = https.request(options, (res) => {
          let responseData = ''
          res.on('data', (chunk) => {
            responseData += chunk
          })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(responseData)
              if (parsed.candidates && parsed.candidates[0]?.content?.parts?.[0]?.text) {
                resolve(parsed.candidates[0].content.parts[0].text.trim())
              } else {
                logger.warn({ response: parsed }, 'Unexpected Gemini API response')
                resolve(null)
              }
            } catch (err) {
              logger.error({ err, responseData }, 'Failed to parse Gemini response')
              resolve(null)
            }
          })
        })

        req.on('error', (err) => {
          logger.error({ err }, 'Gemini API request failed')
          resolve(null)
        })

        req.write(data)
        req.end()
      })
    } else if (AI_PROVIDER === 'openai') {
      // Using OpenAI API
      const https = require('https')
      const data = JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      })

      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AI_API_KEY}`
          }
        }

        const req = https.request(options, (res) => {
          let responseData = ''
          res.on('data', (chunk) => {
            responseData += chunk
          })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(responseData)
              if (parsed.choices && parsed.choices[0]?.message?.content) {
                resolve(parsed.choices[0].message.content.trim())
              } else {
                logger.warn({ response: parsed }, 'Unexpected AI API response')
                resolve(null)
              }
            } catch (err) {
              logger.error({ err, responseData }, 'Failed to parse AI response')
              resolve(null)
            }
          })
        })

        req.on('error', (err) => {
          logger.error({ err }, 'AI API request failed')
          resolve(null)
        })

        req.write(data)
        req.end()
      })
    } else if (AI_PROVIDER === 'anthropic') {
      // Using Anthropic Claude API
      const https = require('https')
      const data = JSON.stringify({
        model: AI_MODEL || 'claude-3-haiku-20240307',
        max_tokens: 150,
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
        ]
      })

      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': AI_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        }

        const req = https.request(options, (res) => {
          let responseData = ''
          res.on('data', (chunk) => {
            responseData += chunk
          })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(responseData)
              if (parsed.content && parsed.content[0]?.text) {
                resolve(parsed.content[0].text.trim())
              } else {
                logger.warn({ response: parsed }, 'Unexpected AI API response')
                resolve(null)
              }
            } catch (err) {
              logger.error({ err, responseData }, 'Failed to parse AI response')
              resolve(null)
            }
          })
        })

        req.on('error', (err) => {
          logger.error({ err }, 'AI API request failed')
          resolve(null)
        })

        req.write(data)
        req.end()
      })
    }
  } catch (err) {
    logger.error({ err }, 'Error generating AI reply')
    return null
  }
}

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

// Thank you responses
const THANK_YOU_PATTERNS = [
  /^(thanks|thank you|thank u|thx|ty|tysm|thank you so much|thanks a lot|thanks much|appreciate it|appreciated)$/i,
  /^(gracias|merci|danke|arigato)$/i
]

const THANK_YOU_REPLIES = [
  'You\'re welcome! 😊',
  'Happy to help!',
  'Anytime!',
  'No problem!',
  'You\'re very welcome!',
  'Glad I could help! 😊',
  'My pleasure!',
  'Of course! Anytime!'
]

// Goodbye responses
const GOODBYE_PATTERNS = [
  /^(bye|goodbye|see you|see ya|cya|later|take care|ttyl|talk to you later|gotta go|got to go|i have to go|catch you later)$/i,
  /^(good night|gn|night|sleep well|sweet dreams)$/i
]

const GOODBYE_REPLIES = [
  'Bye! Take care! 👋',
  'See you later!',
  'Talk soon! 👋',
  'Have a great day!',
  'Catch you later!',
  'Take care! 👋'
]

const GOOD_NIGHT_REPLIES = [
  'Good night! Sleep well! 🌙',
  'Night! Sweet dreams! 🌙',
  'Good night! Rest well!',
  'Sleep tight! 🌙',
  'Good night! See you tomorrow!'
]

// Common question responses
const QUESTION_PATTERNS = [
  /^(what|when|where|why|how|who|which|can you|could you|do you|are you|is it|will you)$/i
]

const QUESTION_REPLIES = [
  'That\'s a great question! Let me know if you need help with anything specific.',
  'I\'m here to help! What would you like to know?',
  'Feel free to ask me anything!',
  'What can I help you with?',
  'I\'m listening! What do you need?'
]

// Acknowledgment responses
const ACKNOWLEDGMENT_PATTERNS = [
  /^(ok|okay|okey|sure|alright|alrighty|cool|nice|great|awesome|sounds good|got it|understood|roger|copy that)$/i,
  /^(yeah|yes|yep|yup|yea|indeed|absolutely|definitely|of course)$/i
]

const ACKNOWLEDGMENT_REPLIES = [
  'Great! 👍',
  'Awesome! 😊',
  'Sounds good!',
  'Perfect!',
  'Cool! Let me know if you need anything else.',
  'Got it! 👍',
  'Nice! 😊'
]

// Business/Service inquiry patterns
const BUSINESS_INQUIRY_PATTERNS = [
  /\b(price|pricing|cost|how much|rate|rates|quote|quotation|invoice|bill|payment|pay|buy|purchase|order|service|services|website|bot|branding|ads|package|packages)\b/i,
  /\b(what do you do|what services|what can you|what do you offer|what are your|do you do|can you help|can you make|do you provide)\b/i,
  /\b(available|availability|when can|how long|timeline|delivery|turnaround|start|begin|project)\b/i
]

const BUSINESS_INQUIRY_REPLIES = [
  'Great question! Type `.services` to see what I offer, or `.price <service>` for specific pricing.',
  'I\'d be happy to help! Check out `.services` for my offerings, or `.hours` for contact info.',
  'Let me help! Use `.catalog` to see services, or `.faq` for common questions.',
  'For service details, try `.services`. For pricing, use `.price <service>`.',
  'Check out `.services` to see what I offer! You can also use `.contact` for more info.'
]

// Compliment responses
const COMPLIMENT_PATTERNS = [
  /\b(good job|well done|nice work|great work|amazing|fantastic|excellent|brilliant|perfect|wonderful|lovely|beautiful|awesome job)\b/i,
  /\b(you're|you are|ur) (great|awesome|amazing|fantastic|the best|wonderful|brilliant|genius)\b/i
]

const COMPLIMENT_REPLIES = [
  'Thank you so much! 😊',
  'That means a lot! Thank you! 🙏',
  'You\'re too kind! 😊',
  'Thanks! I appreciate that!',
  'Aw, thank you! 😊',
  'That\'s very sweet of you! Thank you!'
]

// Apology responses
const APOLOGY_PATTERNS = [
  /^(sorry|apologies|my bad|my mistake|oops|excuse me|pardon|forgive me)$/i
]

const APOLOGY_REPLIES = [
  'No worries at all! 😊',
  'It\'s all good!',
  'No problem!',
  'Don\'t worry about it!',
  'That\'s okay!',
  'No need to apologize! 😊'
]

// Help request patterns
const HELP_PATTERNS = [
  /^(help|need help|can you help|please help|i need|assist|support|stuck|confused|don't know|dunno|how do i|what should i)\b/i
]

const HELP_REPLIES = [
  'I\'m here to help! Type `.help` to see all available commands.',
  'Sure! Type `.help` to see what I can do for you.',
  'Happy to help! Use `.help` to see all my commands.',
  'Let me help! Check out `.help` for available commands.'
]

// Congratulations/Celebrations
const CONGRATULATIONS_PATTERNS = [
  /\b(congratulations|congrats|well done|celebrate|celebration|happy for you|proud of you|amazing achievement|great job|excellent work)\b/i
]

const CONGRATULATIONS_REPLIES = [
  'Thank you! 🎉',
  'Thanks so much! 😊',
  'I appreciate that! 🎊',
  'That means a lot! Thank you! 🙏'
]

// Presence/Availability checks
const PRESENCE_PATTERNS = [
  /^(are you there|you there|are you online|you online|are you here|you here|are you around|you around|hello\?|hi\?|hey\?)$/i,
  /^(ping|pong|test|testing)$/i
]

const PRESENCE_REPLIES = [
  'Yes, I\'m here! How can I help? 😊',
  'I\'m online! What\'s up?',
  'Here! What can I do for you?',
  'Yes, I\'m here and ready to help!',
  'I\'m around! Need anything?'
]

// Excitement/Enthusiasm
const EXCITEMENT_PATTERNS = [
  /\b(woohoo|yay|yippee|awesome|amazing|fantastic|incredible|wow|hooray|excited|can't wait|looking forward)\b/i,
  /^(yes!|yeah!|yep!|absolutely!|definitely!)$/i
]

const EXCITEMENT_REPLIES = [
  'That\'s awesome! 🎉',
  'Great to hear! 😊',
  'Exciting! 🚀',
  'Love the enthusiasm! 💪',
  'That\'s fantastic! 🌟'
]

// Confusion/Clarification
const CONFUSION_PATTERNS = [
  /\b(what\?|huh\?|what do you mean|i don't understand|confused|unclear|not sure|what does that mean|explain|clarify)\b/i,
  /^(hmm|hm|huh|eh\?)$/i
]

const CONFUSION_REPLIES = [
  'Let me clarify! What would you like to know?',
  'I\'m here to help! What can I explain?',
  'Feel free to ask me anything!',
  'What would you like me to clarify?',
  'I can help explain! What do you need?'
]

// Agreement/Disagreement
const AGREEMENT_PATTERNS = [
  /\b(exactly|precisely|absolutely|totally|completely|agreed|i agree|same here|me too|that's right|correct|true|indeed)\b/i
]

const AGREEMENT_REPLIES = [
  'Exactly! 👍',
  'I agree! 😊',
  'Absolutely! 💯',
  'That\'s right!',
  'Totally! 👍'
]

const DISAGREEMENT_PATTERNS = [
  /\b(no way|nope|nah|disagree|not really|i don't think so|that's not right|incorrect|wrong)\b/i
]

const DISAGREEMENT_REPLIES = [
  'I understand! Thanks for sharing your perspective.',
  'Got it! Everyone has different views.',
  'I hear you!',
  'Thanks for letting me know!',
  'I appreciate your input!'
]

// Surprise/Disbelief
const SURPRISE_PATTERNS = [
  /\b(what|really|seriously|no way|are you serious|you're kidding|is that true|wow|omg|oh my|unbelievable|incredible)\b/i,
  /^(really\?|seriously\?|no way\?|wow|omg)$/i
]

const SURPRISE_REPLIES = [
  'Yes, really! 😊',
  'I know, right?',
  'Pretty cool, huh?',
  'Surprising but true!',
  'Believe it! 😄'
]

// Encouragement/Motivation
const ENCOURAGEMENT_PATTERNS = [
  /\b(you can do it|you got this|keep going|don't give up|stay strong|hang in there|you're doing great|keep it up|motivate|encourage)\b/i
]

const ENCOURAGEMENT_REPLIES = [
  'You\'ve got this! 💪',
  'Keep going! You\'re doing great!',
  'Stay strong! 💪',
  'You can do it! 🌟',
  'Keep pushing forward! You\'ve got this!'
]

// Time/Availability inquiries
const TIME_INQUIRY_PATTERNS = [
  /\b(what time|what's the time|time now|current time|when|what day|what date|today|tomorrow|when are you|when can you|available|free|busy)\b/i
]

const TIME_INQUIRY_REPLIES = [
  'Type `.time` to get the current date and time!',
  'I\'m usually available! Use `.hours` to see my business hours.',
  'Check `.time` for the current time, or `.hours` for availability.',
  'I\'m here to help! Use `.time` for time info.'
]

// Name/Identity inquiries
const IDENTITY_PATTERNS = [
  /\b(who are you|what's your name|your name|who is this|introduce yourself|tell me about yourself|what are you)\b/i
]

const IDENTITY_REPLIES = [
  'I\'m an automated WhatsApp bot! Type `.help` to see what I can do.',
  'I\'m a helpful bot! Check out `.help` for all my features.',
  'I\'m your friendly WhatsApp assistant! Use `.intro` to learn more.',
  'I\'m here to help! Type `.help` to see everything I can do.'
]

// Contact/Communication inquiries
const CONTACT_INQUIRY_PATTERNS = [
  /\b(contact|phone|email|address|location|where are you|how to reach|reach you|get in touch|call you|text you)\b/i
]

const CONTACT_INQUIRY_REPLIES = [
  'Use `.contact` to see my contact information!',
  'Type `.hours` for contact details and business info.',
  'Check `.contact` for phone, email, and location!',
  'Use `.contact` or `.hours` to get all my contact information.'
]

// Frustration/Annoyance
const FRUSTRATION_PATTERNS = [
  /\b(ugh|argh|frustrated|annoyed|irritated|this is annoying|so frustrating|why|not working|broken|error)\b/i
]

const FRUSTRATION_REPLIES = [
  'I\'m sorry you\'re frustrated! How can I help?',
  'Let me help you with that! What\'s the issue?',
  'I understand the frustration. What can I do to help?',
  'Sorry about that! Let\'s figure this out together.'
]

// Relief/Satisfaction
const RELIEF_PATTERNS = [
  /\b(phew|finally|at last|thank goodness|relief|relieved|glad|happy|satisfied|great|perfect|done|finished)\b/i
]

const RELIEF_REPLIES = [
  'Glad to hear it! 😊',
  'That\'s great! Happy for you!',
  'Awesome! 🎉',
  'Wonderful! 😊',
  'So glad everything worked out!'
]

// Permission requests
const PERMISSION_PATTERNS = [
  /\b(can i|may i|is it ok|is it okay|is that ok|is that okay|allowed|permission|can you let me|do you mind)\b/i
]

const PERMISSION_REPLIES = [
  'Sure, go ahead!',
  'Of course!',
  'Absolutely!',
  'Yes, that\'s fine!',
  'Go for it! 👍'
]

// What's up variations
const WHATSUP_PATTERNS = [
  /^(what's up|whats up|wassup|wadup|sup|what up|what's going on|whats going on|what's happening|whats happening)$/i
]

const WHATSUP_REPLIES = [
  'Not much! How about you?',
  'Just here helping out! What\'s up with you?',
  'All good! What\'s going on with you?',
  'Nothing much! How can I help?',
  'Just hanging around! What\'s new?'
]

// Casual check-ins
const CASUAL_CHECKIN_PATTERNS = [
  /\b(how's it going|hows it going|how's everything|hows everything|how's life|hows life|how's your day|hows your day|how's your week|hows your week|what's new|whats new|what's good|whats good)\b/i,
  /\b(how you been|how have you been|long time no talk|ltnt|how's things|hows things)\b/i
]

const CASUAL_CHECKIN_REPLIES = [
  'All good here! How about you?',
  'Doing well! What about you?',
  'Pretty good! How are things with you?',
  'Can\'t complain! How\'s everything?',
  'All good! How\'s your day going?',
  'Doing great! What\'s new with you?'
]

// Casual reactions (lol, haha, etc.)
const CASUAL_REACTION_PATTERNS = [
  /^(lol|lmao|rofl|haha|hahaha|hehe|hehehe|pfft|hah|lmfao)$/i,
  /\b(lol|lmao|rofl|haha|hahaha|hehe|lmfao)\b/i
]

const CASUAL_REACTION_REPLIES = [
  'Haha! 😄',
  'Lol! 😂',
  'Glad you find it funny! 😊',
  'Haha, nice! 😄',
  'Lol, that\'s great! 😂'
]

// Casual slang
const CASUAL_SLANG_PATTERNS = [
  /\b(bet|fr|for real|ngl|not gonna lie|tbh|to be honest|imo|in my opinion|lowkey|highkey|no cap|caps|deadass|frfr|on god|ong)\b/i,
  /^(bet|fr|ngl|tbh|imo)$/i
]

const CASUAL_SLANG_REPLIES = [
  'For real! 😊',
  'I hear you!',
  'Totally! 👍',
  'Right? 😄',
  'I get it!',
  'Same! 😊'
]

// Casual status/activity updates
const CASUAL_ACTIVITY_PATTERNS = [
  /\b(what are you doing|what you doing|whatcha doing|what are you up to|what you up to|whatcha up to|what are you working on|what you working on)\b/i,
  /\b(just|about to|gonna|going to|planning to|thinking about)\b/i
]

const CASUAL_ACTIVITY_REPLIES = [
  'Just here helping out! What about you?',
  'Not much, just hanging around! What are you up to?',
  'Just doing my thing! How about you?',
  'Nothing special! What\'s going on with you?',
  'Just here! What are you doing?'
]

// Casual expressions (oh, ah, hmm, etc.)
const CASUAL_EXPRESSION_PATTERNS = [
  /^(oh|ah|hmm|hm|huh|eh|meh|ehh|ohh|ahh)$/i,
  /\b(oh ok|oh okay|ah ok|ah okay|oh i see|ah i see|gotcha|i see|makes sense)\b/i
]

const CASUAL_EXPRESSION_REPLIES = [
  'Yeah! 😊',
  'Right?',
  'I know!',
  'Got it! 👍',
  'Makes sense!',
  'I see! 😊'
]

// Casual compliments (nice, sweet, cool, etc.)
const CASUAL_COMPLIMENT_PATTERNS = [
  /\b(nice|sweet|cool|dope|fire|lit|sick|rad|awesome|amazing|great|good|solid|tight|clean|fresh|smooth)\b/i,
  /^(nice|sweet|cool|dope|fire|lit|sick|rad)$/i
]

const CASUAL_COMPLIMENT_REPLIES = [
  'Thanks! 😊',
  'Appreciate it!',
  'You too! 👍',
  'Right back at you! 😊',
  'Thanks! That means a lot!'
]

// Casual small talk
const CASUAL_SMALLTALK_PATTERNS = [
  /\b(nice weather|beautiful day|lovely day|great day|hot today|cold today|raining|sunny|cloudy)\b/i,
  /\b(having a good day|having a great day|hope you're having|hope you having|hope your day|hope ur day)\b/i
]

const CASUAL_SMALLTALK_REPLIES = [
  'Yeah, it\'s nice! Hope you\'re having a good day too!',
  'For sure! Hope your day is going well!',
  'Absolutely! Have a great one! 😊',
  'Yes! Hope you\'re enjoying it!',
  'Definitely! Hope your day is awesome!'
]

// Casual interest/engagement
const CASUAL_INTEREST_PATTERNS = [
  /\b(tell me more|go on|continue|keep going|and then|what else|what happened next|what's next|whats next)\b/i,
  /\b(interesting|intriguing|fascinating|cool story|cool|crazy|wild|insane)\b/i
]

const CASUAL_INTEREST_REPLIES = [
  'I\'d love to hear more!',
  'That\'s interesting! Tell me more!',
  'Go on! I\'m listening! 😊',
  'Keep going! This is interesting!',
  'Wow, that\'s cool! What happened next?'
]

// Casual boredom
const CASUAL_BOREDOM_PATTERNS = [
  /\b(bored|nothing to do|killing time|so bored|really bored|boring|nothing going on|nothing happening)\b/i
]

const CASUAL_BOREDOM_REPLIES = [
  'I feel you! Want to chat or do something?',
  'I know that feeling! What would you like to do?',
  'Boredom is the worst! Want to talk?',
  'I\'m here if you want to chat! 😊',
  'Let\'s find something to do! What sounds fun?'
]

// Casual busy
const CASUAL_BUSY_PATTERNS = [
  /\b(busy|swamped|hectic|crazy busy|super busy|really busy|so busy|overwhelmed|drowning in work)\b/i
]

const CASUAL_BUSY_REPLIES = [
  'I understand! Hope things calm down soon!',
  'Hang in there! You\'ve got this! 💪',
  'I know how that feels! Take care of yourself!',
  'That sounds tough! Hope you get some rest soon!',
  'Stay strong! This too shall pass! 💪'
]

// Casual agreement variations
const CASUAL_AGREEMENT_PATTERNS = [
  /\b(yep|yup|yeah|yea|sure thing|for sure|definitely|absolutely|totally|same|same here|me too|me neither|ditto)\b/i,
  /^(yep|yup|yeah|yea|sure|for sure|def|definitely|absolutely|totally)$/i
]

const CASUAL_AGREEMENT_REPLIES = [
  'Right? 😊',
  'I know, right?',
  'Totally! 👍',
  'Same here!',
  'For sure!',
  'Absolutely! 💯'
]

// Casual "how are you" variations
const CASUAL_HOWAREYOU_PATTERNS = [
  /\b(how are you doing|how you doing|how ya doing|how are things|how things|how's everything going|hows everything going)\b/i
]

const CASUAL_HOWAREYOU_REPLIES = [
  'I\'m doing great! How about you?',
  'All good here! How are you?',
  'Pretty good! What about you?',
  'Doing well! How\'s everything?',
  'Can\'t complain! How are you doing?'
]

// Casual "what are you doing" variations
const CASUAL_WHATCHA_PATTERNS = [
  /\b(whatcha|what are you|what you|what're you|whatcha doing|whatcha up to|what are you doing|what you doing)\b/i
]

const CASUAL_WHATCHA_REPLIES = [
  'Not much! What about you?',
  'Just here! What are you up to?',
  'Nothing special! What\'s going on?',
  'Just hanging out! How about you?',
  'Just doing my thing! What are you doing?'
]

// Comprehensive auto-reply detection function
const detectAutoReply = (text) => {
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

  // Check for good night
  if (/^(good night|gn|night|sleep well|sweet dreams)$/i.test(normalized)) {
    return { type: 'goodnight', reply: GOOD_NIGHT_REPLIES[Math.floor(Math.random() * GOOD_NIGHT_REPLIES.length)] }
  }

  // Check for "what's up" variations
  for (const pattern of WHATSUP_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'whatsup', reply: WHATSUP_REPLIES[Math.floor(Math.random() * WHATSUP_REPLIES.length)] }
    }
  }

  // Check for casual check-ins
  for (const pattern of CASUAL_CHECKIN_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_checkin', reply: CASUAL_CHECKIN_REPLIES[Math.floor(Math.random() * CASUAL_CHECKIN_REPLIES.length)] }
    }
  }

  // Check for casual "how are you" variations
  for (const pattern of CASUAL_HOWAREYOU_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_howareyou', reply: CASUAL_HOWAREYOU_REPLIES[Math.floor(Math.random() * CASUAL_HOWAREYOU_REPLIES.length)] }
    }
  }

  // Check for casual "whatcha" variations
  for (const pattern of CASUAL_WHATCHA_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_whatcha', reply: CASUAL_WHATCHA_REPLIES[Math.floor(Math.random() * CASUAL_WHATCHA_REPLIES.length)] }
    }
  }

  // Check for casual activity updates
  for (const pattern of CASUAL_ACTIVITY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_activity', reply: CASUAL_ACTIVITY_REPLIES[Math.floor(Math.random() * CASUAL_ACTIVITY_REPLIES.length)] }
    }
  }

  // Check for presence/availability
  for (const pattern of PRESENCE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'presence', reply: PRESENCE_REPLIES[Math.floor(Math.random() * PRESENCE_REPLIES.length)] }
    }
  }

  // Check for thank you
  for (const pattern of THANK_YOU_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'thankyou', reply: THANK_YOU_REPLIES[Math.floor(Math.random() * THANK_YOU_REPLIES.length)] }
    }
  }

  // Check for goodbye (but not good night, already handled)
  if (!/^(good night|gn|night|sleep well|sweet dreams)$/i.test(normalized)) {
    for (const pattern of GOODBYE_PATTERNS) {
      if (pattern.test(normalized)) {
        return { type: 'goodbye', reply: GOODBYE_REPLIES[Math.floor(Math.random() * GOODBYE_REPLIES.length)] }
      }
    }
  }

  // Check for help requests
  for (const pattern of HELP_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'help', reply: HELP_REPLIES[Math.floor(Math.random() * HELP_REPLIES.length)] }
    }
  }

  // Check for time/availability inquiries
  for (const pattern of TIME_INQUIRY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'time', reply: TIME_INQUIRY_REPLIES[Math.floor(Math.random() * TIME_INQUIRY_REPLIES.length)] }
    }
  }

  // Check for contact/communication inquiries
  for (const pattern of CONTACT_INQUIRY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'contact', reply: CONTACT_INQUIRY_REPLIES[Math.floor(Math.random() * CONTACT_INQUIRY_REPLIES.length)] }
    }
  }

  // Check for identity/name inquiries
  for (const pattern of IDENTITY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'identity', reply: IDENTITY_REPLIES[Math.floor(Math.random() * IDENTITY_REPLIES.length)] }
    }
  }

  // Check for business/service inquiries
  for (const pattern of BUSINESS_INQUIRY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'business', reply: BUSINESS_INQUIRY_REPLIES[Math.floor(Math.random() * BUSINESS_INQUIRY_REPLIES.length)] }
    }
  }

  // Check for compliments
  for (const pattern of COMPLIMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'compliment', reply: COMPLIMENT_REPLIES[Math.floor(Math.random() * COMPLIMENT_REPLIES.length)] }
    }
  }

  // Check for apologies
  for (const pattern of APOLOGY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'apology', reply: APOLOGY_REPLIES[Math.floor(Math.random() * APOLOGY_REPLIES.length)] }
    }
  }

  // Check for congratulations
  for (const pattern of CONGRATULATIONS_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'congratulations', reply: CONGRATULATIONS_REPLIES[Math.floor(Math.random() * CONGRATULATIONS_REPLIES.length)] }
    }
  }

  // Check for excitement/enthusiasm
  for (const pattern of EXCITEMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'excitement', reply: EXCITEMENT_REPLIES[Math.floor(Math.random() * EXCITEMENT_REPLIES.length)] }
    }
  }

  // Check for confusion/clarification
  for (const pattern of CONFUSION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'confusion', reply: CONFUSION_REPLIES[Math.floor(Math.random() * CONFUSION_REPLIES.length)] }
    }
  }

  // Check for agreement
  for (const pattern of AGREEMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'agreement', reply: AGREEMENT_REPLIES[Math.floor(Math.random() * AGREEMENT_REPLIES.length)] }
    }
  }

  // Check for disagreement
  for (const pattern of DISAGREEMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'disagreement', reply: DISAGREEMENT_REPLIES[Math.floor(Math.random() * DISAGREEMENT_REPLIES.length)] }
    }
  }

  // Check for surprise/disbelief
  for (const pattern of SURPRISE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'surprise', reply: SURPRISE_REPLIES[Math.floor(Math.random() * SURPRISE_REPLIES.length)] }
    }
  }

  // Check for encouragement
  for (const pattern of ENCOURAGEMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'encouragement', reply: ENCOURAGEMENT_REPLIES[Math.floor(Math.random() * ENCOURAGEMENT_REPLIES.length)] }
    }
  }

  // Check for frustration
  for (const pattern of FRUSTRATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'frustration', reply: FRUSTRATION_REPLIES[Math.floor(Math.random() * FRUSTRATION_REPLIES.length)] }
    }
  }

  // Check for relief/satisfaction
  for (const pattern of RELIEF_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'relief', reply: RELIEF_REPLIES[Math.floor(Math.random() * RELIEF_REPLIES.length)] }
    }
  }

  // Check for permission requests
  for (const pattern of PERMISSION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'permission', reply: PERMISSION_REPLIES[Math.floor(Math.random() * PERMISSION_REPLIES.length)] }
    }
  }

  // Check for questions (only if message starts with question word and is short)
  if (normalized.length < 50) {
    for (const pattern of QUESTION_PATTERNS) {
      if (pattern.test(normalized)) {
        return { type: 'question', reply: QUESTION_REPLIES[Math.floor(Math.random() * QUESTION_REPLIES.length)] }
      }
    }
  }

  // Check for casual reactions (lol, haha, etc.)
  if (normalized.length < 20) {
    for (const pattern of CASUAL_REACTION_PATTERNS) {
      if (pattern.test(normalized)) {
        return { type: 'casual_reaction', reply: CASUAL_REACTION_REPLIES[Math.floor(Math.random() * CASUAL_REACTION_REPLIES.length)] }
      }
    }
  }

  // Check for casual slang
  for (const pattern of CASUAL_SLANG_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_slang', reply: CASUAL_SLANG_REPLIES[Math.floor(Math.random() * CASUAL_SLANG_REPLIES.length)] }
    }
  }

  // Check for casual expressions
  if (normalized.length < 15) {
    for (const pattern of CASUAL_EXPRESSION_PATTERNS) {
      if (pattern.test(normalized)) {
        return { type: 'casual_expression', reply: CASUAL_EXPRESSION_REPLIES[Math.floor(Math.random() * CASUAL_EXPRESSION_REPLIES.length)] }
      }
    }
  }

  // Check for casual compliments
  if (normalized.length < 30) {
    for (const pattern of CASUAL_COMPLIMENT_PATTERNS) {
      if (pattern.test(normalized)) {
        return { type: 'casual_compliment', reply: CASUAL_COMPLIMENT_REPLIES[Math.floor(Math.random() * CASUAL_COMPLIMENT_REPLIES.length)] }
      }
    }
  }

  // Check for casual small talk
  for (const pattern of CASUAL_SMALLTALK_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_smalltalk', reply: CASUAL_SMALLTALK_REPLIES[Math.floor(Math.random() * CASUAL_SMALLTALK_REPLIES.length)] }
    }
  }

  // Check for casual interest/engagement
  for (const pattern of CASUAL_INTEREST_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_interest', reply: CASUAL_INTEREST_REPLIES[Math.floor(Math.random() * CASUAL_INTEREST_REPLIES.length)] }
    }
  }

  // Check for casual boredom
  for (const pattern of CASUAL_BOREDOM_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_boredom', reply: CASUAL_BOREDOM_REPLIES[Math.floor(Math.random() * CASUAL_BOREDOM_REPLIES.length)] }
    }
  }

  // Check for casual busy
  for (const pattern of CASUAL_BUSY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_busy', reply: CASUAL_BUSY_REPLIES[Math.floor(Math.random() * CASUAL_BUSY_REPLIES.length)] }
    }
  }

  // Check for casual agreement variations
  for (const pattern of CASUAL_AGREEMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type: 'casual_agreement', reply: CASUAL_AGREEMENT_REPLIES[Math.floor(Math.random() * CASUAL_AGREEMENT_REPLIES.length)] }
    }
  }

  // Check for acknowledgments (only if message is short and matches exactly)
  if (normalized.length < 30) {
    for (const pattern of ACKNOWLEDGMENT_PATTERNS) {
      if (pattern.test(normalized)) {
        return { type: 'acknowledgment', reply: ACKNOWLEDGMENT_REPLIES[Math.floor(Math.random() * ACKNOWLEDGMENT_REPLIES.length)] }
      }
    }
  }

  // Check other greeting patterns (last, as it's more general)
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
    const { connection, lastDisconnect, qr, error } = update

    if (error) {
      logger.error({ error }, 'Connection error')
    }

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

  // Track status updates when posted
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      // Check if this is a status update we posted
      if (msg.key.fromMe && msg.key.remoteJid === STATUS_BROADCAST_JID) {
        const statusText = getIncomingText(msg.message)
        const statusId = msg.key.id
        let media = null
        
        // Check for media in status
        if (msg.message?.imageMessage) {
          media = { type: 'image', url: msg.message.imageMessage.url }
        } else if (msg.message?.videoMessage) {
          media = { type: 'video', url: msg.message.videoMessage.url }
        }
        
        trackStatusUpdate(statusId, statusText, media)
        logger.info({ statusId, hasText: !!statusText, hasMedia: !!media }, 'Tracked new status update')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    const msg = messages[0]
    if (!msg?.message || msg.key.fromMe) return

    // Handle decryption errors gracefully
    if (msg.messageStubType === 7 || msg.messageStubParameters) {
      logger.debug({ key: msg.key }, 'Skipping system message or stub')
      return
    }

    try {
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

    // Check if this is a reply to a status update
    let statusContext = null
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                       msg.message?.imageMessage?.contextInfo ||
                       msg.message?.videoMessage?.contextInfo
    if (contextInfo?.quotedMessage) {
      // This might be a reply to a status
      const quotedId = contextInfo.stanzaId
      if (quotedId) {
        const statusData = getStatusContent(quotedId)
        if (statusData) {
          statusContext = statusData
          logger.info({ sender, statusId: quotedId }, 'Detected reply to status update')
        }
      }
    }

    // Check if user is asking to see/share a status
    if (!isGroupJid(sender) && !isCommand && text) {
      const shareStatusPattern = /\b(send|share|show|forward|send me|share with me|can i see|i want to see|show me)\s+(the\s+)?(status|update|post)\b/i
      if (shareStatusPattern.test(text) && statusContext) {
        // Share the status they're asking about
        try {
          if (statusContext.media) {
            // If status has media, we can't easily forward it, so send text
            const statusText = statusContext.content || 'Status update'
            await sock.sendMessage(sender, { 
              text: `Here's the status you asked about:\n\n"${statusText}"` 
            })
          } else {
            await sock.sendMessage(sender, { 
              text: `Here's the status you asked about:\n\n"${statusContext.content}"` 
            })
          }
          return
        } catch (err) {
          logger.error({ err }, 'Failed to share status')
        }
      }
    }

    // AI-powered intelligent replies (if enabled and no pattern match)
    if (!isGroupJid(sender) && !isCommand && text && AI_ENABLED) {
      // First try pattern-based auto-reply
      const autoReply = detectAutoReply(text)
      if (autoReply) {
        await sock.sendMessage(sender, { text: autoReply.reply })
        return
      }

      // If no pattern match, use AI to generate intelligent reply
      const aiReply = await generateAIReply(text, {
        statusContent: statusContext?.content,
        hasMedia: !!statusContext?.media
      })
      
      if (aiReply) {
        await sock.sendMessage(sender, { text: aiReply })
        logger.debug({ sender, original: text, reply: aiReply }, 'Sent AI-generated reply')
        return
      }
    }

    // Fallback to pattern-based auto-reply if AI is disabled or failed
    if (!isGroupJid(sender) && !isCommand && text) {
      const autoReply = detectAutoReply(text)
      if (autoReply) {
        await sock.sendMessage(sender, { text: autoReply.reply })
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
• \`.status\` - Share latest status update

*AI-Powered Features:*
${AI_ENABLED ? `• AI-powered intelligent replies (analyzes messages and generates contextual responses) 🤖
• Detects and responds to replies on status updates 📱
• Automatically shares status when requested 🔄` : '• AI features disabled (set AI_ENABLED=true and AI_API_KEY to enable) ⚙️'}

*Automatic Features:*
• Auto-views all status updates 👀
• Tracks your posted status updates for sharing 📝
• Auto-replies in direct chats:
  - Greetings (Hi, Hello, Howfar, Good morning, etc.) 👋
  - What's up (Sup, Wassup, What's going on, etc.) 💬
  - Casual check-ins (How's it going?, What's new?, etc.) 💭
  - Casual reactions (Lol, Haha, Lmao, etc.) 😂
  - Casual slang (Bet, Fr, Ngl, Tbh, etc.) 🔥
  - Casual expressions (Oh ok, Ah, Hmm, etc.) 🤷
  - Casual compliments (Nice, Sweet, Cool, Dope, Fire, etc.) 🔥
  - Casual small talk (Nice weather, Having a good day, etc.) ☀️
  - Casual interest (Tell me more, Go on, etc.) 👂
  - Casual boredom (Bored, Nothing to do, etc.) 😴
  - Casual busy (Busy, Swamped, Hectic, etc.) 💼
  - Casual agreement (Yep, Yup, Same, Me too, etc.) 👍
  - Casual activity (Whatcha doing?, What are you up to?, etc.) 🎯
  - Presence checks (Are you there?, You online?, etc.) 📍
  - Thank you messages (Thanks, Thank you, etc.) 🙏
  - Goodbyes (Bye, See you, Good night, etc.) 👋
  - Help requests (Help, Need help, etc.) 🆘
  - Time inquiries (What time?, When?, etc.) 🕐
  - Contact inquiries (Phone, Email, Location, etc.) 📞
  - Identity questions (Who are you?, What's your name?, etc.) 🤖
  - Business inquiries (Price, Services, etc.) 💼
  - Compliments (Good job, Awesome, etc.) 😊
  - Congratulations (Congrats, Well done, etc.) 🎉
  - Excitement (Yay, Awesome, Wow, etc.) 🚀
  - Apologies (Sorry, My bad, etc.) 😅
  - Confusion (What?, Huh?, Explain, etc.) 🤔
  - Agreement/Disagreement (Exactly, I agree, etc.) 👍
  - Surprise (Really?, No way!, etc.) 😲
  - Encouragement (You got this, Keep going, etc.) 💪
  - Frustration (Ugh, Annoyed, etc.) 😤
  - Relief (Finally, Phew, etc.) 😌
  - Permission requests (Can I?, May I?, etc.) ✅
  - Questions (What, When, How, etc.) ❓
  - Acknowledgments (Ok, Sure, Cool, etc.) 👍`
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

    // .status - Share latest status update
    if (command === '.status') {
      if (statusStore.size === 0) {
        await sock.sendMessage(sender, { text: 'No status updates tracked yet. Post a status first!' })
        return
      }

      // Get the most recent status
      const statuses = Array.from(statusStore.entries())
      const latestStatus = statuses[statuses.length - 1]
      const [statusId, statusData] = latestStatus

      if (statusData.content || statusData.media) {
        const statusText = statusData.content || 'Status update'
        const timestamp = new Date(statusData.timestamp).toLocaleString()
        await sock.sendMessage(sender, {
          text: `📱 *Latest Status Update*\n\n"${statusText}"\n\n_Posted: ${timestamp}_`
        })
      } else {
        await sock.sendMessage(sender, { text: 'Latest status update has no content.' })
      }
      return
    }
    } catch (err) {
      // Handle decryption errors and other message processing errors gracefully
      if (err?.name === 'SessionError' || err?.message?.includes('No matching sessions')) {
        logger.debug({ key: msg?.key, err: err.message }, 'Skipping message with session error (likely out of sync)')
        return
      }
      logger.error({ err, key: msg?.key }, 'Error processing message')
    }
  })

  sock.ev.on('creds.update', saveCreds)
}

startBot().catch((err) => {
  logger.error(err, 'Failed to start bot')
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  // Filter out expected SessionErrors (decryption failures are common and non-critical)
  if (reason?.name === 'SessionError' || reason?.message?.includes('No matching sessions')) {
    logger.debug({ reason: reason.message }, 'Unhandled SessionError (non-critical, skipping)')
    return
  }
  logger.error({ reason }, 'Unhandled rejection')
})

// HTTP server for deployment platforms (Render, Heroku, etc.)
// Binds to PORT environment variable or defaults to 3000
const http = require('http')
const PORT = process.env.PORT || 3000

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'whatsapp-bot',
      timestamp: new Date().toISOString()
    }))
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`HTTP server listening on port ${PORT} for health checks`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })
})

