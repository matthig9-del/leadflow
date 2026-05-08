# LeadFlow

AI lead automation for local service businesses.

## Files in this project (all at root level)

```
server.js       ← main server — Railway runs this
ai.js           ← OpenAI reply generation  
airtable.js     ← database reads/writes
thumbtack.js    ← Thumbtack OAuth + API calls
sms.js          ← Quo SMS sending
package.json    ← dependencies
.env.example    ← environment variable template
```

## How to deploy to Railway

1. Upload ALL these files directly to your GitHub repo root
2. Do NOT put them inside a subfolder
3. In Railway → Variables tab, add every variable from .env.example
4. Railway auto-deploys — look for the green "Active" status

## Environment variables to add in Railway

Copy each line from .env.example into Railway's Variables tab.

## Your Thumbtack application URLs

Once deployed, your URLs are:
- Homepage: https://YOUR-APP.up.railway.app
- OAuth callback: https://YOUR-APP.up.railway.app/auth/thumbtack/callback  
- Webhook: https://YOUR-APP.up.railway.app/webhook/thumbtack/:clientId

## Test it's working

Visit https://YOUR-APP.up.railway.app/health
You should see: {"status":"LeadFlow is running ✅"}
