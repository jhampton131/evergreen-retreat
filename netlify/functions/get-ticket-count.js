const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const MAX_TICKETS = 30;
const BED_INVENTORY = {
  twin:    9,
  double:  1,
  dbl_pvt: 1,
  king:    2,
  none:    99,
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    // Get ticket count
    const sold = await getSoldCount();
    const remaining = Math.max(0, MAX_TICKETS - sold);

    // Get bed inventory
    const bedInventory = await getBedInventory();

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        sold,
        remaining,
        max:       MAX_TICKETS,
        soldOut:   remaining === 0,
        beds:      bedInventory,
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
  let startingAfter;

  while (hasMore) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const payments = await stripe.paymentIntents.list(params);
    for (const pi of payments.data) {
      if (pi.status === 'succeeded' && pi.metadata?.type === 'deposit') count++;
    }
    hasMore = payments.has_more;
    if (hasMore && payments.data.length > 0) {
      startingAfter = payments.data[payments.data.length - 1].id;
    }
  }
  return count;
}

async function getBedInventory() {
  try {
    const existing = await stripe.customers.search({
      query: `metadata['role']:'inventory'`,
      limit: 1,
    });

    if (existing.data.length === 0) {
      // No bookings yet — return full inventory
      return BED_INVENTORY;
    }

    const meta = existing.data[0].metadata;
    return {
      twin:    parseInt(meta.twin    || BED_INVENTORY.twin,    10),
      double:  parseInt(meta.double  || BED_INVENTORY.double,  10),
      dbl_pvt: parseInt(meta.dbl_pvt || BED_INVENTORY.dbl_pvt, 10),
      king:    parseInt(meta.king    || BED_INVENTORY.king,    10),
      none:    99,
    };
  } catch (err) {
    console.error('getBedInventory error:', err);
    return BED_INVENTORY;
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
