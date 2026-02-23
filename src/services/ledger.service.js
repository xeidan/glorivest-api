// src/services/ledger.service.js
module.exports.postTransaction = async function ({
  userId,
  accountId,
  type,
  amountCents,
  reference = null,
  meta = {}
}, db) {

  return db.transaction(async trx => {
    const last = await trx('transactions')
      .where({ account_id: accountId })
      .orderBy('id', 'desc')
      .first();

    const prev = last ? last.balance_after_cents : 0;
    const next = prev + amountCents;

    if (next < 0) throw new Error('Insufficient funds');

    const [tx] = await trx('transactions')
      .insert({
        user_id: userId,
        account_id: accountId,
        type,
        amount_cents: amountCents,
        balance_after_cents: next,
        reference,
        meta
      })
      .returning('*');

    await trx('accounts')
      .where({ id: accountId })
      .update({ balance_cents: next });

    return tx;
  });
};
