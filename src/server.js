'use strict';

require('dotenv').config();

const app = require('./app');

/* ===============================
   CRON — CYCLE SETTLEMENT
================================ */
const cron = require('node-cron');
const { settleCompletedCycles } = require('./controllers/cycle.controller');

cron.schedule('*/1 * * * *', async () => {
  try {
    const count = await settleCompletedCycles();
    if (count > 0) {
      console.log(`[CYCLE] Settled ${count} completed cycles`);
    }
  } catch (e) {
    console.error('Cycle settlement failed:', e);
  }
});
/* =============================== */

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Started');
  console.log(`Server running on port ${PORT}`);
});
