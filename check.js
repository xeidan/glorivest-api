const TronWeb = require('tronweb');

const pk = "1acc95a45aae1f631f4bff6da9be0cd00ae788edb00626e1784c0913ac884427";
const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: pk
});

console.log("Address from private key:", tronWeb.address.fromPrivateKey(pk));
