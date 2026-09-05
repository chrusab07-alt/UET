const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage();
  await page.setContent(`
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
    <div id="box" style="font-family: 'Inter', sans-serif;"></div>
  `);
  await page.evaluate(() => document.fonts.ready);
  const s = 'Arrivals: 07:40 \u2022 07:45 \u2022 07:50';
  for (const size of ['0.76rem', '0.74rem', '0.72rem', '0.7rem']) {
    for (const ls of ['normal', '-0.01em', '-0.02em', '-0.03em']) {
      const w = await page.evaluate(({ s, size, ls }) => {
        const box = document.getElementById('box');
        box.style.fontSize = size;
        box.style.letterSpacing = ls;
        box.innerHTML = `<span style="display:inline-block;white-space:nowrap;">${s}</span>`;
        return box.firstElementChild.getBoundingClientRect().width;
      }, { s, size, ls });
      console.log(`${size} ls:${ls}: ${Math.round(w * 10) / 10}px`);
    }
  }
  await browser.close();
})();
