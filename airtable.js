// ============================================
// AIRTABLE DATABASE
// This file handles all communication with
// your Airtable database:
// - Reading client info (business name, area, etc.)
// - Logging new leads
// - Updating lead status
// ============================================

const Airtable = require('airtable');
require('dotenv').config();

// Connect to Airtable using your credentials
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);

// These are the names of your two Airtable tables
// Make sure they match EXACTLY what you named them
const LEADS_TABLE = 'Leads';
const CLIENTS_TABLE = 'Clients';

/**
 * Gets a client's full info from Airtable
 * Called every time a new lead comes in so we know
 * how to customize the AI reply for that specific business
 *
 * @param {string} clientEmail - the email address the lead notification was sent to
 * @returns {object|null} - the client's info, or null if not found
 */
async function getClientByEmail(clientEmail) {
  console.log(`[Airtable] Looking up client by email: ${clientEmail}`);

  try {
    // Search the Clients table for a record matching this email
    const records = await base(CLIENTS_TABLE).select({
      filterByFormula: `{Owner Email} = "${clientEmail}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) {
      console.log('[Airtable] No client found for this email');
      return null;
    }

    const record = records[0];

    // Pull out all the fields we need
    const client = {
      id: record.id,
      businessName: record.get('Business Name') || '',
      ownerName: record.get('Owner Name') || '',
      ownerPhone: record.get('Owner Phone') || '',
      ownerEmail: record.get('Owner Email') || '',
      serviceArea: record.get('Service Area') || '',
      servicesOffered: record.get('Services Offered') || '',
      servicesNotOffered: record.get('Services NOT Offered') || '',
      twilioNumber: record.get('Twilio Number') || '',
      calendlyLink: record.get('Calendly Link') || '',
      thumbtackUsername: record.get('Thumbtack Username') || '',
      thumbtackPassword: record.get('Thumbtack Password') || '',
      serviceType: record.get('Service Type') || '',
      isActive: record.get('Active') || false
    };

    console.log(`[Airtable] Found client: ${client.businessName}`);
    return client;

  } catch (error) {
    console.error('[Airtable] Error fetching client:', error.message);
    return null;
  }
}

/**
 * Gets a client's info by their business name
 * Alternative lookup method
 *
 * @param {string} businessName - the exact business name in Airtable
 * @returns {object|null} - the client's info
 */
async function getClientByName(businessName) {
  try {
    const records = await base(CLIENTS_TABLE).select({
      filterByFormula: `{Business Name} = "${businessName}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) return null;

    const record = records[0];
    return {
      id: record.id,
      businessName: record.get('Business Name') || '',
      ownerName: record.get('Owner Name') || '',
      ownerPhone: record.get('Owner Phone') || '',
      ownerEmail: record.get('Owner Email') || '',
      serviceArea: record.get('Service Area') || '',
      servicesOffered: record.get('Services Offered') || '',
      servicesNotOffered: record.get('Services NOT Offered') || '',
      twilioNumber: record.get('Twilio Number') || '',
      calendlyLink: record.get('Calendly Link') || '',
      thumbtackUsername: record.get('Thumbtack Username') || '',
      thumbtackPassword: record.get('Thumbtack Password') || '',
      serviceType: record.get('Service Type') || '',
      isActive: record.get('Active') || false
    };
  } catch (error) {
    console.error('[Airtable] Error fetching client by name:', error.message);
    return null;
  }
}

/**
 * Saves a new lead to the Leads table in Airtable
 * Called every time a new lead comes in
 *
 * @param {object} lead - the parsed lead data
 * @param {object} client - the client this lead belongs to
 * @param {string} aiReply - the AI-generated reply we sent
 * @param {number} leadScore - quality score 1-10
 * @returns {string|null} - the new record's ID (useful for updating later)
 */
async function saveLead(lead, client, aiReply, leadScore) {
  console.log(`[Airtable] Saving lead: ${lead.leadName} for ${client.businessName}`);

  try {
    const record = await base(LEADS_TABLE).create({
      'Client Name': client.businessName,
      'Lead Name': lead.leadName || 'Unknown',
      'Lead Phone': lead.phone || '',
      'Lead Email': lead.email || '',
      'Service Requested': lead.serviceType || '',
      'Lead Source': lead.source === 'thumbtack' ? 'Thumbtack' :
                     lead.source === 'yelp' ? 'Yelp' : 'Website',
      'Status': 'Contacted',
      'AI Response': aiReply,
      'Lead Score': leadScore || 5,
      'Date Received': new Date().toISOString().split('T')[0],
      'Location': lead.location || '',
      'Job Details': JSON.stringify(lead.jobDetails || {}),
      'Direct Lead URL': lead.directLeadUrl || '',
      'Notes': `Auto-contacted by LeadFlow on ${new Date().toLocaleString()}`
    });

    console.log(`[Airtable] ✅ Lead saved with ID: ${record.id}`);
    return record.id;

  } catch (error) {
    console.error('[Airtable] Error saving lead:', error.message);
    return null;
  }
}

/**
 * Updates the status of an existing lead
 * Used when a lead responds, books, or goes cold
 *
 * @param {string} recordId - the Airtable record ID
 * @param {string} status - new status: 'Contacted', 'Qualified', 'Booked', 'Declined', 'No Response'
 * @param {string} notes - optional additional notes to add
 */
async function updateLeadStatus(recordId, status, notes) {
  console.log(`[Airtable] Updating lead ${recordId} to status: ${status}`);

  try {
    const updates = { 'Status': status };
    if (notes) updates['Notes'] = notes;

    await base(LEADS_TABLE).update(recordId, updates);
    console.log(`[Airtable] ✅ Lead updated successfully`);

  } catch (error) {
    console.error('[Airtable] Error updating lead:', error.message);
  }
}

/**
 * Gets all leads that need a follow-up
 * These are leads with status 'Contacted' that are more than 24 hours old
 * The follow-up scheduler calls this every hour
 *
 * @returns {array} - list of leads that need following up
 */
async function getLeadsNeedingFollowUp() {
  console.log('[Airtable] Checking for leads needing follow-up...');

  try {
    // Calculate 24 hours ago
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const records = await base(LEADS_TABLE).select({
      filterByFormula: `AND(
        {Status} = "Contacted",
        {Date Received} <= "${yesterdayStr}",
        {Follow Up Count} < 3
      )`
    }).all();

    const leads = records.map(record => ({
      id: record.id,
      leadName: record.get('Lead Name'),
      leadPhone: record.get('Lead Phone'),
      clientName: record.get('Client Name'),
      serviceRequested: record.get('Service Requested'),
      followUpCount: record.get('Follow Up Count') || 0
    }));

    console.log(`[Airtable] Found ${leads.length} leads needing follow-up`);
    return leads;

  } catch (error) {
    console.error('[Airtable] Error fetching follow-up leads:', error.message);
    return [];
  }
}

module.exports = {
  getClientByEmail,
  getClientByName,
  saveLead,
  updateLeadStatus,
  getLeadsNeedingFollowUp
};
