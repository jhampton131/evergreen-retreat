const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// This runs daily via Netlify cron (see netlify.toml)
// On May 29 2026, it charges all autopay customers their remaining balance

exports.handler = async () => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  console.log(`charge-balances cron running for date: ${today}`);

  try {
    const customers = await getCustomersDueToday(today);
    console.log(`Found ${customers.length} customer(s) to charge`);

    const results = { charged: [], failed: [], skipped: [] };

    for (const customer of customers) {
      const meta = customer.metadata;

      // Skip if already paid or autopay not enabled
      if (meta.balancePaid === 'true') {
        results.skipped.push({ id: customer.id, reason: 'already paid' });
        continue;
      }
      if (meta.autopay !== 'true') {
        results.skipped.push({ id: customer.id, reason: 'autopay off' });
        continue;
      }

      const balanceAmount = Math.round(parseFloat(meta.balanceAmount) * 100);
      if (balanceAmount <= 0) {
        results.skipped.push({ id: customer.id, reason: 'no balance' });
        continue;
      }

      try {
        // Get saved payment method
        const paymentMethods = await stripe.paymentMethods.list({
          customer: customer.id,
          type: 'card',
        });

        if (paymentMethods.data.length === 0) {
          results.failed.push({ id: customer.id, reason: 'no payment method on file' });
          continue;
        }

        const pm = paymentMethods.data[0];

        // Create and confirm the balance payment intent
        const pi = await stripe.paymentIntents.create({
          amount:               balanceAmount,
          currency:             'usd',
          customer:             customer.id,
          payment_method:       pm.id,
          confirm:              true,
          off_session:          true,
          receipt_email:        customer.email,
          description:          `Evergreen Summer 2026 — Balance Payment (${meta.bedName})`,
          metadata: {
            type:      'balance',
            firstName: meta.firstName,
            lastName:  meta.lastName,
            email:     customer.email,
            bedType:   meta.bedType,
            bedName:   meta.bedName,
          },
        });

        if (pi.status === 'succeeded') {
          // Mark balance as paid in customer metadata
          await stripe.customers.update(customer.id, {
            metadata: { ...meta, balancePaid: 'true' },
          });
          results.charged.push({ id: customer.id, email: customer.email, amount: balanceAmount / 100 });
          console.log(`✅ Charged $${balanceAmount / 100} for ${customer.email}`);
        }

      } catch (chargeErr) {
        console.error(`Failed to charge ${customer.email}:`, chargeErr.message);
        results.failed.push({ id: customer.id, email: customer.email, reason: chargeErr.message });
      }
    }

    console.log('charge-balances results:', JSON.stringify(results, null, 2));
    return { statusCode: 200, body: JSON.stringify(results) };

  } catch (err) {
    console.error('charge-balances fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function getCustomersDueToday(today) {
  const customers = [];
  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const res = await stripe.customers.list(params);

    for (const c of res.data) {
      if (c.metadata?.chargeDate === today && c.metadata?.balancePaid !== 'true') {
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
