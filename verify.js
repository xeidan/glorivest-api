const TronWeb = require('tronweb');

const privateKey = "YOUR_PRIVATE_KEY_HERE";  // do NOT send this to me
const tronWeb = new TronWeb({
    fullHost: "https://api.trongrid.io",
    privateKey
});

(async () => {
    const address = tronWeb.address.fromPrivateKey(privateKey);
    console.log("Derived address:", address);
})();
