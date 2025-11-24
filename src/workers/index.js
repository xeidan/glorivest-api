// src/workers/index.js
'use strict';

require('dotenv').config();

require('./poller.worker').start();
require('./sweep.worker').start();
require('./withdrawal.worker').start();

console.log('🔥 All workers launched.');
