const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const f = path.resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });

  for (const width of [320, 339, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const cards = await page.evaluate(() => {
      return [...document.querySelectorAll('.stat-card')].map((el, i) => {
        const r = el.getBoundingClientRect();
        return { idx: i, y: r.y, h: r.height };
      });
    });
    console.log(`=== WIDTH ${width} ===`, cards);
    await page.close();
  }
  await browser.close();
  server.close();
})();
