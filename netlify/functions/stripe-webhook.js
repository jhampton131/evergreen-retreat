const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig     = event.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('Stripe event received:', stripeEvent.type);

  switch (stripeEvent.type) {

    // ── Deposit paid successfully ──────────────────────
    case 'payment_intent.succeeded': {
      const pi = stripeEvent.data.object;
      if (pi.metadata?.type !== 'deposit') break;

      await handleDepositSuccess(pi);
      break;
    }

    // ── Balance payment succeeded ──────────────────────
    case 'payment_intent.payment_failed': {
      const pi = stripeEvent.data.object;
      await handlePaymentFailed(pi);
      break;
    }

    default:
      console.log(`Unhandled event type: ${stripeEvent.type}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// ── Deposit success handler ──────────────────────────
async function handleDepositSuccess(pi) {
  const {
    firstName, lastName, email, bedName,
    balanceAmount, chargeDate, autopay,
  } = pi.metadata;

  const depositAmount = (pi.amount / 100).toFixed(2);
  const balance       = parseFloat(balanceAmount || 0).toFixed(2);
  const chargeDateFmt = formatDate(chargeDate);

  // 1. Send notification email to retreat organizer
  await sendEmail({
    to:      process.env.NOTIFICATION_EMAIL,
    subject: `✅ New Evergreen Summer Booking — ${firstName} ${lastName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
        <h2 style="color:#2D4A35;font-weight:300;margin-bottom:4px">New Booking</h2>
        <p style="color:#6B8C6E;font-size:13px;margin-bottom:28px;letter-spacing:.08em;text-transform:uppercase">Evergreen Summer 2026</p>

        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 0;color:#9E9589;width:140px">Name</td><td style="color:#1C2B1F;font-weight:500">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Email</td><td style="color:#1C2B1F">${email}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Lodging</td><td style="color:#1C2B1F">${bedName}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Deposit Paid</td><td style="color:#2D4A35;font-weight:500">$${depositAmount}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Balance Due</td><td style="color:#1C2B1F">$${balance}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Charge Date</td><td style="color:#1C2B1F">${chargeDateFmt}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Autopay</td><td style="color:#1C2B1F">${autopay === 'true' ? '✅ Enabled' : '❌ Manual'}</td></tr>
        </table>

        <div style="margin-top:28px;padding:16px;background:#EDE5D4;border-radius:8px;font-size:13px;color:#9E9589">
          View full details in your <a href="https://dashboard.stripe.com/payments/${pi.id}" style="color:#2D4A35">Stripe dashboard</a>
        </div>
      </div>
    `,
  });

  // 2. Send confirmation email to attendee
  await sendEmail({
    to:      email,
    subject: `You're registered for Evergreen Summer 2026 🌿`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
        <h1 style="font-family:Georgia,serif;font-size:36px;font-weight:300;color:#2D4A35;margin-bottom:4px">You're in, ${firstName}.</h1>
        <p style="color:#6B8C6E;font-size:13px;margin-bottom:28px;font-style:italic">Evergreen Summer 2026 · June 12–14 · Granite Shoals, TX</p>

        <p style="font-size:15px;color:#9E9589;line-height:1.8;margin-bottom:24px">
          We are so excited to share this time with you. Here's a summary of your booking:
        </p>

        <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:28px">
          <tr><td style="padding:8px 0;color:#9E9589;width:140px">Lodging</td><td style="color:#1C2B1F">${bedName}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Deposit Paid</td><td style="color:#2D4A35;font-weight:500">$${depositAmount}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Balance Due</td><td style="color:#1C2B1F">$${balance}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Balance Charge Date</td><td style="color:#1C2B1F">${chargeDateFmt}</td></tr>
        </table>

        ${autopay === 'true'
          ? `<div style="padding:16px;background:#EDE5D4;border-radius:8px;font-size:13px;color:#6B8C6E;margin-bottom:28px">
               <strong style="color:#2D4A35">Autopay is on.</strong> Your remaining balance of $${balance} will be automatically charged on ${chargeDateFmt}. You'll receive a reminder email 3 days before.
             </div>`
          : `<div style="padding:16px;background:#EDE5D4;border-radius:8px;font-size:13px;color:#6B8C6E;margin-bottom:28px">
               <strong style="color:#2D4A35">Balance payment:</strong> Your remaining $${balance} is due by ${chargeDateFmt}. You'll receive a reminder email 3 days before.
             </div>`
        }

        <p style="font-family:Georgia,serif;font-size:18px;font-style:italic;color:#6B8C6E;line-height:1.7;border-left:3px solid #C8D8C2;padding-left:20px;margin-bottom:28px">
          "They will be like a tree planted by the water… its leaves are always green." — Jeremiah 17:7–8
        </p>

        <p style="font-size:13px;color:#9E9589">Questions? Reply to this email and we'll get back to you.</p>
        <p style="font-size:13px;color:#C8D8C2;margin-top:24px">© 2026 Evergreen Women</p>
      </div>
    `,
  });

  console.log(`Booking confirmed: ${firstName} ${lastName} (${email})`);
}

// ── Payment failed handler ───────────────────────────
async function handlePaymentFailed(pi) {
  const { firstName, email } = pi.metadata || {};
  if (!email) return;

  const amount = (pi.amount / 100).toFixed(2);

  await sendEmail({
    to:      email,
    subject: `Action needed — Evergreen Summer payment failed`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
        <h2 style="color:#c0392b;font-weight:300">Payment Issue</h2>
        <p style="color:#9E9589;font-size:15px;line-height:1.8">Hi ${firstName || 'there'},</p>
        <p style="color:#9E9589;font-size:15px;line-height:1.8">
          We weren't able to process your $${amount} balance payment for Evergreen Summer 2026.
          Please update your payment method to keep your spot.
        </p>
        <p style="font-size:13px;color:#9E9589;margin-top:24px">Reply to this email if you need help.</p>
      </div>
    `,
  });

  // Also notify organizer
  await sendEmail({
    to:      process.env.NOTIFICATION_EMAIL,
    subject: `⚠️ Payment failed — ${firstName || 'attendee'} (${email})`,
    html: `<p>Payment of $${amount} failed for ${email}. Stripe payment intent: ${pi.id}</p>`,
  });
}

// ── Email sender via Zapier webhook ─────────────────
// Uses ZAPIER_WEBHOOK_URL env var — Zapier catches it and sends via Gmail/Outlook
async function sendEmail({ to, subject, html }) {
  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;

  if (!zapierUrl) {
    console.log(`[Email skipped — no ZAPIER_WEBHOOK_URL set]\nTo: ${to}\nSubject: ${subject}`);
    return;
  }

  const res = await fetch(zapierUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ to, subject, html }),
  });

  if (!res.ok) {
    console.error(`Zapier email failed: ${res.status} ${await res.text()}`);
  } else {
    console.log(`Email sent to ${to}: ${subject}`);
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
