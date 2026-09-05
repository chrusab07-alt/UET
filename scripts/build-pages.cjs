// Browser keys are public in the deployed artifact: restrictions are mandatory.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const key = (process.env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
if (!key) throw new Error('Set the GOOGLE_MAPS_BROWSER_KEY repository secret before deploying. See README.md.');
const output = path.join(root, '_site');
fs.mkdirSync(output, { recursive: true });
for (const entry of ['index.html', 'css', 'js', 'assets']) {
  fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
}
if (fs.existsSync(path.join(root, 'CNAME'))) fs.copyFileSync(path.join(root, 'CNAME'), path.join(output, 'CNAME'));
fs.writeFileSync(path.join(output, 'js/config.js'),
  'window.UET_CONFIG = ' + JSON.stringify({ googleMapsApiKey: key }) + ';\n');
fs.writeFileSync(path.join(output, '.nojekyll'), '');