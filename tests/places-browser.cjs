const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const mockMaps = `
class MockPlaces extends HTMLElement {
  constructor(options) {
    super(); this.options = options;
    const shadow = this.attachShadow({mode: 'open'});
    shadow.innerHTML = '<style>input{box-sizing:border-box;width:100%;height:44px;border:0;background:transparent;color:inherit;font:inherit;padding:10px}button{max-width:100%;white-space:normal}</style><input aria-label="Search for a location"><button hidden>Johar Town, Lahore</button>';
    this.field = shadow.querySelector('input');
    const suggestion = shadow.querySelector('button');
    this.field.addEventListener('input', () => { suggestion.hidden = !this.value; });
    suggestion.onclick = () => this.selectPlace();
    this.field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.selectPlace(); } });
  }
  get value() { return this.field.value; }
  set value(value) { this.field.value = value; }
  selectPlace() {
    this.value = 'Johar Town, Lahore'; this.shadowRoot.querySelector('button').hidden = true;
    const event = new Event('gmp-select');
    event.placePrediction = { toPlace: () => ({
      displayName: 'Johar Town', formattedAddress: 'Johar Town, Lahore', id: 'mock-id',
      location: {lat: () => 31.4697, lng: () => 74.2728},
      fetchFields: async () => {}
    }) };
    this.dispatchEvent(event);
  }
}
customElements.define('gmp-place-autocomplete', MockPlaces);
window.google = {maps: {importLibrary: async () => ({PlaceAutocompleteElement: MockPlaces})}};
window.__uetGoogleMapsReady();
`;

(async () => {
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', ({'.html':'text/html', '.js':'text/javascript', '.css':'text/css'})[path.extname(target)] || 'application/octet-stream');
    res.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
    for (const width of [1440, 390]) {
      const context = await browser.newContext({viewport: {width, height: 900}, isMobile: width < 500,
        hasTouch: width < 500, geolocation: {latitude:31.4697, longitude:74.2728}, permissions:['geolocation']});
      await context.route('https://www.google.com/maps/dir/**', route => route.fulfill({contentType:'text/plain', body:'Navigation destination captured for testing'}));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let mode = 'missing';
      await page.route('**/*', route => {
        const requestUrl = route.request().url();
        if (requestUrl === url + '/js/config.js' && mode !== 'missing') return route.fulfill({contentType:'text/javascript', body:'window.UET_CONFIG = {googleMapsApiKey:"mock-key"};'});
        if (requestUrl.startsWith('https://maps.googleapis.com/')) return mode === 'failed' ? route.abort() : route.fulfill({contentType:'text/javascript', body:mockMaps});
        if (!requestUrl.startsWith(url)) return route.abort();
        return route.continue();
      });
      await page.goto(url);
      const totals = await page.evaluate(() => calculateRouteStats(UET_DATA.routes, UET_DATA.campuses));
      assert.equal(await page.locator('#home-stats .stat-val').first().innerText(), String(totals.totalRoutes));
      assert.equal(await page.locator('#home-stats .stat-val').nth(1).innerText(), String(totals.uniqueStops));
      assert.equal(await page.locator('#home-stats .stat-card').count(), 2 + totals.campuses.length);
      assert.doesNotMatch(await page.locator('#home-stats').innerText(), /commuters|on-time/i);
      for (const card of await page.locator('#home-stats .stat-card').all()) {
        const box = await card.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'Stats fit viewport');
      }
      await page.getByText('Google location search is not configured yet.', {exact:false}).waitFor();
      await page.locator('#main-location-input').fill('Johar Town');
      await page.locator('#btn-find-bus').click();
      assert.match(await page.locator('#result-content-container').innerText(), /Please select a location from the suggestions/);
      mode = 'mock';
      await page.goto(url);
      await page.locator('gmp-place-autocomplete').waitFor();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => applyTheme(theme), theme);
        const bounds = await page.locator('gmp-place-autocomplete').boundingBox();
        assert.ok(bounds.width > 150 && bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}/${theme}: widget fits`);
        assert.equal(await page.locator('gmp-place-autocomplete').evaluate(el => getComputedStyle(el).colorScheme), theme);
      }
      await page.locator('gmp-place-autocomplete input').fill('Johar Town');
      await page.locator('gmp-place-autocomplete input').press('Enter');
      await page.waitForFunction(() => appState.currentLocation?.source === 'google');
      assert.equal(await page.evaluate(() => appState.currentLocation.placeId), 'mock-id');
      const googleResults = await page.evaluate(() => JSON.stringify(appState.recommendationResults.allNearby));
      const navigation = page.getByRole('link', {name:'Directions to Stop'});
      const href = await navigation.getAttribute('href');
      const expectedDestination = await page.evaluate(() => {
        const stop = appState.recommendationResults.matchingRoutes[0].stop;
        return `${stop.lat},${stop.lng}`;
      });
      assert.equal(new URL(href).searchParams.get('destination'), expectedDestination);
      assert.equal(new URL(href).searchParams.has('destination_place_id'), false);
      await page.waitForFunction(() => !document.getElementById('btn-find-bus').disabled);
      const popupPromise = page.waitForEvent('popup');
      await navigation.click();
      const popup = await popupPromise;
      await popup.waitForURL('https://www.google.com/maps/dir/**');
      assert.equal(new URL(popup.url()).searchParams.get('destination'), expectedDestination);
      await popup.close();
      await page.evaluate(() => {
        const item = appState.recommendationResults.matchingRoutes[0];
        appState.recommendationResults.matchingRoutes = [{...item,stop:{...item.stop,lat:null}}];
        renderResultPage();
      });
      await page.getByText('Navigation location not available', {exact:true}).waitFor();
      assert.equal(await page.getByRole('link', {name:'Directions to Stop'}).count(), 0);
      await page.waitForFunction(() => !document.getElementById('btn-locate-me').disabled);
      await page.evaluate(() => navigateToPage('home'));
      await page.locator('gmp-place-autocomplete input').fill('Edited place');
      assert.equal(await page.evaluate(() => appState.selectedPlace), null);
      await page.locator('#btn-find-bus').click();
      assert.match(await page.locator('#result-content-container').innerText(), /Please select a location from the suggestions/);
      await page.evaluate(() => navigateToPage('home'));
      await page.locator('#btn-locate-me').click();
      await page.waitForFunction(() => appState.currentLocation?.source === 'gps');
      assert.equal(await page.evaluate(() => JSON.stringify(appState.recommendationResults.allNearby)), googleResults);
      mode = 'failed';
      await page.goto(url);
      await page.getByText('Google location search is unavailable.', {exact:false}).waitFor();
      // Exercise the dedicated detail/back flow in both campuses at each viewport.
      for (const campus of ['main','ksk']) {
        await page.evaluate(campus => {
          window.routeViewPageToken = 'same-document';
          appState.selectedRouteId = null;
          appState.routeScheduleQuery = '';
          setSelectedCampus(campus);
          navigateToPage('routes');
        }, campus);
        const query = campus === 'main' ? 'UET' : 'New Campus';
        await page.locator('#route-schedule-search').fill(query);
        const cards = page.locator('#routes-detail-container .route-card');
        const count = await cards.count();
        assert.ok(count > 2);
        const card = cards.nth(2);
        const id = (await card.getAttribute('id')).replace('route-card-', '');
        await card.scrollIntoViewIfNeeded();
        await card.getByRole('button', {name:'View Full Route'}).click();
        const savedScroll = await page.evaluate(() => appState.routeListState.scrollY);
        assert.equal(await page.locator('#route-schedule-controls').isVisible(), false);
        assert.equal(await page.locator('#routes-detail-container .route-card').count(), 0);
        assert.equal(await page.locator('#routes-detail-container .route-campus-filter').count(), 0);
        assert.equal(await page.locator('#routes-detail-container .route-detail-heading').count(), 1);
        assert.equal(await page.evaluate(() => appState.selectedRouteId), id);
        const stopCount = await page.evaluate(id => UET_DATA.routes.find(route => route.id === id).stops.length, id);
        assert.equal(await page.locator('#routes-detail-container .timeline-item').count(), stopCount);
        await page.locator('#routes-detail-container').getByRole('button', {name:'Save Route', exact:true}).waitFor();
        await page.locator('#routes-detail-container').getByRole('button', {name:'Print / Download', exact:true}).waitFor();
        await page.getByRole('button', {name:'Back to Route Schedules', exact:true}).click();
        await page.waitForFunction(y => Math.abs(window.scrollY - y) < 3, savedScroll);
        assert.equal(await page.locator('#route-schedule-search').inputValue(), query);
        assert.equal(await page.locator('#route-schedule-controls').evaluate(el => el.hidden), false);
        assert.equal(await page.locator('#routes-detail-container .route-card').count(), count);
        assert.equal(await page.evaluate(() => appState.selectedCampus), campus);
        assert.equal(await page.evaluate(() => window.routeViewPageToken), 'same-document');
      }
      for (const [from,to] of [['main','ksk'],['ksk','main']]) {
        await page.evaluate(from => {
          appState.selectedRouteId = null;
          appState.routeScheduleQuery = '';
          setSelectedCampus(from);
          navigateToPage('routes');
        }, from);
        await page.locator('#routes-detail-container .route-card').first().getByRole('button', {name:'View Full Route'}).click();
        assert.ok(await page.evaluate(from => appState.selectedRouteId.startsWith(from), from));
        // Campus controls live on Home while Full Route is deliberately isolated.
        await page.evaluate(() => navigateToPage('home'));
        await page.locator(`#page-home .campus-btn[data-campus="${to}"]`).click();
        await page.evaluate(() => navigateToPage('routes'));
        assert.equal(await page.evaluate(() => appState.selectedRouteId), null);
        assert.equal(await page.locator('#route-schedule-controls').isVisible(), true);
        assert.equal(await page.locator('#routes-detail-container .route-detail-heading').count(), 0);
        assert.equal(await page.locator(`#routes-detail-container [id^="route-card-${from}-"]`).count(), 0);
        assert.ok(await page.locator(`#routes-detail-container [id^="route-card-${to}-"]`).count() > 0);
      }
      for (const campus of ['main','ksk']) {
        await page.goto(url + '/#routes');
        await page.evaluate(campus => {
          setSelectedCampus(campus);
          window.historyTestToken = 'no-internal-reload';
        }, campus);
        const first = page.locator('#routes-detail-container .route-card').first();
        const id = (await first.getAttribute('id')).replace('route-card-', '');
        await first.getByRole('button', {name:'View Full Route'}).click();
        await page.waitForURL(url + '/#routes/' + id);
        await page.goBack();
        await page.waitForURL(url + '/#routes');
        await page.locator('#routes-detail-container .route-card').first().waitFor();
        assert.equal(await page.evaluate(() => appState.selectedCampus), campus);
        assert.equal(await page.evaluate(() => appState.selectedRouteId), null);
        await page.goForward();
        await page.waitForURL(url + '/#routes/' + id);
        await page.locator('.route-detail-heading').waitFor();
        assert.equal(await page.evaluate(() => appState.selectedRouteId), id);
        assert.equal(await page.evaluate(() => window.historyTestToken), 'no-internal-reload');
        await page.reload();
        await page.locator('.route-detail-heading').waitFor();
        assert.equal(await page.evaluate(() => appState.selectedRouteId), id);
        assert.equal(await page.evaluate(() => appState.selectedCampus), campus);
      }
      await page.goto(url + '/#routes/main-19');
      await page.reload();
      await page.locator('.route-detail-heading').waitFor();
      assert.equal(await page.evaluate(() => appState.selectedRouteId), 'main-19');
      assert.equal(await page.evaluate(() => appState.selectedCampus), 'main');
      for (const invalid of ['missing-route', '%E0%A4', 'main-19/extra']) {
        await page.goto(url + '/#routes/' + invalid);
        await page.waitForURL(url + '/#routes');
        assert.equal(await page.evaluate(() => appState.selectedRouteId), null);
        assert.equal(await page.locator('#route-schedule-controls').isVisible(), true);
        assert.ok(await page.locator('#routes-detail-container .route-card').count() > 0);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: data-driven homepage stats, missing key, raw-text rejection, mocked selection, edit invalidation, GPS parity, both themes, network failure, navigation URL/popup, invalid-coordinate fallback, full-route isolation, Back state/scroll, both campus-switch directions, URL Back/Forward/refresh and invalid deep links`);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });