/* eslint-disable no-console */
// Captures deterministic UI screenshots for demo docs and presentation assets.
const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(__dirname, '..', 'assets', 'screenshots');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Screenshot helper placeholder. Save captures into: ${targetDir}`);
console.log('Recommended pages: / and /personalized?session=<session_id>');
