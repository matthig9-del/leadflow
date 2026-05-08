# LeadFlow — AI Lead Automation
## Complete Setup Guide (No Coding Experience Needed)

---

## What this software does

When a new lead comes in on Thumbtack or Yelp:
1. It reads the notification email automatically
2. AI writes a personalized reply in seconds
3. It sends the reply inside the Thumbtack app (using browser automation)
4. It texts the business owner to let them know
5. It logs the lead in your Airtable database
6. It automatically follows up if the lead doesn't respond

---

## What you need before starting

- [ ] A DigitalOcean account (digitalocean.com) — $6/month server
- [ ] Your OpenAI API key
- [ ] Your Twilio Account SID and Auth Token
- [ ] Your Airtable API key and Base ID
- [ ] A Gmail account with App Password set up

---

## STEP 1 — Set up your server on DigitalOcean

This is the computer that runs your software 24/7.

1. Go to **digitalocean.com** → Sign up
2. Click **Create** → **Droplets**
3. Choose:
   - Image: **Ubuntu 22.04**
   - Size: **Basic → Regular → $6/month** (1GB RAM is enough)
   - Region: pick the closest to you
   - Authentication: **Password** → create a strong password and save it
4. Click **Create Droplet**
5. Wait 1 minute. You'll see an IP address like `143.198.123.45` — save this.

---

## STEP 2 — Connect to your server

You need to log into your server to install the software.

**On Mac:**
1. Open the Terminal app (search "Terminal" in Spotlight)
2. Type: `ssh root@YOUR_IP_ADDRESS` (replace with your real IP)
3. Type your password when asked
4. You're in! You'll see a prompt like `root@droplet:~#`

**On Windows:**
1. Download **PuTTY** from putty.org
2. Enter your IP address → click Open
3. Login as `root` → enter your password

---

## STEP 3 — Install Node.js and the software

Copy and paste these commands one at a time into your server terminal.
Press Enter after each one and wait for it to finish.

```bash
# Update the server
apt update && apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Chrome (needed for Thumbtack automation)
apt-get install -y chromium-browser

# Verify installations worked
node --version
npm --version

# Create a folder for your app
mkdir /home/leadflow
cd /home/leadflow

# Install git (to download your code)
apt install git -y
```

---

## STEP 4 — Upload your code to the server

On your server, run:

```bash
cd /home/leadflow
```

Then upload all the files from this folder to `/home/leadflow/` on your server.

The easiest way to do this is using a free tool called **FileZilla**:
1. Download FileZilla from filezilla-project.org
2. Open FileZilla → File → Site Manager → New Site
3. Protocol: SFTP, Host: your IP address, Port: 22
4. Logon type: Normal, Username: root, Password: your password
5. Connect → drag your LeadFlow folder to `/home/leadflow/`

---

## STEP 5 — Set up your environment variables

These are your secret keys that tell the software who you are.

On your server:
```bash
cd /home/leadflow
cp .env.example .env
nano .env
```

You'll see a text editor. Replace every placeholder with your real values:

```
OPENAI_API_KEY=sk-proj-your-real-key
TWILIO_ACCOUNT_SID=ACyour-real-sid
TWILIO_AUTH_TOKEN=your-real-token
AIRTABLE_API_KEY=patyour-real-key
AIRTABLE_BASE_ID=appyour-real-id
WEBHOOK_SECRET=make-up-any-password-here
GMAIL_USER=youremail@gmail.com
GMAIL_APP_PASSWORD=your-app-password
PORT=3000
```

To save: press `Ctrl+X` → press `Y` → press `Enter`

---

## STEP 6 — Install dependencies and start the server

```bash
cd /home/leadflow
npm install
npx playwright install chromium
node src/server.js
```

You should see:
```
🚀 LeadFlow server running on port 3000
📡 Webhook URL: http://YOUR_IP/webhook/new-lead
```

If you see that, your server is running!

---

## STEP 7 — Keep it running forever

Right now if you close the terminal, the server stops.
Run this to keep it running permanently:

```bash
npm install -g pm2
pm2 start src/server.js --name leadflow
pm2 startup
pm2 save
```

Now LeadFlow runs 24/7 and restarts automatically if it ever crashes.

---

## STEP 8 — Add a client to Airtable

Before the system can process leads, you need to add your client's info.

In your Airtable **Clients** table, add a new row with:
- **Business Name**: Tampa Plumbing Co.
- **Owner Name**: Jake Smith
- **Owner Phone**: +18135550123
- **Owner Email**: jake@tampaplumbing.com
- **Service Area**: Tampa, Brandon, Wesley Chapel, FL
- **Services Offered**: Plumbing repairs, water heater installation, drain cleaning
- **Services NOT Offered**: Gas lines, commercial plumbing
- **Twilio Number**: +18135550101 (the number you bought in Twilio)
- **Calendly Link**: https://calendly.com/jake-smith/estimate
- **Thumbtack Username**: jake@tampaplumbing.com
- **Thumbtack Password**: their Thumbtack password
- **Active**: checked ✓

---

## STEP 9 — Connect Make.com

1. In Make.com, create a scenario with Gmail → Watch emails
2. Filter: only emails from thumbtack.com or yelp.com
3. After the filter, add HTTP → Make a request
4. URL: `http://YOUR_IP:3000/webhook/new-lead`
5. Method: POST
6. Headers: add `x-webhook-secret` = your WEBHOOK_SECRET
7. Body (JSON):
```json
{
  "clientName": "Tampa Plumbing Co.",
  "email": {
    "from": "{{1.from}}",
    "replyTo": "{{1.replyTo}}",
    "subject": "{{1.subject}}",
    "text": "{{1.text}}",
    "messageId": "{{1.messageId}}"
  }
}
```

---

## STEP 10 — Test it

Send a test request to confirm everything works:

```bash
curl -X POST http://YOUR_IP:3000/test \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-webhook-secret" \
  -d '{"clientName": "Tampa Plumbing Co."}'
```

Check your server logs — you should see it process the fake Nicole W. lead.

---

## Troubleshooting

**"Cannot connect to server"**
→ Make sure you ran `pm2 start` and the server is running

**"Client not found"**
→ Check that the clientName in your Make.com webhook matches EXACTLY what's in Airtable

**"Thumbtack automation failed"**
→ Run the login test: POST to /test-login with the client's credentials
→ Check the thumbtack-error.png screenshot for clues

**"OpenAI error"**
→ Check your API key is correct and you have credits

---

## Your webhook URL

Share this with Make.com:
`http://YOUR_IP_ADDRESS:3000/webhook/new-lead`

---

## Monthly costs

| Service | Cost |
|---------|------|
| DigitalOcean server | $6/month |
| Twilio (numbers + texts) | ~$5-20/month |
| OpenAI | ~$2-10/month |
| Airtable | Free |
| Make.com | Free-$9/month |
| **Total** | **~$15-45/month** |

You're charging clients $297/month. Your margin is 85%+.
