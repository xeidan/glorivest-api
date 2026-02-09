'use strict';

require('dotenv').config();
require('./workers');

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);



app.listen(PORT, () => {
  console.log('🔥 Glorivest Backend Started');
  console.log(`Server running on port ${PORT}`);
});
