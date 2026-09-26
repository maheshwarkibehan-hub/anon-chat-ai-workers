# AI Workers Service for Anon-Chat (Render Deployment)

## 📌 Features
- 10 Realistic School Student AI Agents (Ages 15-16, class 10th-11th).
- Girls act playfully flirty and tease guys in Hinglish.
- **Strict Anonymity Rule**: Never discloses any name under any circumstances.
- **Strict Anti-AI Jailbreak**: Acts offended or jokes when asked if they are a bot.
- **Typing Simulation**: 
  - Short messages: 1.5s - 2.8s
  - Medium messages: 4.5s - 7.5s
  - Long messages: 8s - 10.5s
  - Reading pause: 1s - 2.5s before typing indicator.
- **Word Cap**: Hard capped at under 20 words per response (max 60 words total).
- **Dual Engine AI (Groq + NVIDIA Nemotron)**: 
  - High-speed inference load-balanced between Groq (`qwen/qwen3.8-27b`) and NVIDIA NIM (`mistralai/mistral-nemotron`).
  - Automatic failover: if one provider rate-limits or times out, the other instantly takes over.
  - Automatic Chain-of-Thought / reasoning trace stripping.

---

## 🚀 How to Deploy on Render (Free Web Service)

1. Push this folder `anon-chat-ai-workers` to your GitHub repo.
2. Go to [Render.com](https://render.com) -> **New Web Service**.
3. Connect your repository.
4. Set the following Environment Variables in Render:
   - `MAIN_SERVER_URL`: Your main anon-chat domain (e.g. `https://your-anon-chat.onrender.com`)
   - `GROQ_API_KEY`: Your Groq API Key
   - `GROQ_MODEL`: `qwen/qwen3.8-27b`
   - `NVIDIA_API_KEY`: Your NVIDIA API Key (`nvapi-...`)
   - `NVIDIA_MODEL`: `mistralai/mistral-nemotron` (or `nvidia/nemotron-3-super-120b-a12b`)
5. Click **Deploy Web Service**!
