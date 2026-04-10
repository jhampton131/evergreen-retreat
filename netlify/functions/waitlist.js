// Handles both waitlist signups (sold out) and future retreat interest

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method not allowed' };
  }

  try {
    const { firstName, lastName, email, type } = JSON.parse(event.body);
    // type: 'waitlist' | 'future'

    if (!firstName || !email) {
      return respond(400, { error: 'Name and email are required' });
    }

    const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
    const notifyEmail = process.env.NOTIFICATION_EMAIL;
    const label = type === 'waitlist' ? 'Waitlist' : 'Future Retreat Interest';

    // Send to Zapier → Google Sheet
    if (zapierUrl) {
      await fetch(zapierUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:      notifyEmail,
          subject: `📋 New ${label} Signup — ${firstName} ${lastName || ''}`,
          html: `
            <p><strong>${firstName} ${lastName || ''}</strong> signed up for the <strong>${label}</strong>.</p>
            <p>Email: ${email}</p>
            <p>Type: ${type}</p>
            <p>Date: ${new Date().toLocaleString()}</p>
          `,
          // Extra fields Zapier can use to append to Google Sheet
          sheetData: { firstName, lastName: lastName || '', email, type, date: new Date().toISOString() },
        }),
      });
    }

    // Send confirmation to the signup
    if (zapierUrl) {
      const isWaitlist = type === 'waitlist';
      await fetch(zapierUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:      email,
          subject: isWaitlist
            ? `You're on the Evergreen Summer waitlist 🌿`
            : `We'll keep you posted on future Evergreen retreats 🌿`,
          html: `
            <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px;background:#F9F5EE;border-radius:12px">
              <h2 style="color:#2D4A35;font-weight:300">Hi ${firstName},</h2>
              ${isWaitlist
                ? `<p style="color:#9E9589;font-size:15px;line-height:1.8;margin:20px 0">
                     You're on the waitlist for Evergreen Summer 2026. If a spot opens up, you'll be the first to know — in the order you signed up.
                   </p>`
                : `<p style="color:#9E9589;font-size:15px;line-height:1.8;margin:20px 0">
                     Thanks for your interest in Evergreen. We'll reach out when dates and details for our next retreat are confirmed — you won't miss a thing.
                   </p>`
              }
              <p style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#6B8C6E;line-height:1.7;border-left:3px solid #C8D8C2;padding-left:20px">
                "Its leaves are always green." — Jeremiah 17:8
              </p>
              <p style="font-size:13px;color:#C8D8C2;margin-top:24px">© 2026 Evergreen Women</p>
            </div>
          `,
        }),
      });
    }

    return respond(200, { success: true, type });

  } catch (err) {
    console.error('waitlist error:', err);
    return respond(500, { error: err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}
