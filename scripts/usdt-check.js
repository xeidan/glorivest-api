// usdt-check.js — FINAL WORKING VERSION (Ethers-compatible ABI)
require("dotenv").config();
const TronWeb = require("tronweb");

// ------------------------------------------------------------------
// ENV
// ------------------------------------------------------------------
const FULL = process.env.TRON_FULLHOST || "https://api.trongrid.io";
const KEY = process.env.TRONGRID_API_KEY;
const USDT = process.env.USDT_TRON_CONTRACT;
const ADDR = process.argv[2] || process.env.OMNIBUS_TRON_ADDRESS;

if (!USDT) throw new Error("❌ Missing USDT_TRON_CONTRACT");
if (!ADDR) throw new Error("❌ Missing address");

// ------------------------------------------------------------------
// ABI (Ethers-compatible TRC20)
// ------------------------------------------------------------------
const TRC20_ABI = [
  {
    "inputs":[{"name":"_owner","type":"address"}],
    "name":"balanceOf",
    "outputs":[{"name":"balance","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs":[],
    "name":"decimals",
    "outputs":[{"name":"","type":"uint8"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs":[],
    "name":"symbol",
    "outputs":[{"name":"","type":"string"}],
    "stateMutability":"view",
    "type":"function"
  }
];

// ------------------------------------------------------------------
// TronWeb instance
// ------------------------------------------------------------------
const tronWeb = new TronWeb(
  FULL,
  FULL,
  FULL,
  process.env.OMNIBUS_TRON_PRIVATE_KEY ||
    "0000000000000000000000000000000000000000000000000000000000000001"
);

tronWeb.setHeader({ "TRON-PRO-API-KEY": KEY });

// ------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------
(async () => {
  try {
    console.log("🔍 Loading USDT contract using manual ABI…");

    const c = await tronWeb.contract(TRC20_ABI, USDT);

    console.log("🔍 Checking balance for:", ADDR);

    const hex = tronWeb.address.toHex(ADDR);
    const raw = await c.balanceOf(hex).call();

    let bn = "0";
    if (raw?._hex) bn = BigInt(raw._hex).toString();
    else if (raw?.toString) bn = raw.toString();

    const usdt = Number(bn) / 1e6;

    console.log("\n====== USDT BALANCE CHECK ======");
    console.log("Address:", ADDR);
    console.log("USDT raw:", bn);
    console.log("USDT:", usdt);
    console.log("===============================\n");

  } catch (err) {
    console.log("\n❌ ERROR");
    console.log("Message:", err.message);
    console.log(err);
  }
})();
