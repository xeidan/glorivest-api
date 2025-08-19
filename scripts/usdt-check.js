// save as scripts/usdt-check.js and run: node scripts/usdt-check.js
require('dotenv').config();
let TronWeb = require('tronweb');
TronWeb = TronWeb && (TronWeb.default || TronWeb.TronWeb || TronWeb);
const fetch = require('node-fetch');

const FULL = (process.env.TRON_FULLHOST || 'https://api.trongrid.io').trim();
const KEY  = (process.env.TRONGRID_API_KEY || '').trim();
const CTR  = (process.env.USDT_TRON_CONTRACT || 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8').trim();
const ADDR = process.argv[2] || 'TSeJmQS7T58f7B2VVrCDHRMPvCYBP8rLoD';

const tronWeb = new TronWeb({ fullHost: FULL, headers: KEY ? { 'TRON-PRO-API-KEY': KEY } : {} });

async function tronGrid(adr) {
  const u = new URL(`${FULL}/v1/accounts/${adr}/tokens`);
  u.searchParams.set('contract_address', CTR);
  const r = await fetch(u.toString(), { headers: KEY ? { 'TRON-PRO-API-KEY': KEY } : {} });
  if (r.status === 404) return 0;
  const j = await r.json();
  const tok = (j.data||[]).find(x => (x.tokenId||'').trim()===CTR);
  if (!tok) return 0;
  return Number(tok.balance||0) / 1e6;
}

(async () => {
  try {
    const c = await tronWeb.contract().at(CTR);
    tronWeb.setAddress(ADDR);
    const raw = await c.balanceOf(tronWeb.address.toHex(ADDR)).call({ from: ADDR });
    const s = raw && raw._hex ? BigInt(raw._hex).toString() : (raw?.toString?.() ?? '0');
    const onchain = Number(s)/1e6;
    const grid = await tronGrid(ADDR);
    console.log({ address: ADDR, usdt_tronweb: onchain, usdt_trongrid: grid });
  } catch (e) {
    console.error(e);
  }
})();
