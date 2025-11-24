// src/utils/crypto.js
'use strict';

const crypto = require('crypto');

const ENC_KEY_HEX = process.env.ENCRYPTION_KEY; // 32-byte hex
if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
  console.error('❌ ENCRYPTION_KEY missing or invalid. Generate using: openssl rand -hex 32');
  process.exit(1);
}

const ENC_KEY = Buffer.from(ENC_KEY_HEX, 'hex');

// Encrypt text → base64
exports.encrypt = (plainText) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

// Decrypt base64 → text
exports.decrypt = (b64) => {
  const buf = Buffer.from(b64, 'base64');

  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const encrypted = buf.slice(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
};
