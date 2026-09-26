const fs = require('fs');
const path = require('path');

// Persistent Long-Term Memory Store for AI Agents
// Automatically records user details, topics, tone, and past interactions across sessions.
// Saved to a local JSON file: memory_store.json

const MEMORY_FILE = path.join(__dirname, 'memory_store.json');

class MemoryStore {
  constructor() {
    this.memories = new Map(); // partnerHash -> MemoryObject
    this.loadMemory();
  }

  loadMemory() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [key, val] of Object.entries(data)) {
          this.memories.set(key, val);
        }
        console.log(`[Memory Store] Loaded long-term memories for ${this.memories.size} users.`);
      }
    } catch (e) {
      console.error('[Memory Store Error] Failed to read memory file:', e.message);
    }
  }

  saveMemory() {
    try {
      const obj = {};
      for (const [key, val] of this.memories.entries()) {
        obj[key] = val;
      }
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('[Memory Store Error] Failed to save memory file:', e.message);
    }
  }

  getUserMemory(partnerHash) {
    if (!partnerHash) return null;
    return this.memories.get(partnerHash) || null;
  }

  // Record an ongoing conversation turn or extract key facts
  recordTurn(partnerHash, userMsg, agentReply) {
    if (!partnerHash) return;
    let mem = this.memories.get(partnerHash);
    if (!mem) {
      mem = {
        partnerHash,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        totalChats: 1,
        knownFacts: [],
        topicsDiscussed: [],
        lastVibe: 'friendly'
      };
      this.memories.set(partnerHash, mem);
    }

    mem.lastSeen = new Date().toISOString();

    const lower = (userMsg || '').toLowerCase();

    // Auto-detect common student facts from conversation
    if (lower.includes('10th') || lower.includes('10 me')) mem.knownFacts.push('in 10th class');
    if (lower.includes('11th') || lower.includes('11 me')) mem.knownFacts.push('in 11th class');
    if (lower.includes('delhi')) mem.knownFacts.push('lives in Delhi');
    if (lower.includes('mumbai')) mem.knownFacts.push('lives in Mumbai');
    if (lower.includes('cricket') || lower.includes('bgmi') || lower.includes('val')) mem.knownFacts.push('likes gaming/sports');
    if (lower.includes('bunk')) mem.knownFacts.push('bunked school recently');
    if (lower.includes('crush')) mem.knownFacts.push('talked about their crush');
    if (lower.includes('bio') || lower.includes('physics')) mem.knownFacts.push('studied science');

    // Deduplicate facts
    mem.knownFacts = [...new Set(mem.knownFacts)].slice(-6);

    // Track keywords for topics
    const words = lower.split(/\s+/).filter(w => w.length > 4);
    if (words.length > 0) {
      mem.topicsDiscussed.push(words.slice(0, 3).join(' '));
      mem.topicsDiscussed = [...new Set(mem.topicsDiscussed)].slice(-5);
    }

    this.saveMemory();
  }

  // Increment chat count when a user reconnects with an agent
  incrementSession(partnerHash) {
    if (!partnerHash) return;
    let mem = this.memories.get(partnerHash);
    if (mem) {
      mem.totalChats = (mem.totalChats || 1) + 1;
    } else {
      mem = {
        partnerHash,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        totalChats: 1,
        knownFacts: [],
        topicsDiscussed: [],
        lastVibe: 'friendly'
      };
      this.memories.set(partnerHash, mem);
    }
    this.saveMemory();
  }

  // Format memories for LLM System Prompt injection
  formatMemoryPrompt(partnerHash) {
    const mem = this.getUserMemory(partnerHash);
    if (!mem || mem.totalChats <= 1) return '';

    let prompt = `\nLONG-TERM MEMORY OF THIS USER (You have talked to this student before!):\n`;
    prompt += `- You have chatted with them ${mem.totalChats} times before.\n`;
    if (mem.knownFacts.length > 0) {
      prompt += `- Things you remember about them: ${mem.knownFacts.join(', ')}.\n`;
    }
    if (mem.topicsDiscussed.length > 0) {
      prompt += `- Past topics discussed: ${mem.topicsDiscussed.join(', ')}.\n`;
    }
    prompt += `- BEHAVIOR: Act pleasantly surprised or tease them about talking again ("areyy tum firse mil gaye lol", "pehle bhi baat hui thi na hamari? 😉"). Never recite this like a robot; bring it up naturally like an old friend!\n`;

    return prompt;
  }
}

module.exports = new MemoryStore();
