// airtable.js — All database reads and writes
const Airtable = require('airtable');
require('dotenv').config();

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Get client info by their Airtable record ID
async function getClientById(clientId) {
  try {
    const record = await base('Clients').find(clientId);
    return buildClient(record);
  } catch (err) {
    console.error('[Airtable] getClientById error:', err.message);
    return null;
  }
}

// Get client info by business name
async function getClientByName(name) {
  try {
    const records = await base('Clients').select({
      filterByFormula: `{Business Name} = "${name}"`,
      maxRecords: 1
    }).firstPage();
    if (!records.length) return null;
    return buildClient(records[0]);
  } catch (err) {
    console.error('[Airtable] getClientByName error:', err.message);
    return null;
  }
}

// Build a clean client object from an Airtable record
function buildClient(record) {
  return {
    id: record.id,
    businessName: record.get('Business Name') || '',
    ownerName: record.get('Owner Name') || '',
    ownerPhone: record.get('Owner Phone') || '',
    ownerEmail: record.get('Owner Email') || '',
    serviceArea: record.get('Service Area') || '',
    serviceType: record.get('Service Type') || '',
    servicesOffered: record.get('Services Offered') || '',
    servicesNotOffered: record.get('Services NOT Offered') || '',
    twilioNumber: record.get('Twilio Number') || '',
    quoPhoneId: record.get('Quo Phone ID') || '',
    calendlyLink: record.get('Calendly Link') || '',
    thumbtackAccessToken: record.get('Thumbtack Access Token') || '',
    thumbtackRefreshToken: record.get('Thumbtack Refresh Token') || '',
    thumbtackTokenExpiresAt: record.get('Thumbtack Token Expires At') || '',
    thumbtackConnected: record.get('Thumbtack Connected') || false,
    isActive: record.get('Active') || false
  };
}

// Save a new lead to Airtable
async function saveLead(lead, client, aiReply) {
  try {
    const record = await base('Leads').create({
      'Client Name': client.businessName,
      'Lead Name': lead.leadName || 'Unknown',
      'Lead Phone': lead.phone || '',
      'Service Requested': lead.serviceType || '',
      'Lead Source': 'Thumbtack',
      'Status': 'Contacted',
      'AI Response': aiReply,
      'Date Received': new Date().toISOString().split('T')[0],
      'Location': lead.location || '',
      'Negotiation ID': lead.negotiationId || ''
    });
    console.log(`[Airtable] Lead saved: ${record.id}`);
    return record.id;
  } catch (err) {
    console.error('[Airtable] saveLead error:', err.message);
    return null;
  }
}

// Update a lead record
async function updateLead(recordId, fields) {
  try {
    await base('Leads').update(recordId, fields);
  } catch (err) {
    console.error('[Airtable] updateLead error:', err.message);
  }
}

// Save Thumbtack OAuth tokens for a client
async function saveClientTokens(clientId, tokens) {
  try {
    await base('Clients').update(clientId, {
      'Thumbtack Access Token': tokens.accessToken,
      'Thumbtack Refresh Token': tokens.refreshToken,
      'Thumbtack Token Expires At': tokens.expiresAt,
      'Thumbtack Connected': true
    });
    console.log(`[Airtable] Tokens saved for client: ${clientId}`);
  } catch (err) {
    console.error('[Airtable] saveClientTokens error:', err.message);
  }
}

// Get leads needing follow-up (contacted 24+ hours ago, no response)
async function getLeadsNeedingFollowUp() {
  try {
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    const dateStr = yesterday.toISOString().split('T')[0];

    const records = await base('Leads').select({
      filterByFormula: `AND({Status} = "Contacted", {Date Received} <= "${dateStr}", {Follow Up Count} < 3)`
    }).all();

    return records.map(r => ({
      id: r.id,
      leadName: r.get('Lead Name'),
      leadPhone: r.get('Lead Phone'),
      clientName: r.get('Client Name'),
      serviceRequested: r.get('Service Requested'),
      followUpCount: r.get('Follow Up Count') || 0
    }));
  } catch (err) {
    console.error('[Airtable] getLeadsNeedingFollowUp error:', err.message);
    return [];
  }
}

module.exports = {
  getClientById,
  getClientByName,
  saveLead,
  updateLead,
  saveClientTokens,
  getLeadsNeedingFollowUp
};
