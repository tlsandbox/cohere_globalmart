/* eslint-disable no-console */
// Declares target screenshot paths/pages for deterministic demo capture workflows.
const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(__dirname, '..', 'assets', 'screenshots');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Screenshot helper placeholder. Save captures into: ${targetDir}`);
console.log('Recommended pages: / and /personalized?session=<session_id>');
