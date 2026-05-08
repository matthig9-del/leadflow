// ============================================
// TWILIO SMS
// Sends text messages on behalf of your clients.
// Used for:
// 1. Notifying the business owner of new leads
// 2. Sending follow-up texts to leads who gave
//    their number (after the first Thumbtack reply)
// ============================================

const twilio = require('twilio');
require('dotenv').config();

// Create the Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Sends an SMS notification to the business owner
 * when a new lead comes in and has been auto-replied to.
 *
 * @param {string} ownerPhone - the owner's cell phone number
 * @param {object} lead - the lead details
 * @param {string} aiReply - what the AI said to the lead
 * @param {string} leadUrl - direct link to the lead
 */
async function notifyOwner(ownerPhone, lead, aiReply, leadUrl) {
  console.log(`[Twilio] Notifying owner at ${ownerPhone}`);

  // Build a clean, easy-to-read notification
  const message = `🔔 NEW LEAD — LeadFlow

👤 ${lead.leadName || 'New Customer'}
🔧 ${lead.serviceType || 'Service request'}
📍 ${lead.location || 'Location not specified'}
${lead.dates ? `📅 ${lead.dates}` : ''}

✅ AI reply already sent:
"${aiReply.substring(0, 120)}${aiReply.length > 120 ? '...' : ''}"

${leadUrl ? `👉 View lead: ${leadUrl}` : ''}`;

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_NUMBER || '+15555555555',
      to: ownerPhone
    });
    console.log('[Twilio] ✅ Owner notified');

  } catch (error) {
    console.error('[Twilio] Error notifying owner:', error.message);
  }
}

/**
 * Sends an SMS directly to a lead
 * Used when we have the lead's phone number
 * (after they respond to the first Thumbtack message)
 *
 * @param {string} leadPhone - the lead's phone number
 * @param {string} message - the message to send
 * @param {string} fromNumber - the client's Twilio number to send from
 */
async function sendLeadSMS(leadPhone, message, fromNumber) {
  console.log(`[Twilio] Sending SMS to lead at ${leadPhone}`);

  try {
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: leadPhone
    });

    console.log(`[Twilio] ✅ SMS sent, SID: ${result.sid}`);
    return result.sid;

  } catch (error) {
    console.error('[Twilio] Error sending SMS:', error.message);
    return null;
  }
}

/**
 * Sends a pre-written AI reply to the owner with a Thumbtack deep link
 * so they can paste it in one tap.
 * Used as a backup when browser automation isn't running.
 *
 * @param {string} ownerPhone - the owner's cell phone
 * @param {object} lead - the lead details
 * @param {string} aiReply - the message to paste into Thumbtack
 * @param {string} thumbtackUrl - direct link to open the lead
 * @param {string} fromNumber - Twilio number to send from
 */
async function sendOwnerDraftReply(ownerPhone, lead, aiReply, thumbtackUrl, fromNumber) {
  console.log(`[Twilio] Sending draft reply to owner`);

  const message = `📋 NEW LEAD: ${lead.leadName || 'Customer'}
${lead.serviceType} — ${lead.location}

Copy & paste this reply into Thumbtack:
———
${aiReply}
———

👉 Open lead now:
${thumbtackUrl}`;

  try {
    await client.messages.create({
      body: message,
      from: fromNumber || process.env.TWILIO_NUMBER,
      to: ownerPhone
    });
    console.log('[Twilio] ✅ Draft reply sent to owner');

  } catch (error) {
    console.error('[Twilio] Error sending draft:', error.message);
  }
}

module.exports = { notifyOwner, sendLeadSMS, sendOwnerDraftReply };
