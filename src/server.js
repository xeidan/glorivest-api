'use strict';

require('dotenv').config();

const app = require('./app');
const { completeExpiredCycles } = require('./workers/completeCycles');

const PORT = process.env.PORT || 3000;

// Tell Express we're behind a proxy (Heroku, etc.)
app.set('trust proxy', 1);

// =======================
// START EXPRESS SERVER
// =======================
app.listen(PORT, async () => {
  console.log('🔥 Glorivest Backend Started');
  console.log(`Server running on port ${PORT}`);

  // 🔁 Run once on boot (safety catch for missed cron runs)
  try {
    await completeExpiredCycles();
    console.log('✅ Initial cycle completion check executed');
  } catch (err) {
    console.error('❌ Initial cycle completion failed', err);
  }

  // =======================
  // START BACKGROUND WORKERS
  // =======================
  if (process.env.ENABLE_WORKERS === 'true') {
    console.log('⚙️ Starting workers...');
    require('./workers'); // workers/index.js handles feature flags
  } else {
    console.log('⛔ Workers disabled');
  }
});
