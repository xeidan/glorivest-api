'use strict';

require('dotenv').config();

const app = require('./app');
const { completeExpiredCycles } = require('./workers/completeCycles');

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.listen(PORT, async () => {
  console.log('🔥 Glorivest Backend Started');
  console.log(`Server running on port ${PORT}`);

  try {
    await completeExpiredCycles();
    console.log('✅ Initial cycle completion check executed');
  } catch (err) {
    console.error('❌ Initial cycle completion failed', err);
  }

  if (process.env.ENABLE_WORKERS === 'true') {
    console.log('⚙️ Starting workers...');
    require('./workers');
  } else {
    console.log('⛔ Workers disabled');
  }
});
