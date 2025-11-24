// src/server.js
'use strict';

require('dotenv').config();

const app = require('./app');
const poller = require('./workers/poller.worker');
const sweeper = require('./workers/sweep.worker');
const withdrawalWorker = require('./workers/withdrawal.worker');

const PORT = process.env.PORT || 3000;

const app = express();
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
  if (process.env.NODE_ENV === 'production') {
  console.log('⚙️ Starting workers...');
  poller.start();
  sweeper.start();
  withdrawalWorker.start();
} else {
  console.log('Workers disabled in development mode.');
}

})();
