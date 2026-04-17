const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Bed inventory — max slots per type
const BED_INVENTORY = {
  twin:    9,
  double:  1,
  dbl_pvt: 1,
  king:    2,
  none:    99,
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig    = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('Stripe event received:', stripeEvent.type);

  switch (stripeEvent.type) {
    case 'payment_intent.succeeded': {
      const pi = stripeEvent.data.object;
      if (pi.metadata?.type !== 'deposit') break;
      await handleDepositSuccess(pi);
      break;
    }
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

// ── Deposit success ──────────────────────────────────
async function handleDepositSuccess(pi) {
  const {
    firstName, lastName, email, bedType, bedName,
    balanceAmount, chargeDate, autopay, phone, church, totalAmount,
  } = pi.metadata;

  const depositAmount = (pi.amount / 100).toFixed(2);
  const balance       = parseFloat(balanceAmount || 0).toFixed(2);
  const chargeDateFmt = formatDate(chargeDate);

  // 1. Send organizer notification email
  await sendToZapier({
    type:    'email',
    to:      process.env.NOTIFICATION_EMAIL,
    subject: `✅ New Evergreen Summer Booking — ${firstName} ${lastName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
        <h2 style="color:#2D4A35;font-weight:300;margin-bottom:4px">New Booking</h2>
        <p style="color:#6B8C6E;font-size:13px;margin-bottom:28px;letter-spacing:.08em;text-transform:uppercase">Evergreen Summer 2026</p>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 0;color:#9E9589;width:140px">Name</td><td style="color:#1C2B1F;font-weight:500">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Email</td><td style="color:#1C2B1F">${email}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Phone</td><td style="color:#1C2B1F">${phone || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Church</td><td style="color:#1C2B1F">${church || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Lodging</td><td style="color:#1C2B1F">${bedName}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Paid Today</td><td style="color:#2D4A35;font-weight:500">$${depositAmount}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Balance Due</td><td style="color:#1C2B1F">$${balance}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Charge Date</td><td style="color:#1C2B1F">${chargeDateFmt}</td></tr>
          <tr><td style="padding:8px 0;color:#9E9589">Autopay</td><td style="color:#1C2B1F">${autopay === 'true' ? '✅ Enabled' : '❌ Manual'}</td></tr>
        </table>
        <div style="margin-top:28px;padding:16px;background:#EDE5D4;border-radius:8px;font-size:13px;color:#9E9589">
          View in <a href="https://dashboard.stripe.com/payments/${pi.id}" style="color:#2D4A35">Stripe dashboard</a>
        </div>
      </div>
    `,
  });

  // 2. Send attendee confirmation email
  await sendToZapier({
    type:    'email',
    to:      email,
    subject: `🎆 Yay! You're in — Evergreen Summer 2026`,
    html: `
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"/></head>
      <body style="margin:0;padding:0;background-color:#F9F5EE;font-family:Georgia,serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F5EE;padding:40px 20px;">
        <tr><td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
            <tr><td style="background:linear-gradient(135deg,#1C2B1F,#2D4A35);border-radius:20px 20px 0 0;padding:48px 40px 36px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#8FAB8A;">Women's Christian Retreat</p>
              <h1 style="margin:0;font-family:Georgia,serif;font-size:52px;font-weight:300;color:#F5F0E8;line-height:.9;">Ever<em style="font-style:italic;color:#E8D4A0;">green</em></h1>
              <p style="margin:12px 0 0;font-family:Georgia,serif;font-size:18px;font-style:italic;color:#C8D8C2;">Summer 2026</p>
            </td></tr>
            <tr><td style="background:#FFFFFF;padding:48px 40px 36px;text-align:center;">
              <p style="margin:0 0 4px;font-size:48px;line-height:1;">🎆🎇✨</p>
              <h2 style="margin:16px 0 8px;font-family:Georgia,serif;font-size:42px;font-weight:300;color:#2D4A35;">Yay! You're <em style="font-style:italic;color:#6B8C6E;">in!</em></h2>
              <div style="width:48px;height:2px;background:#C4A45A;margin:20px auto;"></div>
              <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:20px;font-weight:300;color:#2D4A35;">So happy you'll be joining us for</p>
              <p style="margin:0 0 24px;font-family:Georgia,serif;font-size:24px;font-weight:400;color:#2D4A35;"><strong>Evergreen Summer</strong><br/>June 12–14, 2026</p>
              <p style="margin:0 0 32px;font-size:36px;line-height:1;">🌲☀️</p>
              <div style="background:#F9F5EE;border-left:3px solid #C8D8C2;border-radius:0 10px 10px 0;padding:20px 24px;margin:0 0 32px;text-align:left;">
                <p style="margin:0;font-family:Georgia,serif;font-size:16px;font-style:italic;color:#6B8C6E;line-height:1.7;">"Its leaves are always green." — Jeremiah 17:8</p>
              </div>
              <p style="margin:0 0 28px;font-size:16px;color:#9E9589;line-height:1.8;font-family:Arial,sans-serif;">You'll be hearing more details very soon.<br/>We are so excited to share this time with you. 🌿</p>
              <div style="background:#EDE5D4;border-radius:14px;padding:28px 32px;margin:0 0 32px;">
                <p style="margin:0 0 6px;font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#6B8C6E;font-family:Arial,sans-serif;">Stay Connected</p>
                <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:20px;color:#2D4A35;">Join our GroupMe to connect<br/>with your retreat sisters 💬</p>
                <a href="https://groupme.com/join_group/114318468/5WtnGklx" style="display:inline-block;background:#2D4A35;color:#F5F0E8;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:16px 36px;border-radius:100px;">Join the GroupMe →</a>
              </div>
              <div style="background:#F9F5EE;border:1px solid #C8D8C2;border-radius:14px;padding:24px;margin:0 0 8px;text-align:left;">
                <p style="margin:0 0 14px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8FAB8A;font-family:Arial,sans-serif;">Your Booking</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:6px 0;font-size:14px;color:#9E9589;font-family:Arial,sans-serif;width:130px;">📅 Dates</td><td style="padding:6px 0;font-size:14px;color:#1C2B1F;font-family:Arial,sans-serif;font-weight:600;">June 12–14, 2026</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#9E9589;font-family:Arial,sans-serif;">📍 Location</td><td style="padding:6px 0;font-size:14px;color:#1C2B1F;font-family:Arial,sans-serif;font-weight:600;">Granite Shoals, TX</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#9E9589;font-family:Arial,sans-serif;">🛏 Lodging</td><td style="padding:6px 0;font-size:14px;color:#1C2B1F;font-family:Arial,sans-serif;font-weight:600;">${bedName}</td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;color:#9E9589;font-family:Arial,sans-serif;">💳 Paid Today</td><td style="padding:6px 0;font-size:14px;color:#1C2B1F;font-family:Arial,sans-serif;font-weight:600;">$${depositAmount}</td></tr>
                  ${parseFloat(balance) > 0 ? `<tr><td style="padding:6px 0;font-size:14px;color:#9E9589;font-family:Arial,sans-serif;">📆 Balance Due</td><td style="padding:6px 0;font-size:14px;color:#1C2B1F;font-family:Arial,sans-serif;font-weight:600;">$${balance} on ${chargeDateFmt}</td></tr>` : ''}
                </table>
              </div>
            </td></tr>
            <tr><td style="background:#2D4A35;border-radius:0 0 20px 20px;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-family:Georgia,serif;font-size:28px;font-weight:300;font-style:italic;color:#F5F0E8;">Evergreen</p>
              <p style="margin:0 0 16px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8FAB8A;font-family:Arial,sans-serif;">Women's Christian Retreat · Summer 2026</p>
              <p style="margin:0;font-size:11px;color:#6B8C6E;font-family:Arial,sans-serif;">Questions? Just reply to this email.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
      </body></html>
    `,
  });

  // 3. Send sheet data as separate payload to Zapier
  await sendToZapier({
    type:         'sheet',
    firstName:    firstName || '',
    lastName:     lastName  || '',
    email:        email     || '',
    phone:        phone     || '',
    church:       church    || '',
    bedType:      bedName   || '',
    paidToday:    depositAmount,
    balanceDue:   balance,
    totalAmount:  totalAmount || '',
    chargeDate:   chargeDateFmt,
    autopay:      autopay === 'true' ? 'Yes' : 'No',
    stripeId:     pi.id,
    registeredAt: new Date().toLocaleDateString('en-US'),
  });

  // 4. Update bed inventory in Stripe
  await updateBedInventory(bedType);

  console.log(`Booking confirmed: ${firstName} ${lastName} (${email}) — ${bedName}`);
}

// ── Update bed inventory ─────────────────────────────
async function updateBedInventory(bedType) {
  if (!bedType || bedType === 'none') return;

  try {
    // Find or create inventory tracking customer
    const existing = await stripe.customers.search({
      query: `metadata['role']:'inventory'`,
      limit: 1,
    });

    let inventoryCustomer;
    if (existing.data.length > 0) {
      inventoryCustomer = existing.data[0];
    } else {
      // First booking — create inventory record with full slots
      inventoryCustomer = await stripe.customers.create({
        email: 'inventory@evergreen-internal.com',
        name:  'Bed Inventory Tracker',
        metadata: {
          role:    'inventory',
          twin:    String(BED_INVENTORY.twin),
          double:  String(BED_INVENTORY.double),
          dbl_pvt: String(BED_INVENTORY.dbl_pvt),
          king:    String(BED_INVENTORY.king),
        },
      });
    }

    const current = parseInt(inventoryCustomer.metadata[bedType] || '0', 10);
    const updated = Math.max(0, current - 1);

    await stripe.customers.update(inventoryCustomer.id, {
      metadata: {
        ...inventoryCustomer.metadata,
        [bedType]: String(updated),
      },
    });

    console.log(`Bed inventory updated: ${bedType} = ${updated} remaining`);
  } catch (err) {
    console.error('Inventory update error:', err.message);
  }
}

// ── Payment failed ───────────────────────────────────
async function handlePaymentFailed(pi) {
  const { firstName, email } = pi.metadata || {};
  if (!email) return;

  const amount = (pi.amount / 100).toFixed(2);

  await sendToZapier({
    type:    'email',
    to:      email,
    subject: `Action needed — Evergreen Summer payment failed`,
    html: `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
        <h2 style="color:#c0392b;font-weight:300">Payment Issue</h2>
        <p style="color:#9E9589;font-size:15px;line-height:1.8">Hi ${firstName || 'there'},</p>
        <p style="color:#9E9589;font-size:15px;line-height:1.8">We weren't able to process your $${amount} payment for Evergreen Summer 2026. Please update your payment method to keep your spot.</p>
        <p style="font-size:13px;color:#9E9589;margin-top:24px">Reply to this email if you need help.</p>
      </div>
    `,
  });

  await sendToZapier({
    type:    'email',
    to:      process.env.NOTIFICATION_EMAIL,
    subject: `⚠️ Payment failed — ${firstName || 'attendee'} (${email})`,
    html:    `<p>Payment of $${amount} failed for ${email}. Stripe ID: ${pi.id}</p>`,
  });
}

// ── Send to Zapier ───────────────────────────────────
async function sendToZapier(payload) {
  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!zapierUrl) {
    console.log(`[Zapier skipped — no URL set] type=${payload.type}`);
    return;
  }

  try {
    const res = await fetch(zapierUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Zapier failed: ${res.status} ${await res.text()}`);
    } else {
      console.log(`Zapier sent: type=${payload.type}`);
    }
  } catch (err) {
    console.error('Zapier fetch error:', err.message);
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
