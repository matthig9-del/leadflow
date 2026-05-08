// sms.js — Send SMS via Quo (your existing business phone)
const axios = require('axios');
require('dotenv').config();

const QUO_API_KEY = process.env.QUO_API_KEY;
const DEFAULT_PHONE_ID = process.env.QUO_PHONE_ID;

// Send a text message via Quo
async function sendSMS(toPhone, message, fromPhoneId) {
  try {
    const res = await axios.post(
      'https://api.openphone.com/v1/messages',
      {
        content: message,
        from: fromPhoneId || DEFAULT_PHONE_ID,
        to: [toPhone]
      },
      {
        headers: {
          'Authorization': QUO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`[SMS] Sent to ${toPhone}`);
    return res.data;
  } catch (err) {
    console.error('[SMS] Error:', err.response?.data || err.message);
    return null;
  }
}

// Notify the business owner when a new lead comes in
async function notifyOwner(ownerPhone, lead, aiReply, leadUrl) {
  const message =
    `🔔 NEW LEAD — LeadFlow\n\n` +
    `👤 ${lead.leadName || 'New Customer'}\n` +
    `🔧 ${lead.serviceType || 'Service request'}\n` +
    `📍 ${lead.location || 'Location not specified'}\n` +
    (lead.dates ? `📅 ${lead.dates}\n` : '') +
    `\n✅ AI replied inside Thumbtack automatically.\n` +
    (leadUrl ? `\n👉 View: ${leadUrl}` : '');

  return sendSMS(ownerPhone, message, DEFAULT_PHONE_ID);
}

// Text the lead directly after phone number is unlocked
async function textLead(leadPhone, message, clientPhoneId) {
  return sendSMS(leadPhone, message, clientPhoneId || DEFAULT_PHONE_ID);
}

module.exports = { sendSMS, notifyOwner, textLead };
