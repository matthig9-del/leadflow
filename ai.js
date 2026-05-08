// ai.js — Generates AI replies for leads using OpenAI
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateFirstReply(lead, client) {
  const jobDetails = Object.entries(lead.jobDetails || {})
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const systemPrompt = `You are a friendly assistant for ${client.businessName}, 
a ${client.serviceType || 'local service'} company serving ${client.serviceArea}.

Reply to this new Thumbtack lead. Rules:
1. Be warm and sound like a real person
2. Mention specific details from their request
3. Keep it to 3 sentences maximum
4. End with the booking link if they look like a good fit: ${client.calendlyLink || ''}
5. Sign off as ${client.ownerName} from ${client.businessName}
6. Never mention this is automated

Do NOT take this job if it involves: ${client.servicesNotOffered || 'nothing specified'}`;

  const userMessage = `Lead: ${lead.leadName || 'Customer'}
Service: ${lead.serviceType}
Location: ${lead.location}
Dates: ${lead.dates || 'flexible'}
Details:\n${jobDetails || 'none provided'}
Message: ${lead.message || 'none'}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 250,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });
    return res.choices[0].message.content.trim();
  } catch (err) {
    console.error('[AI] Error:', err.message);
    return `Hi ${lead.leadName || 'there'}, thanks for reaching out to ${client.businessName}! We'd love to help. What's the best number to reach you so we can get the details sorted quickly? — ${client.ownerName}`;
  }
}

async function generateFollowUp(lead, client, followUpNumber) {
  const contexts = {
    1: 'Gentle first follow-up, 24 hours later. Friendly, not pushy. 2 sentences.',
    2: 'Second follow-up, 48 hours later. Mention limited availability. 2 sentences.',
    3: 'Final follow-up. Keep door open. 2 sentences.'
  };

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      temperature: 0.7,
      messages: [
        { role: 'system', content: `You are following up for ${client.businessName}. ${contexts[followUpNumber]} Sign off as ${client.ownerName}.` },
        { role: 'user', content: `Customer: ${lead.leadName}. Service: ${lead.serviceType}. They haven't responded. Write follow-up #${followUpNumber}.` }
      ]
    });
    return res.choices[0].message.content.trim();
  } catch (err) {
    return `Hi ${lead.leadName || 'there'}, just following up from ${client.businessName}. Still available to help with ${lead.serviceType || 'your project'}! — ${client.ownerName}`;
  }
}

module.exports = { generateFirstReply, generateFollowUp };
