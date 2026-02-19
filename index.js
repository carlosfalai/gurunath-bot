require('dotenv').config();
const { Bot, InlineKeyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const express = require('express');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const bot = new Bot(BOT_TOKEN);
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = [
  '🪔 Temple & Altar',
  '🏠 Guest Rooms',
  '🚿 Bathrooms',
  '🍽️ Kitchen',
  '🌱 Garden & Grounds',
  '🔧 Plumbing',
  '⚡ Electrical',
  '🏗️ Structure & Walls',
  '🚰 Water & Drainage',
  '🛤️ Paths & Roads',
  '📦 Storage',
  '🔒 Security',
  '🌿 Other'
];

// In-memory state per user conversation
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, {});
  return sessions.get(userId);
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── /start ─────────────────────────────────────────────
bot.command('start', async ctx => {
  await ctx.reply(
    `🪷 *Hari Om\\! Welcome to Gurunath Teachings Bot*\n\n` +
    `This bot has two purposes:\n\n` +
    `*📚 Learn from Gurunath's Teachings*\n` +
    `Ask any question about Kriya Yoga, consciousness, or Gurunath's wisdom\\.\n` +
    `→ Type /learn to start\n\n` +
    `*📸 Submit Ashram Projects*\n` +
    `Photo something that needs fixing at the ashram\\.\n` +
    `→ Send a photo to get started\n\n` +
    `🙏 *Yogiraj Siddhanath's blessings be with you\\.*`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ── /learn — teachings Q&A ──────────────────────────────
bot.command('learn', async ctx => {
  await ctx.reply(
    `🪷 *Ask me about Gurunath's Teachings*\n\n` +
    `You can ask about:\n` +
    `• Kriya Yoga and its techniques\n` +
    `• Consciousness and awareness\n` +
    `• Science and spirituality\n` +
    `• Hamsa Yoga and the breath\n` +
    `• Any teaching of Yogiraj Siddhanath\n\n` +
    `Just type your question:`,
    { parse_mode: 'Markdown' }
  );
  const s = getSession(ctx.from.id);
  s.step = 'learning';
});

// ── Receive photo ───────────────────────────────────────
bot.on('message:photo', async ctx => {
  const userId = ctx.from.id;
  const session = getSession(userId);

  // Get the largest photo
  const photos = ctx.message.photo;
  const photo = photos[photos.length - 1];
  session.file_id = photo.file_id;
  session.caption = ctx.message.caption || '';
  session.sender_name = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
  session.sender_id = String(userId);
  session.step = 'category';

  // Build category keyboard
  const keyboard = new InlineKeyboard();
  CATEGORIES.forEach((cat, i) => {
    keyboard.text(cat, `cat:${i}`);
    if ((i + 1) % 2 === 0) keyboard.row();
  });

  await ctx.reply(
    `📸 Got your photo! Now select a category:`,
    { reply_markup: keyboard }
  );
});

// ── Category selected ───────────────────────────────────
bot.callbackQuery(/^cat:(\d+)$/, async ctx => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const idx = parseInt(ctx.match[1]);
  session.category = CATEGORIES[idx];
  session.step = 'description';
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Category: *${session.category}*\n\n` +
    `Now describe *specifically* what needs to be done:\n\n` +
    `_Example: "The marble step at the main temple entrance is cracked and a tripping hazard. Needs to be replaced with matching marble."_`,
    { parse_mode: 'Markdown' }
  );
});

// ── Text messages (description + price + learning Q&A) ──
bot.on('message:text', async ctx => {
  const userId = ctx.from.id;
  const session = getSession(userId);

  // Learning mode — answer with AI
  if (session.step === 'learning') {
    const question = ctx.message.text;
    await ctx.reply(`🪷 _Thinking..._`, { parse_mode: 'Markdown' });
    try {
      const { default: fetch } = await import('node-fetch');
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: `You are a knowledgeable guide on the teachings of Yogiraj Gurunath Siddhanath (also known as Siddhanath).
Answer questions about his teachings on Kriya Yoga, Hamsa Yoga, consciousness, breath (Hamsa = 21,600 breaths/day), the science of spirituality, and the path to self-realization.
Keep answers concise (3-5 paragraphs max), warm, and accessible.
Begin responses with 🪷 and end with Hari Om.
Draw from known themes: consciousness greater than E=MC², Hamsa breath, Kriya Yoga techniques, oneness, samadhi, Earth Peace meditation.
Do NOT make up specific quotes — speak to the themes of his teachings.`,
          messages: [{ role: 'user', content: question }]
        })
      });
      const data = await resp.json();
      const answer = data.content?.[0]?.text || 'I cannot answer that right now. Please try again.';
      await ctx.reply(answer);
    } catch (e) {
      await ctx.reply(`❌ Could not get answer: ${e.message}`);
    }
    return;
  }

  if (session.step === 'description') {
    session.description = ctx.message.text;
    session.step = 'price';
    await ctx.reply(
      `Got it.\n\n` +
      `What's your estimated cost in USD?\n\n` +
      `_Type a number (e.g. 500) or type "unknown" if you're not sure._`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (session.step === 'price') {
    const text = ctx.message.text.trim().toLowerCase();
    session.estimated_usd = text === 'unknown' ? 0 : parseInt(text.replace(/[^0-9]/g, '')) || 0;
    session.step = 'confirm';

    await ctx.reply(
      `📋 *Review your submission:*\n\n` +
      `*Category:* ${session.category}\n` +
      `*Description:* ${session.description}\n` +
      `*Estimated cost:* ${session.estimated_usd > 0 ? '$' + session.estimated_usd.toLocaleString() : 'Unknown'}\n\n` +
      `Submit this to cottoncandygod.com?`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('✅ Yes, submit', 'submit')
          .text('✏️ Start over', 'restart')
      }
    );
    return;
  }

  // Default
  await ctx.reply(`📸 Send a photo of what needs to be fixed to get started.`);
});

// ── Submit ──────────────────────────────────────────────
bot.callbackQuery('submit', async ctx => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  await ctx.answerCallbackQuery('Submitting...');

  try {
    // Get photo URL from Telegram
    const fileInfo = await bot.api.getFile(session.file_id);
    const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

    // Save to Supabase
    const { data, error } = await sb.from('ashram_projects').insert({
      title: session.description.substring(0, 80),
      description: session.description,
      category: session.category.replace(/^[^\w]+/, '').toLowerCase().split(' ')[0],
      category_label: session.category,
      goal_usd: session.estimated_usd || 0,
      raised_usd: 0,
      status: 'open',
      photo_url: photoUrl,
      submitted_by: session.sender_name,
      submitted_by_telegram: session.sender_id,
      phase: 1,
      priority: 10
    }).select().single();

    if (error) throw new Error(error.message);

    sessions.delete(userId);
    await ctx.editMessageText(
      `✅ *Submitted successfully!*\n\n` +
      `Your project is now live on cottoncandygod.com\n` +
      `Hamsas can now pledge support to fund this.\n\n` +
      `🙏 Hari Om!`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await ctx.editMessageText(`❌ Error saving: ${e.message}\n\nPlease try again.`);
  }
});

// ── Restart ─────────────────────────────────────────────
bot.callbackQuery('restart', async ctx => {
  const userId = ctx.from.id;
  sessions.delete(userId);
  await ctx.answerCallbackQuery();
  await ctx.reply(`OK, starting over. Send a photo of what needs to be fixed.`);
});

// ── Error handler ────────────────────────────────────────
bot.catch((err) => {
  console.error('[BOT ERROR]', err.message);
});

// ── Express for health + webhook ─────────────────────────
const app = express();
app.use(express.json());
app.get('/health', (_, res) => res.json({ status: 'ok', bot: '@gurunath_teachings_bot' }));

const PORT = process.env.PORT || 3010;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function start() {
  if (WEBHOOK_URL) {
    // Production: webhook
    await bot.api.setWebhook(`${WEBHOOK_URL}/webhook/telegram`);
    app.post('/webhook/telegram', (req, res) => {
      bot.handleUpdate(req.body);
      res.sendStatus(200);
    });
    console.log(`[BOT] Webhook mode: ${WEBHOOK_URL}/webhook/telegram`);
  } else {
    // Dev: long polling
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    bot.start();
    console.log('[BOT] Long polling mode');
  }

  app.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));
}

start().catch(console.error);
