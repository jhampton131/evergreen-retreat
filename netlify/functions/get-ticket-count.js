const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const MAX_TICKETS = 30;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    const count = await getSoldCount();
    const remaining = Math.max(0, MAX_TICKETS - count);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        sold:      count,
        remaining,
        max:       MAX_TICKETS,
        soldOut:   remaining === 0,
      }),
    };
  } catch (err) {
    console.error('get-ticket-count error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

async function getSoldCount() {
  let count = 0;
  let hasMore = true;
  let startingAfter = undefined;

  // Paginate through all succeeded deposit payment intents
  while (hasMore) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const payments = await stripe.paymentIntents.list(params);

    for (const pi of payments.data) {
      if (pi.status === 'succeeded' && pi.metadata?.type === 'deposit') {
        count++;
      }
    }

    hasMore = payments.has_more;
    if (hasMore && payments.data.length > 0) {
      startingAfter = payments.data[payments.data.length - 1].id;
    }
  }

  return count;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
