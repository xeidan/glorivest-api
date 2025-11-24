require('dotenv').config();
const TronWeb = require('tronweb');
const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });

(async () => {
  const to = process.argv[2];
  const amountTrx = Number(process.argv[3] || 5);
  if (!to) throw new Error('Usage: node topup_trx.js <T-address> [amountTRX]');
  const pk = process.env.OMNIBUS_TRON_PRIVATE_KEY;
  if (!pk) throw new Error('OMNIBUS_TRON_PRIVATE_KEY not set');
  const sun = Math.round(amountTrx * 1e6);
  const tx = await tw.trx.sendTransaction(to, sun, { privateKey: pk });
  console.log('Top-up tx:', tx);
})().catch(e => { console.error(e); process.exit(1); });
