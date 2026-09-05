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

  for (const width of [1200, 820, 768, 412, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const cards = await page.evaluate(() => {
      return [...document.querySelectorAll('.stat-card')].map((el, i) => {
        const r = el.getBoundingClientRect();
        const icon = el.querySelector('.stat-icon').getBoundingClientRect();
        const val = el.querySelector('.stat-val').getBoundingClientRect();
        const lbls = [...el.querySelectorAll('.stat-lbl')].map(l => {
          const lr = l.getBoundingClientRect();
          return { y: lr.y, h: lr.height, text: l.textContent };
        });
        return {
          idx: i,
          card: { y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 },
          iconY: Math.round(icon.y * 10) / 10,
          valY: Math.round(val.y * 10) / 10,
          lbls
        };
      });
    });
    console.log(`=== WIDTH ${width} ===`);
    console.log(JSON.stringify(cards, null, 2));
    await page.close();
  }
  await browser.close();
  server.close();
})();
