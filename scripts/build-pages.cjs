// Static build: local stop search and Maps directions do not require an API key.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
fs.mkdirSync(output, { recursive: true });
for (const entry of ['index.html', 'css', 'js', 'assets']) {
  fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
}
if (fs.existsSync(path.join(root, 'CNAME'))) fs.copyFileSync(path.join(root, 'CNAME'), path.join(output, 'CNAME'));
// Remove only the obsolete generated key file from previous local builds.
const oldConfig = path.join(output, 'js', 'config.js');
if (fs.existsSync(oldConfig)) fs.unlinkSync(oldConfig);
fs.writeFileSync(path.join(output, '.nojekyll'), '');