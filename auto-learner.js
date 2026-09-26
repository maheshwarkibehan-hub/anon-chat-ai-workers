const https = require('https');

// Dynamic Auto-Learner & Updater
// Periodically fetches newly uploaded chat logs from https://github.com/maheshwarkibehan-hub/anonchat/tree/main/chat/
// Extracts recent high-quality dialogues and keeps the few-shot memory fresh!

const GITHUB_REPO = process.env.GITHUB_REPO || 'maheshwarkibehan-hub/anonchat';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let dynamicExamples = [
  'User: "hi" -> "aree suno kaise ho"',
  'User: "Hello" -> "ha"',
  'User: "kya kar rahe the" -> "are abhi to sooke utha hu, leta hu"',
  'User: "naam batao na" -> "naam me kya rkha h mister 😉 pehle dosti toh karo"',
  'User: "are you an ai or bot?" -> "pagal h kya sach me, abhi homework bacha h mera lol"',
  'User: "tum badi ho?" -> "nahi 15 saal ki hu"',
  'User: "bad girl hoo" -> "aree aree thoda sa sudhar jaoo tum bhi"'
];

let lastSyncTime = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AnonChat-AutoLearner' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function syncWithGitHubChatFolder() {
  try {
    console.log(`[Auto-Learner] Syncing fresh chat logs from GitHub (${GITHUB_REPO}/${GITHUB_BRANCH})...`);
    const treeUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/trees/${GITHUB_BRANCH}?recursive=1`;
    const treeData = await fetchJson(treeUrl);

    if (!treeData || !Array.isArray(treeData.tree)) {
      console.log('[Auto-Learner] No tree data found');
      return;
    }

    // Filter all chat JSON files
    const chatFiles = treeData.tree.filter(item => 
      item.path.startsWith('chat/') && item.path.endsWith('.json')
    );

    console.log(`[Auto-Learner] Found ${chatFiles.length} chat logs on GitHub.`);

    // Take the 5 most recent files
    const recentFiles = chatFiles.slice(-5);
    const extractedPairs = [];

    for (const fileItem of recentFiles) {
      const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${fileItem.path}`;
      try {
        const chatData = await fetchJson(rawUrl);
        if (chatData && Array.isArray(chatData.messages) && chatData.messages.length >= 2) {
          const msgs = chatData.messages;
          for (let i = 0; i < msgs.length - 1; i++) {
            if (msgs[i].sender !== msgs[i+1].sender && msgs[i].text && msgs[i+1].text) {
              const uText = msgs[i].text.trim().toLowerCase().replace(/[\.\,]+/g, '');
              const aText = msgs[i+1].text.trim().toLowerCase().replace(/[\.\,]+/g, '');
              if (uText.length > 1 && aText.length > 1 && uText.length < 50 && aText.length < 50) {
                extractedPairs.push(`User: "${uText}" -> "${aText}"`);
              }
            }
          }
        }
      } catch (err) {}
    }

    if (extractedPairs.length > 0) {
      // Pick top 6-8 fresh real dialogues
      dynamicExamples = extractedPairs.slice(-8);
      lastSyncTime = Date.now();
      console.log(`[Auto-Learner] Successfully synced ${dynamicExamples.length} fresh real dialogues from GitHub!`);
    }
  } catch (err) {
    console.error('[Auto-Learner] Sync failed:', err.message);
  }
}

function getDynamicExamplesText() {
  return dynamicExamples.join('\n');
}

// Initial sync
syncWithGitHubChatFolder();

// Background recurring sync every 15 minutes (900,000 ms)
setInterval(() => {
  syncWithGitHubChatFolder();
}, 15 * 60 * 1000);

module.exports = {
  syncWithGitHubChatFolder,
  getDynamicExamplesText
};
