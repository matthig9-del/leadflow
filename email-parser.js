// ============================================
// EMAIL PARSER
// This file reads a Thumbtack or Yelp notification
// email and pulls out all the useful information —
// lead name, service type, location, dates, etc.
// ============================================

/**
 * Figures out whether an email came from Thumbtack or Yelp
 * @param {string} fromAddress - the email address it came from
 * @returns {string} - "thumbtack", "yelp", or "unknown"
 */
function detectSource(fromAddress) {
  if (!fromAddress) return 'unknown';
  const from = fromAddress.toLowerCase();
  if (from.includes('thumbtack.com')) return 'thumbtack';
  if (from.includes('yelp.com')) return 'yelp';
  return 'unknown';
}

/**
 * Parses a Thumbtack lead notification email
 * Thumbtack emails contain structured info like:
 * "Move size: 3 bedroom home"
 * "Move distance: 11-20 miles"
 * We pull all of that out into a clean object.
 *
 * @param {string} emailBody - the full text of the email
 * @param {string} emailSubject - the subject line
 * @returns {object} - clean lead data
 */
function parseThumbtackEmail(emailBody, emailSubject) {
  const lead = {
    source: 'thumbtack',
    leadName: '',
    serviceType: '',
    location: '',
    dates: '',
    jobDetails: {},
    rawBody: emailBody,
    directLeadUrl: '',
    replyToEmail: ''
  };

  // --- Extract lead name ---
  // Thumbtack puts the name at the top, e.g. "Nicole W."
  const nameMatch = emailBody.match(/^([A-Z][a-z]+\s+[A-Z]\.)/m);
  if (nameMatch) {
    lead.leadName = nameMatch[1].trim();
  }

  // --- Extract service type ---
  // Usually the subject line contains it, e.g. "New lead: Local Moving"
  const serviceFromSubject = emailSubject.match(/(?:New lead:|Request from .+ for)\s+(.+)/i);
  if (serviceFromSubject) {
    lead.serviceType = serviceFromSubject[1].trim();
  }

  // Also try to get it from the email body — it's often in a big bold heading
  const serviceFromBody = emailBody.match(/^(Local Moving|HVAC|Plumbing|Roofing|Cleaning|Electrical|Landscaping|Painting|[A-Z][a-z]+ [A-Za-z ]+)\n/m);
  if (serviceFromBody && !lead.serviceType) {
    lead.serviceType = serviceFromBody[1].trim();
  }

  // --- Extract location ---
  // Thumbtack format: "Brandon, FL 33511"
  const locationMatch = emailBody.match(/([A-Z][a-zA-Z\s]+,\s+[A-Z]{2}\s+\d{5})/);
  if (locationMatch) {
    lead.location = locationMatch[1].trim();
  }

  // --- Extract dates ---
  // Thumbtack format: "Dates: May 12, 15"
  const datesMatch = emailBody.match(/Dates?:\s+([^\n]+)/i);
  if (datesMatch) {
    lead.dates = datesMatch[1].trim();
  }

  // --- Extract all the job detail fields ---
  // These look like "Move size: 3 bedroom home"
  // We grab every "Label: Value" pair we can find
  const detailPattern = /^([A-Z][a-zA-Z\s]+):\s+([^\n]+)$/gm;
  let match;
  while ((match = detailPattern.exec(emailBody)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    // Skip fields we already captured
    if (!['Dates', 'Date'].includes(key)) {
      lead.jobDetails[key] = value;
    }
  }

  // --- Extract the direct lead URL ---
  // The "View direct lead" button contains a URL we can use
  const urlMatch = emailBody.match(/https:\/\/www\.thumbtack\.com\/pro\/[^\s">\]]+/);
  if (urlMatch) {
    lead.directLeadUrl = urlMatch[0];
  }

  return lead;
}

/**
 * Parses a Yelp lead notification email
 *
 * @param {string} emailBody - the full text of the email
 * @param {string} emailSubject - the subject line
 * @returns {object} - clean lead data
 */
function parseYelpEmail(emailBody, emailSubject) {
  const lead = {
    source: 'yelp',
    leadName: '',
    serviceType: '',
    location: '',
    message: '',
    jobDetails: {},
    rawBody: emailBody,
    directLeadUrl: '',
    replyToEmail: ''
  };

  // --- Extract lead name ---
  // Yelp format: "You have a new message from Sarah M."
  const nameMatch = emailBody.match(/message from ([A-Z][a-z]+(?:\s+[A-Z]\.?)?)/i);
  if (nameMatch) {
    lead.leadName = nameMatch[1].trim();
  }

  // --- Extract service type from subject ---
  const serviceMatch = emailSubject.match(/(?:about|for)\s+([^-\n]+)/i);
  if (serviceMatch) {
    lead.serviceType = serviceMatch[1].trim();
  }

  // --- Extract the customer's message ---
  // This is what they wrote when they submitted the request
  const messageMatch = emailBody.match(/Message:\s+([^]+?)(?=\n\n|\n[A-Z]|$)/i);
  if (messageMatch) {
    lead.message = messageMatch[1].trim();
  }

  // --- Extract location if present ---
  const locationMatch = emailBody.match(/([A-Z][a-zA-Z\s]+,\s+[A-Z]{2}(?:\s+\d{5})?)/);
  if (locationMatch) {
    lead.location = locationMatch[1].trim();
  }

  // --- Extract Yelp reply URL ---
  const urlMatch = emailBody.match(/https:\/\/(?:www\.)?yelp\.com\/[^\s">\]]+/);
  if (urlMatch) {
    lead.directLeadUrl = urlMatch[0];
  }

  return lead;
}

/**
 * MAIN FUNCTION — call this with any incoming email
 * It automatically detects the source and parses it correctly
 *
 * @param {object} email - object with { from, subject, text, replyTo }
 * @returns {object} - clean lead data ready to use
 */
function parseLeadEmail(email) {
  const source = detectSource(email.from);

  let lead;
  if (source === 'thumbtack') {
    lead = parseThumbtackEmail(email.text || email.html || '', email.subject || '');
  } else if (source === 'yelp') {
    lead = parseYelpEmail(email.text || email.html || '', email.subject || '');
  } else {
    // Unknown source — return raw data so AI can still try to respond
    lead = {
      source: 'unknown',
      leadName: '',
      serviceType: '',
      location: '',
      rawBody: email.text || email.html || '',
      jobDetails: {}
    };
  }

  // Always capture the reply-to address — this is how we reply back
  lead.replyToEmail = email.replyTo || email.from;

  console.log(`[Parser] Detected source: ${source}`);
  console.log(`[Parser] Lead name: ${lead.leadName || 'not found'}`);
  console.log(`[Parser] Service: ${lead.serviceType || 'not found'}`);
  console.log(`[Parser] Location: ${lead.location || 'not found'}`);

  return lead;
}

module.exports = { parseLeadEmail, detectSource };
