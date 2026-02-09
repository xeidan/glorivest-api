'use strict';

// ===============================
// MARKET REPLAY ONLY
// ===============================
if (process.env.ENABLE_MARKET_REPLAY === 'true') {
  require('./marketReplayGenerator');
}

// Everything else is legacy.
// Do not load.
