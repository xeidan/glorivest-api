'use strict';

require('dotenv').config();

const app = require('./app'); // should export an Express app instance
const poller = require('./workers/poller.worker');
const sweeper = require('./workers/sweep.worker');
const withdrawalWorker = require('./workers/withdrawal.worker');

const PORT = process.env.PORT || 3000;

// tell Express we're behind a proxy (Heroku, etc.)
app.set('trust proxy', 1);

// =======================
// START EXPRESS SERVER
// =======================
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Started');
  console.log(`Server running on port ${PORT}`);
});

// =======================
// START BACKGROUND WORKERS
// =======================
(async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      console.log('⚙️ Starting workers...');
      // start workers but guard each so one failing worker doesn't crash everything
      try { poller.start(); } catch (e) { console.error('Poller failed to start', e); }
      try { sweeper.start(); } catch (e) { console.error('Sweeper failed to start', e); }
      try { withdrawalWorker.start(); } catch (e) { console.error('Withdrawal worker failed to start', e); }
    } else {
      console.log('Workers disabled in development mode.');
    }
  } catch (err) {
    console.error('Worker startup error', err);
  }
})();
