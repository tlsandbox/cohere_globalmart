/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(__dirname, '..', 'assets', 'screenshots');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Screenshot helper placeholder. Save captures into: ${targetDir}`);
console.log('Recommended pages: / and /personalized?session=<session_id>');
