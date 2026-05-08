// ============================================
// EMAIL SENDER
// Sends replies back through email threads.
// When you reply to a Thumbtack/Yelp notification
// email, it goes back to the lead through their
// platform's messaging system.
// ============================================

const nodemailer = require('nodemailer');
require('dotenv').config();

// Create the email sending client using Gmail
// You need to set up a Gmail App Password for this
// (regular Gmail password won't work)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

/**
 * Sends a reply to a lead notification email
 * This maintains the email thread so Thumbtack/Yelp
 * routes the reply into the app conversation
 *
 * @param {object} originalEmail - the original notification email
 * @param {string} replyText - the AI-generated reply
 * @param {object} client - the business client info
 * @returns {boolean} - true if sent successfully
 */
async function sendEmailReply(originalEmail, replyText, client) {
  console.log(`[Email] Sending reply for lead from ${client.businessName}`);

  // The reply-to address from the original email
  // This is what routes our reply back into the platform
  const replyToAddress = originalEmail.replyTo || originalEmail.from;

  try {
    await transporter.sendMail({
      from: `${client.businessName} <${process.env.GMAIL_USER}>`,
      to: replyToAddress,

      // Keep the same subject with "Re:" prefix
      // This maintains the email thread
      subject: `Re: ${originalEmail.subject}`,

      // Threading headers — these tell email servers this is a reply
      // to the original email, not a new message
      inReplyTo: originalEmail.messageId,
      references: originalEmail.messageId,

      text: replyText,

      // HTML version looks nicer in email clients
      html: `<p>${replyText.replace(/\n/g, '<br>')}</p>`
    });

    console.log(`[Email] ✅ Reply sent to: ${replyToAddress}`);
    return true;

  } catch (error) {
    console.error('[Email] Error sending reply:', error.message);
    return false;
  }
}

/**
 * Tests that your Gmail credentials work
 * Run this once during setup to confirm everything is configured
 */
async function testEmailSetup() {
  console.log('[Email] Testing Gmail connection...');

  try {
    await transporter.verify();
    console.log('[Email] ✅ Gmail connection works!');
    return true;
  } catch (error) {
    console.error('[Email] ❌ Gmail connection failed:', error.message);
    console.error('[Email] Make sure you are using an App Password, not your regular Gmail password');
    console.error('[Email] Get one at: myaccount.google.com/apppasswords');
    return false;
  }
}

module.exports = { sendEmailReply, testEmailSetup };
