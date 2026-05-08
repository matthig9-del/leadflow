// ============================================
// LEADFLOW SERVER
// This is the main file that runs everything.
// It:
// 1. Listens for new lead emails from Make.com
// 2. Parses the lead details
// 3. Generates an AI reply
// 4. Sends the reply via Thumbtack browser automation
//    OR via email thread (fallback)
// 5. Notifies the business owner by SMS
// 6. Logs everything to Airtable
// ============================================

const express = require('express');
const cron = require('node-cron');
require('dotenv').config();

// Import all our modules
const { parseLeadEmail } = require('./email-parser');
const { generateFirstReply, generateFollowUp, scoreLead } = require('./ai');
const { sendThumbtackReply, testThumbtackLogin } = require('./thumbtack');
const { sendEmailReply } = require('./email-sender');
const { notifyOwner, sendOwnerDraftReply } = require('./twilio');
const {
  getClientByEmail,
  getClientByName,
  saveLead,
  updateLeadStatus,
  getLeadsNeedingFollowUp
} = require('./airtable');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse incoming JSON and text data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// HEALTH CHECK ENDPOINT
// Visit yourdomain.com/health to confirm
// the server is running
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'LeadFlow is running ✅',
    time: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ============================================
// MAIN WEBHOOK — NEW LEAD RECEIVED
// Make.com calls this URL every time a new
// lead email arrives in your client's inbox.
//
// Make.com sends the email data as JSON:
// {
//   "secret": "your-webhook-secret",
//   "clientName": "Tampa Plumbing Co.",
//   "email": {
//     "from": "noreply@thumbtack.com",
//     "replyTo": "reply-12345@mail.thumbtack.com",
//     "subject": "New lead: Local Moving",
//     "text": "Nicole W. wants Local Moving...",
//     "messageId": "<abc123@thumbtack.com>"
//   }
// }
// ============================================
app.post('/webhook/new-lead', async (req, res) => {
  console.log('\n========================================');
  console.log('[Server] 📬 New lead webhook received!');
  console.log('========================================');

  // Verify the request is really from Make.com
  // using the secret key you set in your .env file
  const secret = req.headers['x-webhook-secret'] || req.body.secret;
  if (secret !== process.env.WEBHOOK_SECRET) {
    console.log('[Server] ❌ Invalid webhook secret — rejecting request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Tell Make.com we received it immediately
  // (Make.com will timeout if we don't respond within 40 seconds)
  res.json({ received: true, message: 'Processing lead...' });

  // Now process the lead asynchronously
  // (this runs in the background after we've already responded)
  processNewLead(req.body).catch(error => {
    console.error('[Server] Error processing lead:', error);
  });
});

// ============================================
// THE CORE LEAD PROCESSING FUNCTION
// This is where all the magic happens
// ============================================
async function processNewLead(webhookData) {
  try {
    const { clientName, email } = webhookData;

    if (!email) {
      console.log('[Server] No email data in webhook — skipping');
      return;
    }

    // ---- STEP 1: PARSE THE EMAIL ----
    console.log('[Server] Step 1: Parsing email...');
    const lead = parseLeadEmail(email);
    console.log(`[Server] Lead: ${lead.leadName}, Service: ${lead.serviceType}, Source: ${lead.source}`);

    // ---- STEP 2: GET THE CLIENT'S INFO FROM AIRTABLE ----
    console.log('[Server] Step 2: Looking up client...');
    let client = null;

    if (clientName) {
      // Make.com sends the client name with each webhook
      client = await getClientByName(clientName);
    }

    if (!client) {
      console.log('[Server] ❌ Client not found — cannot process lead');
      return;
    }

    if (!client.isActive) {
      console.log(`[Server] Client ${client.businessName} is inactive — skipping`);
      return;
    }

    console.log(`[Server] Found client: ${client.businessName}`);

    // ---- STEP 3: SCORE THE LEAD ----
    console.log('[Server] Step 3: Scoring lead quality...');
    const leadScore = await scoreLead(lead, client);
    console.log(`[Server] Lead score: ${leadScore}/10`);

    // ---- STEP 4: GENERATE AI REPLY ----
    console.log('[Server] Step 4: Generating AI reply...');
    const aiReply = await generateFirstReply(lead, client);
    console.log(`[Server] AI reply generated (${aiReply.length} chars)`);

    // ---- STEP 5: SEND THE REPLY ----
    // We try three methods in order of preference:
    // Method A: Browser automation (fully automatic, sends inside Thumbtack)
    // Method B: Email thread reply (works for Yelp, sometimes Thumbtack)
    // Method C: SMS draft to owner (always works as fallback)
    console.log('[Server] Step 5: Sending reply...');

    let replySent = false;

    // METHOD A: Thumbtack browser automation
    // Only runs if the client has Thumbtack credentials stored
    // and the lead came from Thumbtack with a direct URL
    if (
      lead.source === 'thumbtack' &&
      lead.directLeadUrl &&
      client.thumbtackUsername &&
      client.thumbtackPassword
    ) {
      console.log('[Server] Attempting Thumbtack browser automation...');
      replySent = await sendThumbtackReply(
        lead.directLeadUrl,
        aiReply,
        client.thumbtackUsername,
        client.thumbtackPassword
      );

      if (replySent) {
        console.log('[Server] ✅ Reply sent via Thumbtack automation');
      } else {
        console.log('[Server] Thumbtack automation failed — trying email fallback');
      }
    }

    // METHOD B: Email thread reply
    // Works when we have the reply-to address from the notification email
    if (!replySent && email.replyTo) {
      console.log('[Server] Attempting email thread reply...');
      const { sendEmailReply } = require('./email-sender');
      replySent = await sendEmailReply(email, aiReply, client);

      if (replySent) {
        console.log('[Server] ✅ Reply sent via email thread');
      } else {
        console.log('[Server] Email reply failed — using SMS fallback');
      }
    }

    // METHOD C: SMS draft to owner (always works)
    if (!replySent) {
      console.log('[Server] Sending SMS draft to owner as fallback...');
      if (client.ownerPhone && client.twilioNumber) {
        await sendOwnerDraftReply(
          client.ownerPhone,
          lead,
          aiReply,
          lead.directLeadUrl,
          client.twilioNumber
        );
        console.log('[Server] ✅ Draft sent to owner via SMS');
        replySent = true; // Owner can paste it manually
      }
    }

    // ---- STEP 6: NOTIFY THE OWNER ----
    // Always notify the owner so they know what's happening
    if (client.ownerPhone && client.twilioNumber) {
      console.log('[Server] Step 6: Notifying owner...');
      await notifyOwner(
        client.ownerPhone,
        lead,
        aiReply,
        lead.directLeadUrl
      );
    }

    // ---- STEP 7: LOG TO AIRTABLE ----
    console.log('[Server] Step 7: Logging to Airtable...');
    const recordId = await saveLead(lead, client, aiReply, leadScore);

    console.log(`\n[Server] ✅ Lead processed successfully!`);
    console.log(`[Server] Lead: ${lead.leadName} | Score: ${leadScore}/10 | Reply sent: ${replySent}`);
    console.log('========================================\n');

  } catch (error) {
    console.error('[Server] ❌ Error in processNewLead:', error);
  }
}

// ============================================
// TEST ENDPOINT
// Use this to test your setup without
// needing a real lead email
//
// Send a POST request to /test with:
// { "clientName": "Your Client Name" }
// ============================================
app.post('/test', async (req, res) => {
  console.log('[Server] Running test with fake lead data...');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Fake lead data that mimics a real Thumbtack notification
  const testWebhookData = {
    clientName: req.body.clientName || 'Test Client',
    email: {
      from: 'noreply@thumbtack.com',
      replyTo: 'reply-test123@mail.thumbtack.com',
      subject: 'New lead: Local Moving (under 50 miles)',
      messageId: '<test123@thumbtack.com>',
      text: `Nicole W.
Direct lead

Local Moving (under 50 miles)

Brandon, FL 33511
Dates: May 12, 15
Open to other dates you suggest
You can call this customer after you reply.

Move distance: 11 - 20 miles
Loading: Load flat; no stairs or elevator
Move size: 3 bedroom home
Move type: Movers only
Unloading: Unload flat; no stairs or elevator
Travel preferences: Professionals may travel to my address

View direct lead: https://www.thumbtack.com/pro/leads/test-lead-123`
    }
  };

  res.json({ message: 'Test started — check server logs for output' });

  await processNewLead(testWebhookData).catch(console.error);
});

// ============================================
// TEST THUMBTACK LOGIN
// Call this to verify a client's Thumbtack
// credentials are correct before going live
//
// POST /test-login
// { "username": "email@example.com", "password": "their-password" }
// ============================================
app.post('/test-login', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const success = await testThumbtackLogin(username, password);
  res.json({
    success,
    message: success
      ? 'Login works! Thumbtack automation is ready.'
      : 'Login failed. Check the username and password.'
  });
});

// ============================================
// FOLLOW-UP SCHEDULER
// Runs every hour and checks for leads that
// need a follow-up message sent.
// After 24 hours with no response → follow-up 1
// After 48 hours → follow-up 2
// After 72 hours → final follow-up
// ============================================
cron.schedule('0 * * * *', async () => {
  console.log('[Scheduler] Checking for leads needing follow-up...');

  try {
    const leadsToFollowUp = await getLeadsNeedingFollowUp();

    for (const lead of leadsToFollowUp) {
      const client = await getClientByName(lead.clientName);
      if (!client || !client.isActive) continue;

      const followUpNumber = (lead.followUpCount || 0) + 1;
      const message = await generateFollowUp(lead, client, followUpNumber);

      // Send follow-up via SMS if we have their number
      if (lead.leadPhone && client.twilioNumber) {
        const { sendLeadSMS } = require('./twilio');
        await sendLeadSMS(lead.leadPhone, message, client.twilioNumber);
      }

      // Update the follow-up count in Airtable
      await updateLeadStatus(lead.id, 'Contacted',
        `Follow-up #${followUpNumber} sent on ${new Date().toLocaleString()}`
      );

      console.log(`[Scheduler] Follow-up #${followUpNumber} sent for lead: ${lead.leadName}`);
    }

  } catch (error) {
    console.error('[Scheduler] Error in follow-up cron:', error);
  }
});

// ============================================
// START THE SERVER
// ============================================
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`🚀 LeadFlow server running on port ${PORT}`);
  console.log(`📡 Webhook URL: http://yourdomain.com/webhook/new-lead`);
  console.log(`🏥 Health check: http://yourdomain.com/health`);
  console.log('========================================\n');
});

module.exports = app;
