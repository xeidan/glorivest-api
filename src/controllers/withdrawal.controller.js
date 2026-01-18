// 🔒 WALLET RULE ENFORCEMENT — HARD STOP
const { wallet_id, amount_cents } = req.body;

if (!wallet_id || !amount_cents) {
  return res.status(400).json({ message: 'wallet_id and amount_cents required' });
}

// Fetch wallet
const { rows: walletRows } = await pool.query(
  `
  SELECT id, type, balance_cents
  FROM wallets
  WHERE id = $1 AND user_id = $2
  LIMIT 1
  `,
  [wallet_id, req.user.id]
);

if (!walletRows.length) {
  return res.status(404).json({ message: 'Wallet not found' });
}

const wallet = walletRows[0];

// ❌ DEMO WALLET: NEVER ALLOWED
if (wallet.type === 'DEMO') {
  return res.status(403).json({
    message: 'Withdrawals are not allowed from demo wallet'
  });
}

// ❌ REFERRAL WALLET: NEVER ALLOWED
if (wallet.type === 'REFERRAL') {
  return res.status(403).json({
    message: 'Withdrawals are not allowed from referral wallet'
  });
}

// ✅ ONLY REAL WALLET ALLOWED
if (wallet.type !== 'REAL') {
  return res.status(403).json({
    message: 'Invalid wallet type for withdrawal'
  });
}

// ❌ INSUFFICIENT BALANCE
if (Number(wallet.balance_cents) < Number(amount_cents)) {
  return res.status(400).json({ message: 'Insufficient balance' });
}
