'use strict';

const { pool } = require('../config/database');
const tron = require('../crypto/tron'); // assumed to expose getReceipt/getConfirmations/getUsdtBalance
const { withTx } = require('../config/database');

// helper: safe log prefix
const TAG = 'deposit.service';

async function getPendingTronDeposits() {
  // Select deposits that have a tx_hash and are not marked swept.
  // We rely on your deposits table (tx_hash, network, token, swept, confirmations, status)
  const q = await pool.query(
    `SELECT id, user_id, tx_hash, token, network, amount, amount_cents, confirmations, to_addr, swept, status
     FROM deposits
     WHERE network = 'tron'
       AND tx_hash IS NOT NULL
       AND swept = false
     ORDER BY created_at ASC
     LIMIT 200`
  );
  return q.rows;
}

/**
 * pollTron:
 * - For each pending trx/usdt deposit with a tx_hash, ask tron for receipt/confirmations
 * - Update confirmations and status in DB
 * - If confirmations >= threshold (example 3) mark deposit as swept=false (we don't auto-sweep here),
 *   but we set status to 'confirmed' so downstream sweep worker can pick it.
 */
exports.pollTron = async function pollTron() {
  const rows = await getPendingTronDeposits();
  if (!rows.length) return 0;

  const CONFIRM_THRESHOLD = Number(process.env.TRON_CONFIRMATIONS || 3);
  let processed = 0;

  for (const d of rows) {
    try {
      if (!d.tx_hash) {
        console.warn(`${TAG}: deposit id=${d.id} missing tx_hash — skipping`);
        continue;
      }

      // tron.getReceipt should return something like { confirmations, success, logs..., blockNumber }
      // or tron.getConfirmations(txHash) that returns integer confirmations
      let receipt;
      try {
        receipt = await tron.getReceipt(d.tx_hash);
      } catch (err) {
        console.warn(`${TAG}: tron.getReceipt failed for tx ${d.tx_hash}:`, err.message || err);
        // Do not crash — update last-checked time optionally
        continue;
      }

      // Defensive: compute confirmations
      const confirmations = (receipt && typeof receipt.confirmations === 'number') ? receipt.confirmations : null;

      // Update confirmations in DB (NULL safe)
      await pool.query(
        `UPDATE deposits SET confirmations = $1, updated_at = NOW()
         WHERE id = $2`,
        [confirmations, d.id]
      );

      // If the receipt indicates success and confirmations >= threshold, mark confirmed
      const success = receipt && (receipt.success === true || receipt.status === 'SUCCESS' || receipt.receipt && receipt.receipt.result === 'SUCCESS');

      if (success && confirmations !== null && confirmations >= CONFIRM_THRESHOLD) {
        // Mark as confirmed so sweep worker can pick it up if appropriate.
        await pool.query(
          `UPDATE deposits
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          ['confirmed', d.id]
        );
      } else {
        // keep as pending (optionally update status)
        await pool.query(
          `UPDATE deposits
           SET status = COALESCE(status, 'pending'), updated_at = NOW()
           WHERE id = $1`,
          [d.id]
        );
      }

      processed++;
    } catch (err) {
      console.error(`${TAG}: error processing deposit id=${d.id}`, err.message || err);
      // continue processing other rows
    }
  }

  return processed;
};

/**
 * markDepositSwept
 * set swept = true and store sweep_tx_hash
 */
exports.markDepositSwept = async function markDepositSwept(depositId, sweepTxHash) {
  return pool.query(
    `UPDATE deposits SET swept = true, sweep_tx_hash = $1, updated_at = NOW() WHERE id = $2`,
    [sweepTxHash, depositId]
  );
};
