// server.js — LeadFlow main server
// All files are at root level for Railway compatibility
require('dotenv').config();

const express = require('express');
const cron = require('node-cron');

const { generateFirstReply, generateFollowUp } = require('./ai');
const { getClientById, getClientByName, saveLead, updateLead, saveClientTokens, getLeadsNeedingFollowUp } = require('./airtable');
const { getConnectUrl, exchangeCodeForTokens, getBusinesses, createWebhook, sendMessage, getLeadDetails } = require('./thumbtack');
const { notifyOwner, textLead } = require('./sms');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Simple page styling for onboarding screens
const css = `<style>
  body{font-family:-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:24px}
  h1{font-size:24px;margin-bottom:8px}
  p{color:#555;line-height:1.6}
  .btn{display:inline-block;background:#009fd4;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:20px}
  .ok{color:#16a34a;font-weight:500}
  .err{color:#dc2626}
  .step{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start}
  .num{background:#009fd4;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;margin-top:2px}
</style>`;

// ─────────────────────────────────────────────
// HEALTH CHECK
// Visit /health to confirm the server is running
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'LeadFlow is running ✅', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send(`${css}<h1>🚀 LeadFlow</h1><p>AI lead automation for local service businesses.</p><p><a href="/health">Health check</a></p>`);
});

// ─────────────────────────────────────────────
// ONBOARDING PAGE
// Send clients to: /onboard/THEIR_AIRTABLE_ID
// They click "Connect Thumbtack" and it starts OAuth
// ─────────────────────────────────────────────
app.get('/onboard/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const client = await getClientById(clientId).catch(() => null);
  const name = client?.businessName || 'your business';

  res.send(`${css}
    <h1>Connect ${name} to LeadFlow</h1>
    <p>One click and every new Thumbtack lead gets an instant AI reply automatically.</p>
    <div style="margin:28px 0">
      <div class="step"><div class="num">1</div><div>Click below and log into your Thumbtack account</div></div>
      <div class="step"><div class="num">2</div><div>Click "Allow" to give LeadFlow permission</div></div>
      <div class="step"><div class="num">3</div><div>Done — leads get instant AI replies from now on</div></div>
    </div>
    <a href="/connect/thumbtack?client=${clientId}" class="btn">Connect Thumbtack Account →</a>
    <p style="font-size:13px;color:#999;margin-top:20px">We only send messages on your behalf. We never change your profile, billing, or settings.</p>
  `);
});

// ─────────────────────────────────────────────
// OAUTH STEP 1 — Redirect to Thumbtack login
// ─────────────────────────────────────────────
app.get('/connect/thumbtack', (req, res) => {
  const { client } = req.query;
  if (!client) return res.status(400).send(`${css}<h1>Missing client ID</h1><p class="err">Use the link from your onboarding email.</p>`);
  const url = getConnectUrl(client);
  res.redirect(url);
});

// ─────────────────────────────────────────────
// OAUTH STEP 2 — Thumbtack redirects back here
// Exchange the code for tokens, set up webhooks
// ─────────────────────────────────────────────
app.get('/auth/thumbtack/callback', async (req, res) => {
  const { code, state: clientId, error } = req.query;

  if (error) {
    return res.send(`${css}<h1>Connection cancelled</h1>
      <p>You cancelled the Thumbtack connection. <a href="/connect/thumbtack?client=${clientId}">Try again</a>.</p>`);
  }

  try {
    // Get tokens from Thumbtack
    const tokens = await exchangeCodeForTokens(code);

    // Load client from Airtable
    const client = await getClientById(clientId);
    if (!client) throw new Error('Client not found in database');

    // Save tokens to Airtable
    await saveClientTokens(clientId, tokens);

    // Get their Thumbtack businesses and create webhooks
    const clientWithTokens = { ...client, ...tokens, thumbtackTokenExpiresAt: tokens.expiresAt };
    const businesses = await getBusinesses(clientWithTokens);

    let webhookCount = 0;
    for (const biz of businesses) {
      try {
        await createWebhook(clientWithTokens, biz.businessId || biz.id);
        webhookCount++;
      } catch (e) {
        console.error('[Server] Webhook creation failed:', e.message);
      }
    }

    // Text the owner to confirm they're connected
    if (client.ownerPhone) {
      await textLead(client.ownerPhone,
        `✅ LeadFlow connected! ${client.businessName} is now live on Thumbtack. Every new lead gets an instant AI reply. We'll text you when they come in.`,
        client.quoPhoneId
      );
    }

    res.send(`${css}
      <h1>🎉 You're connected!</h1>
      <p class="ok">${client.businessName} is now live on LeadFlow.</p>
      <p>Every new Thumbtack lead will get an instant personalized reply automatically. We connected ${webhookCount} business listing${webhookCount !== 1 ? 's' : ''}.</p>
      <p style="color:#999;font-size:13px;margin-top:24px">You can close this window. We'll text you when leads come in.</p>`);

  } catch (err) {
    console.error('[Server] OAuth callback error:', err.message);
    res.send(`${css}<h1>Something went wrong</h1>
      <p class="err">${err.message}</p>
      <p><a href="/connect/thumbtack?client=${clientId}">Try again</a> or reply to your onboarding email for help.</p>`);
  }
});

// ─────────────────────────────────────────────
// THUMBTACK WEBHOOK
// Thumbtack calls this when a new lead arrives
// URL is unique per client: /webhook/thumbtack/CLIENT_ID
// ─────────────────────────────────────────────
app.post('/webhook/thumbtack/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const data = req.body;

  console.log(`\n[Webhook] Event: ${data.eventType} | Client: ${clientId}`);

  // Always respond immediately — Thumbtack retries if no response within 5s
  res.json({ received: true });

  // Process in background
  handleWebhook(clientId, data).catch(err => console.error('[Webhook] Error:', err.message));
});

async function handleWebhook(clientId, data) {
  // ── NEW LEAD ──────────────────────────────
  if (data.eventType === 'lead.created') {
    const client = await getClientById(clientId);
    if (!client || !client.isActive) return;

    // Get full lead details from Thumbtack API
    const negotiationId = data.negotiationId || data.lead?.negotiationId;
    if (!negotiationId) return console.log('[Webhook] No negotiation ID');

    const details = await getLeadDetails(client, negotiationId);
    if (!details) return;

    // Build lead object
    const lead = {
      source: 'thumbtack',
      leadName: details.customerName || 'Customer',
      serviceType: details.category || details.serviceName || '',
      location: details.location ? `${details.location.city || ''}, ${details.location.state || ''}`.trim().replace(/^,|,$/, '') : '',
      dates: details.requestedDate || '',
      jobDetails: details.details || {},
      message: details.customerMessage || '',
      negotiationId,
      phone: details.customerPhone || ''
    };

    console.log(`[Lead] ${lead.leadName} — ${lead.serviceType} — ${lead.location}`);

    // Generate AI reply
    const aiReply = await generateFirstReply(lead, client);

    // Send reply INSIDE Thumbtack via official API
    await sendMessage(client, negotiationId, aiReply);
    console.log('[Lead] ✅ Reply sent inside Thumbtack');

    // Notify owner by SMS
    if (client.ownerPhone) {
      await notifyOwner(
        client.ownerPhone,
        lead,
        aiReply,
        `https://www.thumbtack.com/pro/messages/${negotiationId}`
      );
    }

    // Save to Airtable
    await saveLead(lead, client, aiReply);
  }

  // ── PHONE NUMBER UNLOCKED ─────────────────
  // Thumbtack sends this after the first reply is sent
  if (data.eventType === 'lead.updated') {
    const phone = data.lead?.customerPhone || data.customerPhone;
    const negotiationId = data.negotiationId || data.lead?.negotiationId;

    if (phone && negotiationId) {
      console.log(`[Lead] Phone unlocked: ${phone}`);

      // Load client and find their lead record
      const client = await getClientById(clientId);
      if (!client) return;

      // Send a direct text from the client's Quo number
      const followUpText =
        `Hi, this is ${client.ownerName} from ${client.businessName} — ` +
        `just replied to your Thumbtack message! Feel free to text or call us ` +
        `here directly too. ${client.calendlyLink ? `Book a time here: ${client.calendlyLink}` : ''}`.trim();

      await textLead(phone, followUpText, client.quoPhoneId);
      console.log('[Lead] ✅ Follow-up text sent via Quo');

      // Update the lead record with the phone number
      // Find the lead by negotiation ID
      try {
        const Airtable = require('airtable');
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
        const records = await base('Leads').select({
          filterByFormula: `{Negotiation ID} = "${negotiationId}"`,
          maxRecords: 1
        }).firstPage();

        if (records.length) {
          await updateLead(records[0].id, { 'Lead Phone': phone, 'Status': 'Qualified' });
        }
      } catch (e) {
        console.error('[Lead] Could not update phone in Airtable:', e.message);
      }
    }
  }
}

// ─────────────────────────────────────────────
// TEST ENDPOINT
// POST /test with header x-webhook-secret to
// run a fake lead through the full system
// ─────────────────────────────────────────────
app.post('/test', async (req, res) => {
  if (req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const clientName = req.body.clientName || 'Test Client';
  res.json({ message: 'Test running — check server logs' });

  const client = await getClientByName(clientName).catch(() => null);
  if (!client) return console.log('[Test] Client not found:', clientName);

  const fakeLead = {
    source: 'thumbtack',
    leadName: 'Nicole W.',
    serviceType: 'Local Moving (under 50 miles)',
    location: 'Brandon, FL 33511',
    dates: 'May 12, 15',
    jobDetails: {
      'Move distance': '11-20 miles',
      'Move size': '3 bedroom home',
      'Loading': 'Flat, no stairs',
      'Unloading': 'Flat, no stairs'
    },
    message: 'Looking for movers available around May 12.',
    negotiationId: 'test-' + Date.now(),
    phone: ''
  };

  const aiReply = await generateFirstReply(fakeLead, client);
  console.log('\n[Test] ✅ AI reply generated:');
  console.log(aiReply);
  console.log('\n[Test] Lead would be saved to Airtable and owner notified.');
});

// ─────────────────────────────────────────────
// FOLLOW-UP SCHEDULER
// Runs every hour — sends follow-ups to leads
// that haven't responded after 24/48/72 hours
// ─────────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  console.log('[Cron] Checking for follow-ups...');
  const leads = await getLeadsNeedingFollowUp().catch(() => []);

  for (const lead of leads) {
    const client = await getClientByName(lead.clientName).catch(() => null);
    if (!client || !client.isActive) continue;

    const followUpNum = (lead.followUpCount || 0) + 1;
    const message = await generateFollowUp(lead, client, followUpNum);

    if (lead.leadPhone && client.quoPhoneId) {
      await textLead(lead.leadPhone, message, client.quoPhoneId);
      await updateLead(lead.id, {
        'Follow Up Count': followUpNum,
        'Notes': `Follow-up #${followUpNum} sent ${new Date().toLocaleString()}`
      });
      console.log(`[Cron] Follow-up #${followUpNum} sent to ${lead.leadName}`);
    }
  }
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 LeadFlow running on port ${PORT}`);
  console.log(`🌐 ${APP_URL}`);
  console.log(`\nURLs for Thumbtack application:`);
  console.log(`  Homepage:  ${APP_URL}`);
  console.log(`  OAuth:     ${APP_URL}/auth/thumbtack/callback`);
  console.log(`  Webhook:   ${APP_URL}/webhook/thumbtack/:clientId`);
  console.log(`========================================\n`);
});

module.exports = app;
