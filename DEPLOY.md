# EVERGREEN SUMMER — DEPLOYMENT GUIDE
# Complete these steps in order. Takes about 20 minutes total.

═══════════════════════════════════════════════════════════
STEP 1 — DEPLOY TO NETLIFY
═══════════════════════════════════════════════════════════

Option A: Netlify Drop (quickest for preview/approval)
  1. Go to drop.netlify.com
  2. Drag the entire evergreen-deploy FOLDER onto the page
  3. You get a live URL instantly (e.g. https://random-name.netlify.app)
  4. Share that URL for approval

Option B: Netlify CLI (for full deployment with functions)
  1. npm install -g netlify-cli
  2. cd evergreen-deploy
  3. npm install
  4. netlify login
  5. netlify init  (connect to your Netlify account)
  6. netlify deploy --build (test deploy)
  7. netlify deploy --build --prod (go live)

═══════════════════════════════════════════════════════════
STEP 2 — ADD ENVIRONMENT VARIABLES IN NETLIFY
═══════════════════════════════════════════════════════════

  1. Go to app.netlify.com → Your site → Site configuration → Environment variables
  2. Add each variable from .env.example:
     - STRIPE_SECRET_KEY        → your sk_test_... key
     - STRIPE_PUBLISHABLE_KEY   → your pk_test_... key
     - STRIPE_WEBHOOK_SECRET    → (do Step 3 first, then come back)
     - NOTIFICATION_EMAIL       → your email address
     - ZAPIER_WEBHOOK_URL       → (do Step 4 first, then come back)
  3. Redeploy after adding variables

═══════════════════════════════════════════════════════════
STEP 3 — SET UP STRIPE WEBHOOK
═══════════════════════════════════════════════════════════

  1. Go to dashboard.stripe.com → Developers → Webhooks
  2. Click "Add endpoint"
  3. Endpoint URL: https://YOUR-NETLIFY-URL.netlify.app/.netlify/functions/stripe-webhook
  4. Events to listen for (select these):
     - payment_intent.succeeded
     - payment_intent.payment_failed
  5. Click "Add endpoint"
  6. Click on the webhook you just created
  7. Click "Reveal" next to "Signing secret"
  8. Copy the whsec_... value
  9. Add it to Netlify as STRIPE_WEBHOOK_SECRET
  10. Redeploy

═══════════════════════════════════════════════════════════
STEP 4 — SET UP ZAPIER EMAIL WEBHOOK
═══════════════════════════════════════════════════════════

  1. Go to zapier.com → Create Zap
  2. Trigger: "Webhooks by Zapier" → Catch Hook
  3. Copy the webhook URL Zapier gives you
  4. Add it to Netlify as ZAPIER_WEBHOOK_URL
  5. Action: "Gmail" (or Outlook) → Send Email
  6. Map fields:
     - To: {{to}}
     - Subject: {{subject}}
     - Body (HTML): {{html}}
  7. Turn on the Zap
  8. Redeploy Netlify

═══════════════════════════════════════════════════════════
STEP 5 — TEST THE FULL FLOW
═══════════════════════════════════════════════════════════

  Use Stripe test cards:
  - Success:          4242 4242 4242 4242
  - Auth required:    4000 0025 0000 3155
  - Declined:         4000 0000 0000 9995
  - Insufficient:     4000 0000 0000 9995

  Any expiry date in the future, any 3-digit CVC, any zip.

  Test checklist:
  □ Complete a booking with test card 4242...
  □ Check Stripe dashboard — payment should appear
  □ Check your email — notification should arrive
  □ Check attendee email — confirmation should arrive
  □ Try booking again — ticket count should decrease
  □ Book 30 times (or set MAX_TICKETS=1 temporarily) — sold out state should appear
  □ Test waitlist form
  □ Test "future retreats" form

═══════════════════════════════════════════════════════════
STEP 6 — GO LIVE WITH REAL STRIPE KEYS
═══════════════════════════════════════════════════════════

  1. Switch Stripe dashboard to LIVE mode
  2. Get live keys from Developers → API Keys
  3. Create a new webhook endpoint (same as Step 3) in LIVE mode
  4. Update in Netlify:
     - STRIPE_SECRET_KEY      → sk_live_...
     - STRIPE_PUBLISHABLE_KEY → pk_live_...
     - STRIPE_WEBHOOK_SECRET  → new whsec_... from live webhook
  5. In evergreen-summer.html, find the line:
       const STRIPE_PK = 'pk_test_...'
     Replace with:
       const STRIPE_PK = 'pk_live_...'
  6. Redeploy
  7. Run one real $1 test transaction to confirm everything works

═══════════════════════════════════════════════════════════
CRON JOBS (automatic — nothing to set up)
═══════════════════════════════════════════════════════════

  These run automatically once deployed to Netlify:
  - charge-balances:  Runs daily at 9am CT. On May 29, charges all autopay balances.
  - send-reminders:   Runs daily at 9am CT. On May 26, sends reminder emails.

═══════════════════════════════════════════════════════════
FILES IN THIS PACKAGE
═══════════════════════════════════════════════════════════

  evergreen-summer.html              Main site (open in browser to preview)
  netlify.toml                       Netlify config + cron schedule
  package.json                       Dependencies (stripe, nodemailer)
  .env.example                       Environment variable template
  netlify/functions/
    create-payment-intent.js         Creates Stripe PaymentIntent + SetupIntent
    stripe-webhook.js                Handles payment success, sends emails
    get-ticket-count.js              Returns remaining spots (30 max)
    charge-balances.js               Cron: auto-charges balances May 29
    send-reminders.js                Cron: sends reminder emails May 26
    waitlist.js                      Handles waitlist + future retreat signups
