require("dotenv").config();
console.log("RAW_ENV:", process.env);
console.log("TRONGRID_API_KEY:", process.env.TRONGRID_API_KEY);
console.log("LOADED .env FROM:", require('path').resolve('.env'));

