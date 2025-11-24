// src/utils/upload.js
'use strict';

const multer = require('multer');

const storage = multer.memoryStorage();
exports.uploader = multer({ storage });

/**
 * Upload to S3 / Cloudinary / local — currently placeholder.
 * 
 * Return:
 *   { url: 'https://...' }
 */
exports.uploadFile = async (file) => {
  if (!file) throw new Error('No file provided');

  // Replace this with real S3 or Cloudinary logic later.
  const fakeUrl = `https://glorivest-placeholder.s3.amazonaws.com/${Date.now()}_${file.originalname}`;

  return { url: fakeUrl };
};
