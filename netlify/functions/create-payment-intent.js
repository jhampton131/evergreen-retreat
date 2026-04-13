const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const TICKET_PRICE   = 400;  // full retreat ticket — paid upfront always
const MAX_TICKETS    = 30;
const EVENT_DATE     = new Date('2026-06-12T09:00:00-05:00');

const CHARGE_DATE = new Date(EVENT_DATE);
CHARGE_DATE.setDate(CHARGE_DATE.getDate() - 14);

const REMINDER_DATE = new Date(CHARGE_DATE);
REMINDER_DATE.setDate(REMINDER_DATE.getDate() - 3);

const BED_PRICES = {
  twin:    { price: 100, deposit: 40,  name: 'Twin Bunk'        },
  double:  { price: 150, deposit: 50,  name: 'Double (Shared)'  },
  dbl_pvt: { price: 200, deposit: 75,  name: 'Double (Private)' },
  king:    { price: 400, deposit: 150, name: 'King Room'        },
  none:    { price: 0,   deposit: 0,   name: 'No Accommodation' },
};

exports.handler = async (event) => {
  // Health check
  if (event.httpMethod === 'GET') {
    return respond(200, {
      ok: true,
      stripeKeySet: !!process.env.STRIPE_SECRET_KEY,
      message: 'create-payment-intent function is running'
    });
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body);
    const { firstName, lastName, email, phone, church, bedType, autopay } = body;

    // ── Validate inputs ──────────────────────────────
    if (!firstName || !lastName || !email || !bedType) {
      return respond(400, { error: 'Missing required fields' });
    }
    if (!BED_PRICES[bedType]) {
      return respond(400, { error: 'Invalid bed type' });
    }

    // ── Check ticket availability ────────────────────
    const ticketCount = await getTicketCount();
    if (ticketCount >= MAX_TICKETS) {
      return respond(400, { error: 'SOLD_OUT', message: 'Sorry, this retreat is sold out.' });
    }

    const bed = BED_PRICES[bedType];
    const totalAmount   = (TICKET_PRICE + bed.price) * 100;       // full ticket + full bed in cents
    const depositAmount = (TICKET_PRICE + bed.deposit) * 100;     // full ticket + bed deposit in cents
    const balanceAmount = totalAmount - depositAmount;             // remaining bed balance only

    // ── Create Stripe Customer ───────────────────────
    const customer = await stripe.customers.create({
      email,
      name: `${firstName} ${lastName}`,
      phone: phone || undefined,
      metadata: {
        firstName,
        lastName,
        church:        church || '',
        bedType,
        bedName:       bed.name,
        totalAmount:   (totalAmount / 100).toString(),
        depositAmount: (depositAmount / 100).toString(),
        balanceAmount: (balanceAmount / 100).toString(),
        autopay:       autopay ? 'true' : 'false',
        chargeDate:    CHARGE_DATE.toISOString().split('T')[0],
        reminderDate:  REMINDER_DATE.toISOString().split('T')[0],
        reminderSent:  'false',
        balancePaid:   'false',
        registeredAt:  new Date().toISOString(),
      },
    });

    // ── Create PaymentIntent for deposit ─────────────
    const paymentIntentParams = {
      amount:   depositAmount,
      currency: 'usd',
      customer: customer.id,
      receipt_email: email,
      description: `Evergreen Summer 2026 — Deposit (${bed.name})`,
      metadata: {
        type:          'deposit',
        firstName,
        lastName,
        email,
        bedType,
        bedName:       bed.name,
        balanceAmount: (balanceAmount / 100).toString(),
        chargeDate:    CHARGE_DATE.toISOString().split('T')[0],
        autopay:       autopay ? 'true' : 'false',
      },
    };

    // If autopay enabled, save card for future charges
    if (autopay) {
      paymentIntentParams.setup_future_usage = 'off_session';
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    return respond(200, {
      clientSecret:  paymentIntent.client_secret,
      customerId:    customer.id,
      depositAmount: depositAmount / 100,
      balanceAmount: balanceAmount / 100,
      totalAmount:   totalAmount / 100,
      chargeDate:    CHARGE_DATE.toISOString().split('T')[0],
      reminderDate:  REMINDER_DATE.toISOString().split('T')[0],
      ticketsLeft:   MAX_TICKETS - ticketCount - 1,
    });

  } catch (err) {
    console.error('create-payment-intent error:', err);
    return respond(500, { error: err.message });
  }
};

// ── Helpers ──────────────────────────────────────────
async function getTicketCount() {
  try {
    // Count succeeded deposit payments
    const payments = await stripe.paymentIntents.list({
      limit: 100,
    });
    return payments.data.filter(
      p => p.status === 'succeeded' && p.metadata?.type === 'deposit'
    ).length;
  } catch {
    return 0;
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}
