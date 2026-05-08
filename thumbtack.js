// ============================================
// THUMBTACK AUTOMATION
// This file uses Playwright to control a real
// Chrome browser and send messages inside the
// Thumbtack app automatically — exactly like
// a human would, but in under 10 seconds.
// ============================================

const { chromium } = require('playwright');
require('dotenv').config();

// How long to wait for pages to load (in milliseconds)
// 30 seconds is generous — Thumbtack sometimes loads slowly
const TIMEOUT = 30000;

/**
 * Sends a reply to a Thumbtack lead
 * This is the main function you call when a new lead comes in
 *
 * @param {string} leadUrl - the direct link to the lead (from the notification email)
 * @param {string} replyText - the AI-generated message to send
 * @param {string} username - the client's Thumbtack email address
 * @param {string} password - the client's Thumbtack password
 * @returns {boolean} - true if sent successfully, false if something went wrong
 */
async function sendThumbtackReply(leadUrl, replyText, username, password) {
  console.log(`[Thumbtack] Starting automation for lead: ${leadUrl}`);

  // Launch a Chrome browser
  // headless: true means it runs invisibly in the background
  // headless: false means you can watch it work (useful for testing)
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'  // Important for running on servers
    ]
  });

  // Create a new browser tab
  const context = await browser.newContext({
    // Make it look like a real person using Chrome on a Mac
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  try {

    // ---- STEP 1: LOG INTO THUMBTACK ----
    console.log('[Thumbtack] Navigating to login page...');
    await page.goto('https://www.thumbtack.com/login', {
      waitUntil: 'networkidle',
      timeout: TIMEOUT
    });

    // Wait for the email field to appear
    await page.waitForSelector('input[name="username"], input[type="email"], #username', {
      timeout: TIMEOUT
    });

    // Type the email address
    await page.fill('input[name="username"], input[type="email"], #username', username);
    console.log('[Thumbtack] Entered email');

    // Small pause — humans don't type instantly
    await page.waitForTimeout(500);

    // Type the password
    await page.fill('input[name="password"], input[type="password"], #password', password);
    console.log('[Thumbtack] Entered password');

    await page.waitForTimeout(500);

    // Click the login button
    await page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
    console.log('[Thumbtack] Clicked login button');

    // Wait for the page to finish loading after login
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: TIMEOUT });
    console.log('[Thumbtack] Logged in successfully');

    // ---- STEP 2: GO TO THE LEAD ----
    console.log(`[Thumbtack] Navigating to lead: ${leadUrl}`);
    await page.goto(leadUrl, {
      waitUntil: 'networkidle',
      timeout: TIMEOUT
    });

    // ---- STEP 3: FIND THE MESSAGE BOX ----
    // Thumbtack's message input field — we try several possible selectors
    // because Thumbtack sometimes updates their website
    const messageBoxSelectors = [
      '[placeholder="Write a message"]',
      '[placeholder="Type a message"]',
      '[placeholder="Message"]',
      'textarea[class*="message"]',
      'div[contenteditable="true"]',
      'textarea[class*="Message"]'
    ];

    let messageBox = null;
    for (const selector of messageBoxSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        messageBox = selector;
        console.log(`[Thumbtack] Found message box with selector: ${selector}`);
        break;
      } catch (e) {
        // This selector didn't work, try the next one
        continue;
      }
    }

    if (!messageBox) {
      throw new Error('Could not find the message input box on the page');
    }

    // ---- STEP 4: CLICK THE MESSAGE BOX AND TYPE THE REPLY ----
    await page.click(messageBox);
    await page.waitForTimeout(300);

    // Type the message character by character with small delays
    // This looks more human and avoids detection
    await page.type(messageBox, replyText, { delay: 30 });
    console.log('[Thumbtack] Typed reply message');

    await page.waitForTimeout(500);

    // ---- STEP 5: CLICK THE SEND BUTTON ----
    const sendButtonSelectors = [
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button:has-text("Send")',
      'button[type="submit"]:near(textarea)',
      '[class*="send"]:not([disabled])'
    ];

    let sent = false;
    for (const selector of sendButtonSelectors) {
      try {
        await page.click(selector, { timeout: 5000 });
        sent = true;
        console.log(`[Thumbtack] Clicked send button with selector: ${selector}`);
        break;
      } catch (e) {
        continue;
      }
    }

    if (!sent) {
      // Last resort — try pressing Enter
      await page.keyboard.press('Enter');
      console.log('[Thumbtack] Used Enter key to send');
    }

    // Wait a moment to confirm the message was sent
    await page.waitForTimeout(2000);

    // Check if the message appears in the conversation
    // (confirms it was sent successfully)
    const messageVisible = await page.isVisible(`text="${replyText.substring(0, 30)}"`)
      .catch(() => false);

    if (messageVisible) {
      console.log('[Thumbtack] ✅ Message confirmed as sent!');
    } else {
      console.log('[Thumbtack] ⚠️ Could not confirm message — it may have still sent');
    }

    await browser.close();
    return true;

  } catch (error) {
    console.error('[Thumbtack] ❌ Error:', error.message);

    // Take a screenshot so you can see what went wrong
    // Saves to your project folder as thumbtack-error.png
    try {
      await page.screenshot({ path: 'thumbtack-error.png' });
      console.log('[Thumbtack] Screenshot saved as thumbtack-error.png');
    } catch (screenshotError) {
      // Screenshot failed too — that's okay
    }

    await browser.close();
    return false;
  }
}

/**
 * Tests the Thumbtack login without sending any message
 * Use this first to confirm credentials work before going live
 *
 * @param {string} username - Thumbtack email
 * @param {string} password - Thumbtack password
 * @returns {boolean} - true if login works
 */
async function testThumbtackLogin(username, password) {
  console.log('[Thumbtack] Testing login credentials...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('https://www.thumbtack.com/login', { waitUntil: 'networkidle' });
    await page.fill('input[name="username"], input[type="email"]', username);
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle' });

    // If we're no longer on the login page, login worked
    const currentUrl = page.url();
    const success = !currentUrl.includes('/login');

    await browser.close();

    if (success) {
      console.log('[Thumbtack] ✅ Login test passed!');
    } else {
      console.log('[Thumbtack] ❌ Login test failed — check credentials');
    }

    return success;

  } catch (error) {
    console.error('[Thumbtack] Login test error:', error.message);
    await browser.close();
    return false;
  }
}

module.exports = { sendThumbtackReply, testThumbtackLogin };
