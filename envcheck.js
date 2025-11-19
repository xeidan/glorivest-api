console.log(">>> THIS IS THE envcheck.js YOU ARE RUNNING");
console.log(">>> FILE PATH:", __filename);
console.log("");

console.log("Before loading dotenv:");
console.log("TRON_FULLHOST =", process.env.TRON_FULLHOST);
console.log("TRONGRID_API_KEY =", process.env.TRONGRID_API_KEY);
console.log("OMNIBUS_TRON_PRIVATE_KEY =", process.env.OMNIBUS_TRON_PRIVATE_KEY);

console.log("\nCalling dotenv.config() ...");
const result = require("dotenv").config();
console.log("dotenv result:", result);

console.log("\nAfter loading dotenv:");
console.log("TRON_FULLHOST =", process.env.TRON_FULLHOST);
console.log("TRONGRID_API_KEY =", process.env.TRONGRID_API_KEY);
console.log("OMNIBUS_TRON_PRIVATE_KEY =", process.env.OMNIBUS_TRON_PRIVATE_KEY);

console.log("\nListing files in current directory:");
console.log(require("fs").readdirSync(process.cwd()));

console.log("\n.env absolute path:", require("path").resolve(".env"));
console.log("Does .env exist:", require("fs").existsSync(require("path").resolve(".env")));
