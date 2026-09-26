const express = require('express');
const { io } = require('socket.io-client');
const https = require('https');
const personas = require('./personas');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || 'http://localhost:3000';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

console.log(`[AI Worker] Target Main Server: ${MAIN_SERVER_URL}`);
console.log(`[AI Worker] Using Groq Model: ${GROQ_MODEL}`);

// --- SEMANTIC TURN-COMPLETION EVALUATOR ---
// Determines if user's last message is an INCOMPLETE fragment or a COMPLETE turn
const INCOMPLETE_TRAILING_WORDS = [
  'aur', 'or', 'fir', 'par', 'lekin', 'and', 'to', 'toh', 'ki', 'bhi', 
  'waise', 'kyunki', 'so', 'like', 'then', 'warna', 'varna', 'agar'
];

const PRE_ANNOUNCEMENT_HOOKS = [
  'sun', 'suno', 'are', 'aree', 'oye', 'hello', 'bhai', 'yr', 'yaar', 
  'hey', 'ek baat bolu', 'ruk', 'wait', 'ek sec', 'ek min', 'listen'
];

function evaluateTurnStatus(text) {
  if (!text) return { isComplete: true, delayMs: 2000 };
  const raw = text.trim().toLowerCase();

  // 1. Check if user typed an attention hook alone (e.g. "suno", "ek baat batao", "ruk")
  const isHook = PRE_ANNOUNCEMENT_HOOKS.some(h => raw === h || raw === h + ' na' || raw === h + ' yr');
  if (isHook) {
    // Wait longer! The user is preparing to type the real thought
    return { isComplete: false, delayMs: 4500, reason: 'attention_hook' };
  }

  // 2. Check trailing punctuation or ellipsis (e.g. "aur...", "fir..", "lekin,")
  if (raw.endsWith('..') || raw.endsWith('...') || raw.endsWith(',')) {
    return { isComplete: false, delayMs: 4000, reason: 'trailing_dots' };
  }

  // 3. Check trailing connectors (e.g. "kll school gaya tha aur", "woh bol rha tha ki")
  const words = raw.split(/\s+/);
  const lastWord = words[words.length - 1];
  if (INCOMPLETE_TRAILING_WORDS.includes(lastWord)) {
    return { isComplete: false, delayMs: 4500, reason: 'trailing_conjunction' };
  }

  // 4. If message is a direct question (ends with ? or question markers)
  if (raw.endsWith('?') || raw.endsWith('??') || lastWord === 'kya' || lastWord === 'kyu' || lastWord === 'btao') {
    // Ball is directly in AI's court! Normal human response delay
    return { isComplete: true, delayMs: 1800, reason: 'direct_question' };
  }

  // 5. Short incomplete fragments (< 3 words with no punctuation)
  if (words.length <= 2 && !['ha', 'haan', 'nhi', 'nahi', 'k', 'ok', 'bye', 'accha', 'shi'].includes(raw)) {
    return { isComplete: false, delayMs: 3500, reason: 'short_fragment' };
  }

  // Standard complete statement
  return { isComplete: true, delayMs: 2500, reason: 'complete_statement' };
}

// Clean and enforce 15-16yo texting rules
function cleanTeenText(text) {
  if (!text) return 'ha bol';
  let cleaned = text.trim()
    .toLowerCase()
    .replace(/[\.\,\;\:\!]+/g, ' ')   // Eliminate periods, commas, semicolons
    .replace(/\s+/g, ' ')
    .trim();

  // Low emoji rule: max 1 emoji allowed across the entire message
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/gu;
  const emojis = cleaned.match(emojiRegex);
  if (emojis && emojis.length > 1) {
    let count = 0;
    cleaned = cleaned.replace(emojiRegex, (match) => {
      count++;
      return count === 1 ? match : '';
    });
  }

  // Word cap: Max 18 words
  const words = cleaned.split(' ');
  if (words.length > 18) {
    cleaned = words.slice(0, 16).join(' ');
  }

  return cleaned;
}

// Groq API Caller
async function callGroqChat(systemPrompt, conversationHistory) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
      ],
      max_tokens: 50,
      temperature: 0.82
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let raw = parsed?.choices?.[0]?.message?.content?.trim();
          resolve(cleanTeenText(raw || 'ha bolo'));
        } catch (e) {
          resolve('hnn bol na');
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve('hnn sun rhi hu');
    });

    req.on('error', (err) => {
      console.error('[Groq Error]', err.message);
      resolve('ha bolo');
    });

    req.write(payload);
    req.end();
  });
}

const memoryStore = require('./memory-store');

// Realistic human typing delay based on character length
function calculateTypingDelay(replyText) {
  const len = replyText ? replyText.length : 10;
  if (len <= 15) {
    return Math.floor(Math.random() * 1200) + 1400; // 1.4s - 2.6s
  } else if (len <= 45) {
    return Math.floor(Math.random() * 2500) + 4000; // 4.0s - 6.5s
  } else {
    return Math.floor(Math.random() * 2500) + 7500; // 7.5s - 10.0s
  }
}

class AgentClient {
  constructor(persona, index) {
    this.persona = persona;
    this.index = index;
    this.socket = null;
    this.inRoom = false;
    this.roomId = null;
    this.partnerHash = null;
    this.history = [];

    // Semantic Burst & Debouncing State
    this.messageBuffer = [];
    this.debounceTimer = null;
    this.isPartnerTyping = false;
    this.partnerTypingTimeout = null;
    this.lastMessageTime = 0;

    this.sendTimeout = null;
    this.autoLeaveTimeout = null;
  }

  connect() {
    this.socket = io(MAIN_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000
    });

    this.socket.on('connect', () => {
      console.log(`[Agent ${this.index + 1}] Connected (${this.persona.gender} - ${this.persona.style})`);
      setTimeout(() => {
        this.findPartner();
      }, Math.random() * 3000 + 1000);
    });

    this.socket.on('waiting_for_partner', () => {
      this.inRoom = false;
      this.partnerHash = null;
    });

    this.socket.on('chat_start', (data) => {
      this.inRoom = true;
      this.roomId = data.roomId;
      this.partnerHash = data.partnerHash || null;
      this.history = [];
      this.messageBuffer = [];
      console.log(`[Agent ${this.index + 1}] Matched in room ${data.roomId} with partner ${this.partnerHash || 'anon'}`);

      if (this.partnerHash) {
        memoryStore.incrementSession(this.partnerHash);
      }

      // Check if we have past memory of this user
      const pastMem = memoryStore.getUserMemory(this.partnerHash);
      if (pastMem && pastMem.totalChats > 1) {
        console.log(`[Agent ${this.index + 1}] Recognized returning user! Total chats: ${pastMem.totalChats}`);
      }

      // 40% chance the agent sends greeting first
      if (Math.random() > 0.6) {
        setTimeout(() => {
          if (this.inRoom && this.history.length === 0 && this.messageBuffer.length === 0) {
            const greetings = this.persona.gender === 'female' 
              ? ['hey', 'hii', 'suno', 'koi h', 'hi'] 
              : ['yo', 'hi', 'koi h kya', 'ha'];
            const chosen = greetings[Math.floor(Math.random() * greetings.length)];
            this.sendAgentMessage(chosen);
          }
        }, Math.random() * 2000 + 2000);
      }

      this.resetAutoLeave();
    });

    // Real-time typing sync from user
    this.socket.on('partner_typing', () => {
      this.isPartnerTyping = true;
      if (this.partnerTypingTimeout) clearTimeout(this.partnerTypingTimeout);
      // If user typing event arrives, pause execution up to 4s
      this.partnerTypingTimeout = setTimeout(() => {
        this.isPartnerTyping = false;
        this.checkAndFlushBuffer();
      }, 4000);
    });

    this.socket.on('partner_stop_typing', () => {
      this.isPartnerTyping = false;
      // When typing stops, wait a short breath to see if they hit send on another bubble
      setTimeout(() => this.checkAndFlushBuffer(), 800);
    });

    // Incoming messages
    this.socket.on('receive_message', (data) => {
      if (!this.inRoom || !data || !data.text) return;
      this.resetAutoLeave();

      const userText = data.text.trim();
      this.lastMessageTime = Date.now();
      console.log(`[Agent ${this.index + 1} Recv Bubble]: "${userText}"`);

      // Delivery & seen receipts
      if (data.msgId) {
        setTimeout(() => this.socket.emit('message_delivered', { msgId: data.msgId }), 200);
        setTimeout(() => this.socket.emit('message_seen', { msgId: data.msgId }), 600);
      }

      this.messageBuffer.push(userText);

      // Evaluate semantic completeness of the last bubble
      const evaluation = evaluateTurnStatus(userText);
      console.log(`[Turn Analysis]: ${evaluation.reason} -> Waiting ${evaluation.delayMs}ms`);

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.checkAndFlushBuffer();
      }, evaluation.delayMs);
    });

    this.socket.on('partner_disconnected', () => {
      console.log(`[Agent ${this.index + 1}] Partner left. Re-queuing...`);
      this.inRoom = false;
      this.clearTimeouts();
      setTimeout(() => {
        this.findPartner();
      }, Math.random() * 4000 + 3000);
    });

    this.socket.on('disconnect', () => {
      this.inRoom = false;
      this.clearTimeouts();
    });
  }

  checkAndFlushBuffer() {
    if (!this.inRoom || this.messageBuffer.length === 0) return;

    // If user is currently typing, give them room to finish!
    if (this.isPartnerTyping) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.checkAndFlushBuffer(), 1800);
      return;
    }

    // Check if the last bubble in buffer ended with an incomplete thought
    const lastBubble = this.messageBuffer[this.messageBuffer.length - 1];
    const evaluation = evaluateTurnStatus(lastBubble);
    const timeSinceLastMsg = Date.now() - this.lastMessageTime;

    // If turn is incomplete and it has been less than 4 seconds, wait a bit more
    if (!evaluation.isComplete && timeSinceLastMsg < 4000) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.checkAndFlushBuffer(), 2000);
      return;
    }

    const combinedMessage = this.messageBuffer.join('\n');
    this.messageBuffer = [];

    this.processAggregatedMessage(combinedMessage);
  }

  async processAggregatedMessage(combinedMessage) {
    if (!this.inRoom) return;

    this.history.push({ role: 'user', content: combinedMessage });
    if (this.history.length > 8) this.history.shift();

    const readingDelay = Math.floor(Math.random() * 1000) + 1000;

    setTimeout(async () => {
      if (!this.inRoom) return;

      let systemPrompt = typeof this.persona.getSystemPrompt === 'function' 
        ? this.persona.getSystemPrompt() 
        : this.persona.systemPrompt;

      // Inject long-term memory about this specific user if available
      if (this.partnerHash) {
        const memoryPrompt = memoryStore.formatMemoryPrompt(this.partnerHash);
        if (memoryPrompt) {
          systemPrompt += memoryPrompt;
        }
      }

      const reply = await callGroqChat(systemPrompt, this.history);
      const typingDelay = calculateTypingDelay(reply);

      // Record conversation turn into persistent long-term memory
      if (this.partnerHash) {
        memoryStore.recordTurn(this.partnerHash, combinedMessage, reply);
      }

      this.socket.emit('typing');

      this.sendTimeout = setTimeout(() => {
        if (!this.inRoom) return;
        this.socket.emit('stop_typing');

        // 40% chance to split multi-clause reply into 2 mini bubbles
        const words = reply.split(' ');
        if (words.length >= 8 && Math.random() < 0.4) {
          const mid = Math.floor(words.length / 2);
          const bubble1 = words.slice(0, mid).join(' ');
          const bubble2 = words.slice(mid).join(' ');

          this.sendAgentMessage(bubble1);

          setTimeout(() => {
            if (this.inRoom) {
              this.socket.emit('typing');
              setTimeout(() => {
                if (this.inRoom) {
                  this.socket.emit('stop_typing');
                  this.sendAgentMessage(bubble2);
                }
              }, 1200);
            }
          }, 600);
        } else {
          this.sendAgentMessage(reply);
        }

      }, typingDelay);

    }, readingDelay);
  }

  sendAgentMessage(text) {
    if (!this.inRoom || !this.socket) return;
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.history.push({ role: 'assistant', content: text });
    if (this.history.length > 8) this.history.shift();

    this.socket.emit('send_message', {
      msgId,
      text,
      ephemeral: false
    });
    console.log(`[Agent ${this.index + 1} Sent]: "${text}"`);
  }

  findPartner() {
    if (this.socket && this.socket.connected && !this.inRoom) {
      this.socket.emit('find_partner');
    }
  }

  resetAutoLeave() {
    if (this.autoLeaveTimeout) clearTimeout(this.autoLeaveTimeout);
    this.autoLeaveTimeout = setTimeout(() => {
      if (this.inRoom && this.socket) {
        this.socket.emit('leave_chat');
        this.inRoom = false;
        setTimeout(() => this.findPartner(), 5000);
      }
    }, 240000);
  }

  clearTimeouts() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.partnerTypingTimeout) clearTimeout(this.partnerTypingTimeout);
    if (this.sendTimeout) clearTimeout(this.sendTimeout);
    if (this.autoLeaveTimeout) clearTimeout(this.autoLeaveTimeout);
    this.messageBuffer = [];
  }
}

const activeAgents = [];
let initialized = false;

function startAgents() {
  if (initialized) return;
  initialized = true;
  console.log(`[AI Worker] Spawning 10 School Student AI Agents (15-16yo)...`);
  personas.forEach((persona, idx) => {
    const agent = new AgentClient(persona, idx);
    activeAgents.push(agent);
    setTimeout(() => {
      agent.connect();
    }, idx * 600);
  });
}

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    agentsCount: activeAgents.length,
    activeRooms: activeAgents.filter(a => a.inRoom).length,
    timestamp: Date.now()
  });
});

app.post('/api/wakeup', (req, res) => {
  console.log('[AI Worker] Wakeup ping received from main server!');
  if (!initialized) {
    startAgents();
  } else {
    activeAgents.forEach(a => {
      if (!a.inRoom) a.findPartner();
    });
  }
  res.json({ status: 'awake', activeAgents: activeAgents.length });
});

startAgents();

app.listen(PORT, () => {
  console.log(`[AI Worker Service] Running on port ${PORT}`);
});
