// thumbtack.js — Thumbtack OAuth and official API calls
const axios = require('axios');
require('dotenv').config();

const CLIENT_ID = process.env.THUMBTACK_CLIENT_ID;
const CLIENT_SECRET = process.env.THUMBTACK_CLIENT_SECRET;
const REDIRECT_URI = process.env.THUMBTACK_REDIRECT_URI;
const AUTH_URL = 'https://auth.thumbtack.com/oauth2/auth';
const TOKEN_URL = 'https://auth.thumbtack.com/oauth2/token';
const API_BASE = 'https://pro-api.thumbtack.com';

// Generate the "Connect Thumbtack" URL for onboarding
function getConnectUrl(clientDbId) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'messages leads offline_access',
    state: clientDbId
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Exchange the auth code for access + refresh tokens
async function exchangeCodeForTokens(code) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }).toString(),
    { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt: new Date(Date.now() + res.data.expires_in * 1000).toISOString()
  };
}

// Refresh an expired access token
async function refreshAccessToken(refreshToken) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString(),
    { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt: new Date(Date.now() + res.data.expires_in * 1000).toISOString()
  };
}

// Get a valid token — refreshes automatically if expired
async function getValidToken(client) {
  const expiresAt = new Date(client.thumbtackTokenExpiresAt);
  const soonExpires = new Date(Date.now() + 5 * 60 * 1000);
  if (expiresAt < soonExpires) {
    const { saveClientTokens } = require('./airtable');
    const newTokens = await refreshAccessToken(client.thumbtackRefreshToken);
    await saveClientTokens(client.id, newTokens);
    return newTokens.accessToken;
  }
  return client.thumbtackAccessToken;
}

// Get all businesses for a connected client
async function getBusinesses(client) {
  const token = await getValidToken(client);
  const res = await axios.get(`${API_BASE}/v2/businesses`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.data.businesses || [];
}

// Create a webhook so Thumbtack sends leads to your server
async function createWebhook(client, businessId) {
  const token = await getValidToken(client);
  const webhookUrl = `${process.env.APP_URL}/webhook/thumbtack/${client.id}`;
  const res = await axios.post(
    `${API_BASE}/v2/businesses/${businessId}/webhooks`,
    { url: webhookUrl, eventTypes: ['lead.created', 'lead.updated', 'message.received'] },
    { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  console.log(`[Thumbtack] Webhook created: ${webhookUrl}`);
  return res.data;
}

// Send a message inside Thumbtack — this is the core function
async function sendMessage(client, negotiationId, messageText) {
  const token = await getValidToken(client);
  const res = await axios.post(
    `${API_BASE}/v2/negotiations/${negotiationId}/messages`,
    { text: messageText },
    { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  console.log(`[Thumbtack] Message sent for negotiation: ${negotiationId}`);
  return res.data;
}

// Get full lead details from Thumbtack
async function getLeadDetails(client, negotiationId) {
  try {
    const token = await getValidToken(client);
    const res = await axios.get(`${API_BASE}/v2/negotiations/${negotiationId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.data;
  } catch (err) {
    console.error('[Thumbtack] getLeadDetails error:', err.message);
    return null;
  }
}

module.exports = {
  getConnectUrl,
  exchangeCodeForTokens,
  getValidToken,
  getBusinesses,
  createWebhook,
  sendMessage,
  getLeadDetails
};
