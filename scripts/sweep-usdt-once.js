// sweep-usdt-once.js
require('dotenv').config();
const TronWeb = require('tronweb');

const FULLHOST = (process.env.TRON_FULLHOST || 'https://api.trongrid.io').trim();
const USDT = (process.env.USDT_TRON_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').trim(); // canonical USDT
const FROM_PRIV = process.argv[2]; // pass as arg
const TO_ADDR   = process.argv[3]; // omnibus T... address
const AMOUNT    = process.argv[4]; // in USDT units, e.g. "2.3456"

if (!FROM_PRIV || !TO_ADDR || !AMOUNT) {
  console.error('Usage: node sweep-usdt-once.js <fromPrivateKeyHex> <toBase58Addr> <amountUSDT>');
  process.exit(1);
}

(async () => {
  const tronWeb = new TronWeb({ fullHost: FULLHOST });
  const fromAddr = tronWeb.address.fromPrivateKey(FROM_PRIV);
  tronWeb.setAddress(fromAddr);

  console.log('From:', fromAddr);
  console.log('To  :', TO_ADDR);
  console.log('Amt :', AMOUNT, 'USDT');

  const contract = await tronWeb.contract().at(USDT);

  // optional: fetch current balance to confirm
  const balRaw = await contract.balanceOf(tronWeb.address.toHex(fromAddr)).call();
  const bal = Number(balRaw.toString()) / 1e6;
  console.log('Current USDT balance:', bal);
  if (bal < Number(AMOUNT)) {
    console.error('Insufficient USDT balance');
    process.exit(1);
  }

  const amountSun = BigInt(Math.floor(Number(AMOUNT) * 1e6)).toString();
  const txid = await contract.transfer(TO_ADDR, amountSun).send({ privateKey: FROM_PRIV });
  console.log('Broadcasted, tx:', txid);
})();
