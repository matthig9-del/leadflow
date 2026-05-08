// ============================================
// AI REPLY GENERATOR
// This file talks to OpenAI and generates a
// personalized reply for each incoming lead.
// It uses all the lead details to make the
// reply sound specific and human, not generic.
// ============================================

const OpenAI = require('openai');
require('dotenv').config();

// Create the OpenAI client using your API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generates a personalized first reply to a new lead
 *
 * @param {object} lead - the parsed lead data from email-parser.js
 * @param {object} client - the business client info from Airtable
 * @returns {string} - the AI-written reply message
 */
async function generateFirstReply(lead, client) {
  console.log(`[AI] Generating first reply for lead: ${lead.leadName}`);

  // Build a summary of the job details to give the AI full context
  const jobDetailsText = Object.entries(lead.jobDetails || {})
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');

  // This is the system prompt — it tells the AI who it is and how to behave
  // The [brackets] get replaced with real client and lead data
  const systemPrompt = `You are a friendly, professional assistant for ${client.businessName}, 
a ${client.serviceType} company serving ${client.serviceArea}.

Your job is to reply to new customer inquiries from ${lead.source === 'thumbtack' ? 'Thumbtack' : 'Yelp'}.

RULES:
1. Be warm and conversational — sound like a real person, not a robot
2. Reference specific details from their request to show you read it
3. Keep your reply to 3-4 sentences maximum
4. End with a clear next step (either ask a qualifying question OR send the booking link)
5. Sign off as "${client.ownerName}" from "${client.businessName}"
6. NEVER mention that this is automated or AI-generated
7. If the job is outside "${client.serviceArea}" or matches any of these (${client.servicesNotOffered}), politely decline

${client.calendlyLink ? `BOOKING LINK: ${client.calendlyLink} — include this if the lead looks like a good fit` : ''}

SERVICES THIS BUSINESS OFFERS: ${client.servicesOffered}
SERVICES THIS BUSINESS DOES NOT OFFER: ${client.servicesNotOffered}`;

  // This is the user message — it contains all the lead details
  const userMessage = `New lead details:
- Customer name: ${lead.leadName || 'Customer'}
- Service requested: ${lead.serviceType || 'not specified'}
- Location: ${lead.location || 'not specified'}
- Dates: ${lead.dates || 'not specified'}
- Additional details:
${jobDetailsText || '- No additional details provided'}
- Customer message: ${lead.message || 'No message provided'}

Write a reply to this lead now.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',       // Fast and cheap — perfect for this
      max_tokens: 300,             // Keep replies short
      temperature: 0.7,            // Slight creativity so replies don't sound identical
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    const reply = response.choices[0].message.content.trim();
    console.log(`[AI] Generated reply: ${reply.substring(0, 100)}...`);
    return reply;

  } catch (error) {
    console.error('[AI] Error generating reply:', error.message);
    // Fallback reply if OpenAI fails — better than nothing
    return `Hi ${lead.leadName || 'there'}, thanks for reaching out to ${client.businessName}! We'd love to help. What's the best number to reach you so we can get the details sorted quickly?`;
  }
}

/**
 * Generates a follow-up message for leads that haven't responded
 * Sent automatically 24 hours after the first reply
 *
 * @param {object} lead - the original lead data
 * @param {object} client - the business client info
 * @param {number} followUpNumber - which follow-up this is (1, 2, or 3)
 * @returns {string} - the follow-up message
 */
async function generateFollowUp(lead, client, followUpNumber) {
  console.log(`[AI] Generating follow-up #${followUpNumber} for: ${lead.leadName}`);

  const followUpContext = {
    1: 'This is a gentle first follow-up, sent 24 hours after the first reply. Be friendly, not pushy.',
    2: 'This is a second follow-up, sent 48 hours after first contact. Create slight urgency — mention limited availability.',
    3: 'This is the final follow-up. Keep the door open for future business. Wish them well.'
  };

  const systemPrompt = `You are following up on behalf of ${client.businessName} with a potential customer.
${followUpContext[followUpNumber]}
Keep it to 2 sentences. Sign off as ${client.ownerName}.`;

  const userMessage = `Customer name: ${lead.leadName}
Service they needed: ${lead.serviceType}
They have not responded to our first message. Write follow-up #${followUpNumber}.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    return response.choices[0].message.content.trim();

  } catch (error) {
    console.error('[AI] Error generating follow-up:', error.message);
    return `Hi ${lead.leadName || 'there'}, just following up from ${client.businessName}. Are you still looking for help with ${lead.serviceType || 'your project'}? We'd love to assist!`;
  }
}

/**
 * Scores a lead from 1-10 based on how likely they are to convert
 * High score = good fit, send booking link immediately
 * Low score = needs more qualifying questions first
 *
 * @param {object} lead - the parsed lead data
 * @param {object} client - the business client info
 * @returns {number} - score from 1 to 10
 */
async function scoreLead(lead, client) {
  const systemPrompt = `You are a lead quality analyzer for a ${client.serviceType} business.
Score this lead from 1-10 based on:
- How specific their request is (vague = low, detailed = high)
- Whether the location matches the service area: ${client.serviceArea}
- Whether the service matches what the business offers: ${client.servicesOffered}
- Timeline urgency

Respond with ONLY a single number from 1 to 10. Nothing else.`;

  const userMessage = `Lead details:
Service: ${lead.serviceType}
Location: ${lead.location}
Details: ${JSON.stringify(lead.jobDetails)}
Message: ${lead.message || 'none'}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 5,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    const scoreText = response.choices[0].message.content.trim();
    const score = parseInt(scoreText);
    console.log(`[AI] Lead score: ${score}/10`);
    return isNaN(score) ? 5 : score;

  } catch (error) {
    console.error('[AI] Error scoring lead:', error.message);
    return 5; // Default to middle score if AI fails
  }
}

module.exports = { generateFirstReply, generateFollowUp, scoreLead };
