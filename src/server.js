'use strict';

require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 3000;

// tell Express we're behind a proxy (Heroku, etc.)
app.set('trust proxy', 1);

// =======================
// START EXPRESS SERVER
// =======================
app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Started');
  console.log(`Server running on port ${PORT}`);

  if (process.env.ENABLE_WORKERS === 'true') {
    console.log('⚙️ Starting workers...');
    require('./workers'); // workers/index.js handles its own flags
  } else {
    console.log('⛔ Workers disabled');
  }
});
