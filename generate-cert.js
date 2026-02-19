const crypto = require('crypto');
const fs = require('fs');

// Generate RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Create a self-signed certificate
const cert = crypto.createSelfSignedCertificate({
  key: privateKey,
  days: 365,
  subject: {
    commonName: 'localhost',
    country: 'US',
    organization: 'Kubeli Development'
  },
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 'DNS', value: 'localhost' },
        { type: 'DNS', value: '127.0.0.1' }
      ]
    }
  ]
});

// Write files
fs.writeFileSync('server.key', privateKey);
fs.writeFileSync('server.cert', cert);

console.log('✅ Self-signed certificate generated for development HTTPS');
console.log('📁 Files created: server.key, server.cert');
console.log('🔒 Use these files for HTTPS development only');
