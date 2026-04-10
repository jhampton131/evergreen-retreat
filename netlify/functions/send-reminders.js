const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Runs daily. On May 26, sends reminder emails to all autopay customers
// reminding them their balance charges on May 29.

exports.handler = async () => {
  const today = new Date().toISOString().split('T')[0];
  console.log(`send-reminders cron running for date: ${today}`);

  try {
    const customers = await getCustomersDueReminder(today);
    console.log(`Found ${customers.length} reminder(s) to send`);

    const results = { sent: [], skipped: [] };

    for (const customer of customers) {
      const meta = customer.metadata;

      if (meta.reminderSent === 'true') {
        results.skipped.push({ id: customer.id, reason: 'already sent' });
        continue;
      }
      if (meta.balancePaid === 'true') {
        results.skipped.push({ id: customer.id, reason: 'already paid' });
        continue;
      }

      const balance       = parseFloat(meta.balanceAmount || 0).toFixed(2);
      const chargeDateFmt = formatDate(meta.chargeDate);
      const isAutopay     = meta.autopay === 'true';

      await sendReminderEmail({
        email:      customer.email,
        firstName:  meta.firstName,
        balance,
        chargeDate: chargeDateFmt,
        isAutopay,
      });

      // Mark reminder as sent
      await stripe.customers.update(customer.id, {
        metadata: { ...meta, reminderSent: 'true' },
      });

      results.sent.push({ id: customer.id, email: customer.email });
      console.log(`📧 Reminder sent to ${customer.email}`);
    }

    console.log('send-reminders results:', JSON.stringify(results, null, 2));
    return { statusCode: 200, body: JSON.stringify(results) };

  } catch (err) {
    console.error('send-reminders fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function getCustomersDueReminder(today) {
  const customers = [];
  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const res = await stripe.customers.list(params);

    for (const c of res.data) {
      if (
        c.metadata?.reminderDate === today &&
        c.metadata?.reminderSent !== 'true' &&
        c.metadata?.balancePaid  !== 'true'
      ) {
        customers.push(c);
      }
    }

    hasMore = res.has_more;
    if (hasMore && res.data.length > 0) {
      startingAfter = res.data[res.data.length - 1].id;
    }
  }

  return customers;
}

async function sendReminderEmail({ email, firstName, balance, chargeDate, isAutopay }) {
  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!zapierUrl) {
    console.log(`[Reminder email skipped — no ZAPIER_WEBHOOK_URL]\nTo: ${email}`);
    return;
  }

  const subject = `Reminder: Your Evergreen Summer balance charges on ${chargeDate}`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
      <h2 style="color:#2D4A35;font-weight:300;margin-bottom:4px">Just a heads up, ${firstName}</h2>
      <p style="color:#6B8C6E;font-size:13px;margin-bottom:28px;font-style:italic">Evergreen Summer 2026 · June 12–14 · Granite Shoals, TX</p>

      <p style="font-size:15px;color:#9E9589;line-height:1.8;margin-bottom:20px">
        ${isAutopay
          ? `Your remaining balance of <strong style="color:#2D4A35">$${balance}</strong> will be automatically charged to your card on <strong style="color:#2D4A35">${chargeDate}</strong>.`
          : `Your remaining balance of <strong style="color:#2D4A35">$${balance}</strong> is due on <strong style="color:#2D4A35">${chargeDate}</strong>. Please make sure your payment is submitted before that date to keep your spot.`
        }
      </p>

      <div style="padding:16px;background:#EDE5D4;border-radius:8px;font-size:13px;color:#6B8C6E;margin-bottom:28px">
        🗓 <strong style="color:#2D4A35">Charge date:</strong> ${chargeDate}<br/>
        💳 <strong style="color:#2D4A35">Amount:</strong> $${balance}<br/>
        ✈️ <strong style="color:#2D4A35">Retreat date:</strong> June 12–14, 2026
      </div>

      <p style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#6B8C6E;line-height:1.7;border-left:3px solid #C8D8C2;padding-left:20px;margin-bottom:28px">
        We can't wait to see you at the lake. It's going to be a beautiful few days.
      </p>

      <p style="font-size:13px;color:#9E9589">Questions? Reply to this email and we'll get back to you.</p>
      <p style="font-size:13px;color:#C8D8C2;margin-top:24px">© 2026 Evergreen Women</p>
    </div>
  `;

  const res = await fetch(zapierUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ to: email, subject, html }),
  });

  if (!res.ok) {
    console.error(`Zapier reminder failed for ${email}: ${res.status}`);
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
