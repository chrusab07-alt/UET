const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestApp() {
  let place = { lat: 31.5204, lng: 74.3587 };
  let gpsError = null;
  const elements = new Map();

  class MockElement {
    constructor(id = '') {
      this.id = id;
      this.innerHTML = '';
      this.value = '';
      this.hidden = false;
      this.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) this._classes.add(c); else this._classes.delete(c);
            return force;
          }
          if (this._classes.has(c)) { this._classes.delete(c); return false; }
          this._classes.add(c); return true;
        },
        contains(c) { return this._classes.has(c); }
      };
      this.attributes = new Map();
      this.events = {};
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    removeAttribute(k) { this.attributes.delete(k); }
    addEventListener(event, cb) { this.events[event] = cb; }
    scrollIntoView() {}
    focus() {}
    blur() {}
  }

  const storage = new Map();
  const context = vm.createContext({
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, new MockElement(id));
        return elements.get(id);
      },
      body: new MockElement('body')
    },
    navigator: {
      geolocation: {
        getCurrentPosition(success, failure) {
          if (gpsError) failure({ code: gpsError });
          else success({ coords: { latitude: place.lat, longitude: place.lng } });
        }
      }
    },
    window: {
      history: { pushState() {}, replaceState() {}, state: null },
      location: { hash: '' },
      addEventListener() {},
      scrollTo() {}
    }
  });

  for (const file of ['data.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
  }

  const run = code => vm.runInContext(code, context);
  return {
    run,
    elements,
    setPlace: p => { place = p; },
    setGpsError: err => { gpsError = err; }
  };
}

// ── 1. Route Label Formatting ────────────────────────────────────────────────
test('STEP 19: Route label formatting prevents duplicate Route prefix', () => {
  const app = createTestApp();
  assert.equal(app.run("formatRouteLabel(1)"), 'Route 1');
  assert.equal(app.run("formatRouteLabel('19')"), 'Route 19');
  assert.equal(app.run("formatRouteLabel('Route 1')"), 'Route 1');
  assert.equal(app.run("formatRouteLabel('route 19')"), 'Route 19');
  assert.equal(app.run("formatRouteLabel('Route Route 1')"), 'Route 1');
  assert.doesNotMatch(app.run("formatRouteLabel('Route 19')"), /\broute\s+route\b/i);
});

// ── 2. Nearby Stop Validation and Thresholds ─────────────────────────────────
test('STEP 19: findNearbyRoutes validation and error handling', () => {
  const app = createTestApp();
  for (const val of ['null', 'undefined', "''", "'31'", 'NaN', 'Infinity', 'true', '91']) {
    assert.equal(app.run(`findNearbyRoutes(${val}, 74, 'main').status`), 'error');
  }
  assert.equal(app.run("findNearbyRoutes(31, 181, 'main').status"), 'error');
  assert.equal(app.run("findNearbyRoutes(31, 74, '').status"), 'error');
});

// ── 3. Same-Route and Different-Route Multiple Nearby Stops ──────────────────
test('STEP 19: Same-route multiple nearby stops and different-route stops are preserved', () => {
  const app = createTestApp();
  app.run(`
    UET_DATA.routes = [
      {
        id: 'main-custom-1',
        campusId: 'main',
        routeNo: '1',
        name: 'Route 1 Test',
        stops: [
          { name: 'Stop 1A', lat: 31.001, lng: 74.001 },
          { name: 'Stop 1B', lat: 31.002, lng: 74.002 },
          { name: 'Terminal Destination', lat: 31.5, lng: 74.5 }
        ]
      },
      {
        id: 'main-custom-2',
        campusId: 'main',
        routeNo: '2',
        name: 'Route 2 Test',
        stops: [
          { name: 'Stop 2A', lat: 31.003, lng: 74.003 },
          { name: 'Terminal Destination 2', lat: 31.5, lng: 74.5 }
        ]
      }
    ];
  `);
  const result = app.run("findNearbyRoutes(31.000, 74.000, 'main')");
  assert.equal(result.status, 'within_radius');
  // Both stops from route 1 and one stop from route 2 should be included
  assert.equal(result.matchingRoutes.length, 3);
  const route1Stops = result.matchingRoutes.filter(m => m.route.id === 'main-custom-1');
  assert.equal(route1Stops.length, 2, 'Must preserve multiple stops from the same route');
  const route2Stops = result.matchingRoutes.filter(m => m.route.id === 'main-custom-2');
  assert.equal(route2Stops.length, 1, 'Must preserve nearby stops from different routes');
});

// ── 4. Campus Isolation ──────────────────────────────────────────────────────
test('STEP 19: Campus isolation strictly separates Main Campus and KSK Campus', () => {
  const app = createTestApp();
  const mainResult = app.run("findNearbyRoutes(31.5794, 74.3562, 'main')");
  assert.ok(mainResult.matchingRoutes.every(item => item.route.campusId === 'main'));

  const kskResult = app.run("findNearbyRoutes(31.7295, 74.2985, 'ksk')");
  assert.ok(kskResult.matchingRoutes.every(item => item.route.campusId === 'ksk'));
});

// ── 5. Stale Selected Route After Campus Change ──────────────────────────────
test('STEP 19: Campus switch clears stale selected route ID and restores list state', () => {
  const app = createTestApp();
  app.run(`
    appState.selectedCampus = 'main';
    appState.selectedRouteId = 'main-01';
    setSelectedCampus('ksk', { updateHistory: false });
  `);
  assert.equal(app.run('appState.selectedRouteId'), null);
  assert.equal(app.run('appState.selectedCampus'), 'ksk');

  app.run(`
    appState.selectedCampus = 'ksk';
    appState.selectedRouteId = 'ksk-01';
    setSelectedCampus('main', { updateHistory: false });
  `);
  assert.equal(app.run('appState.selectedRouteId'), null);
  assert.equal(app.run('appState.selectedCampus'), 'main');
});

// ── 6. Full Route → Back to Route Schedules ──────────────────────────────────
test('STEP 19: Full route view hides list controls and Back button restores list view', () => {
  const app = createTestApp();
  app.run(`
    appState.selectedCampus = 'main';
    appState.selectedRouteId = 'main-01';
    renderRoutesPage();
  `);
  assert.equal(app.elements.get('route-schedule-controls').hidden, true);
  const detailHtml = app.elements.get('routes-detail-container').innerHTML;
  assert.ok(detailHtml.includes('Back to Route Schedules'));
  assert.ok(detailHtml.includes('route-back-button'));

  // Return to list
  app.run('returnToRouteList()');
  assert.equal(app.run('appState.selectedRouteId'), null);
  assert.equal(app.elements.get('route-schedule-controls').hidden, false);
});

// ── 7. Invalid Route IDs ─────────────────────────────────────────────────────
test('STEP 19: Invalid route IDs fall back safely to route list without crashing', () => {
  const app = createTestApp();
  const parsed = app.run("parseNavigationHash('#routes/non-existent-route-xyz')");
  assert.equal(parsed.page, 'routes');
  assert.equal(parsed.routeId, null);
  assert.equal(parsed.hash, '#routes');
});

// ── 8. N/A Driver State ──────────────────────────────────────────────────────
test('STEP 19: Missing or unofficial driver info displays as N/A', () => {
  const app = createTestApp();
  // Main Campus route has no official driver info
  const mainRoute = app.run("UET_DATA.routes.find(r => r.campusId === 'main')");
  assert.equal(app.run(`getDisplayDriverName(${JSON.stringify(mainRoute)})`), 'N/A');
  assert.equal(app.run(`getDisplayDriverPhone(${JSON.stringify(mainRoute)})`), 'N/A');
  assert.equal(app.run(`getDisplayVehicleNo(${JSON.stringify(mainRoute)})`), 'N/A');

  // Null/undefined route check
  assert.equal(app.run('getDisplayDriverName(null)'), 'N/A');
  assert.equal(app.run('getDisplayDriverPhone(null)'), 'N/A');
  assert.equal(app.run('getDisplayVehicleNo(null)'), 'N/A');

  // KSK Campus route with official info returns genuine values
  const kskRoute = app.run("UET_DATA.routes.find(r => r.campusId === 'ksk' && r.driverPhone)");
  assert.notEqual(app.run(`getDisplayDriverName(${JSON.stringify(kskRoute)})`), 'N/A');
  assert.notEqual(app.run(`getDisplayDriverPhone(${JSON.stringify(kskRoute)})`), 'N/A');
});

// ── 9. Route-Number and Multi-Field Search ───────────────────────────────────
test('STEP 19: Route schedule search matches route numbers, names, stops, and aliases', () => {
  const app = createTestApp();
  const route19 = app.run("UET_DATA.routes.find(r => r.id === 'main-19')");
  assert.ok(route19, 'main-19 should exist');

  // Route number
  assert.equal(app.run(`routeMatchesScheduleSearch(${JSON.stringify(route19)}, '19')`), true);
  // Formatted route label
  assert.equal(app.run(`routeMatchesScheduleSearch(${JSON.stringify(route19)}, 'Route 19')`), true);
  // Route Name
  assert.equal(app.run(`routeMatchesScheduleSearch(${JSON.stringify(route19)}, 'Islampura')`), true);
  // Stop Name
  assert.equal(app.run(`routeMatchesScheduleSearch(${JSON.stringify(route19)}, 'MAO College')`), true);
  // Stop Alias / partial
  assert.equal(app.run(`routeMatchesScheduleSearch(${JSON.stringify(route19)}, 'Mao')`), true);
  // Unrelated search returns false
  assert.equal(app.run(`routeMatchesScheduleSearch(${JSON.stringify(route19)}, 'xyz-not-found-query')`), false);
});

// ── 10. Distance Formatting ──────────────────────────────────────────────────
test('STEP 19: Distance formatting presents meters below 1 km and kilometers at or above 1 km', () => {
  const app = createTestApp();
  assert.equal(app.run("formatDistance(0.35)"), '350 m');
  assert.equal(app.run("formatDistance(0.05)"), '50 m');
  assert.equal(app.run("formatDistance(1.0)"), '1.00 km');
  assert.equal(app.run("formatDistance(2.456)"), '2.46 km');
  assert.equal(app.run("formatDistance(-1)"), 'Unavailable');
  assert.equal(app.run("formatDistance(NaN)"), 'Unavailable');
});

// ── 11. Saved Route Button State ─────────────────────────────────────────────
test('STEP 19: Saved route button immediately toggles active state and Saved / Save Route text', () => {
  const app = createTestApp();
  app.run("appState.favorites = []");

  // Create a mock button
  const btn = {
    classList: {
      _set: new Set(['btn-secondary']),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, f) { if (f !== undefined) { if (f) this._set.add(c); else this._set.delete(c); return f; }
        if (this._set.has(c)) { this._set.delete(c); return false; } this._set.add(c); return true; },
      contains(c) { return this._set.has(c); }
    },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    innerHTML: '<i class="lucide-bookmark"></i> Save Route',
    textContent: 'Save Route'
  };

  // Toggle favorite to save
  app.run(`
    var mockBtn = ${JSON.stringify({ classList: ['btn-secondary'], text: 'Save Route' })};
  `);
  app.run("toggleFavorite('main-01')");
  assert.ok(app.run("appState.favorites.includes('main-01')"));

  // Toggle again to remove
  app.run("toggleFavorite('main-01')");
  assert.ok(!app.run("appState.favorites.includes('main-01')"));
});

// ── 12. Browser Navigation Hash Parsing ──────────────────────────────────────
test('STEP 19: Client-side routing parses URLs and preserves state', () => {
  const app = createTestApp();
  assert.equal(app.run("parseNavigationHash('#home').page"), 'home');
  assert.equal(app.run("parseNavigationHash('#routes').page"), 'routes');
  assert.equal(app.run("parseNavigationHash('#routes/main-19').routeId"), 'main-19');
  assert.equal(app.run("parseNavigationHash('#routes/ksk-01').routeId"), 'ksk-01');
  assert.equal(app.run("parseNavigationHash('#favorites').page"), 'favorites');
  assert.equal(app.run("parseNavigationHash('#notices').page"), 'notices');
  assert.equal(app.run("parseNavigationHash('#contact').page"), 'contact');
});

// ── 13. Homepage Local UET Stop Autocomplete Workflow ────────────────────────
test('STEP 19: Homepage stop search autocompletes MAO to MAO College with campus and route', () => {
  const app = createTestApp();
  const matches = app.run("searchUetStops('MAO')");
  assert.ok(matches.length > 0, 'Should find MAO matches');
  const mao = matches.find(m => m.stopName.toLowerCase().includes('mao'));
  assert.ok(mao, 'Should contain MAO stop');
  assert.ok(mao.key.includes('|'), 'Stop key must be compound: campus|routeId|stopIndex');
  assert.ok(mao.routeNo, 'Stop suggestion must include routeNo');
  assert.ok(mao.campusLabel, 'Stop suggestion must include campusLabel');
});

// ── 14. Fallback Radius Algorithm Tests (Configurable Limits) ────────────────
for (const campus of ['main', 'ksk']) {
  for (const [name, distances, expected] of [
    ['280m + 300m', [0.28, 0.3], [0.28, 0.3]],
    ['550m + 610m excludes 1.8km', [0.55, 0.61, 1.8], [0.55, 0.61]],
    ['only one nearby stop', [0.35, 1.2], [0.35]],
    ['several nearby stops', [0.1, 0.2, 0.45], [0.1, 0.2, 0.45]],
    ['no reasonable stops', [1.2, 2.5], []],
    ['maximum distance caps fallback', [0.95, 1.05], [0.95]],
    ['normal radius does not broaden when occupied', [0.49, 0.55], [0.49]]
  ]) {
    test(`STEP 19: ${campus}: ${name}`, () => {
      const app = createTestApp();
      app.run(`
        calculateDistance = (a, b, lat) => lat;
        UET_DATA.routes = [
          {
            id: 'selected',
            campusId: '${campus}',
            stops: ${JSON.stringify(distances.map(d => ({ name: 'Test stop', lat: d, lng: 0 })))}.concat([{ name: 'Terminal', lat: 0, lng: 0 }])
          },
          {
            id: 'other',
            campusId: '${campus === 'main' ? 'ksk' : 'main'}',
            stops: [{ name: 'Wrong campus', lat: 0.01, lng: 0 }]
          }
        ];
        var result = findNearbyRoutes(0, 0, '${campus}');
      `);
      assert.equal(
        app.run('JSON.stringify(result.matchingRoutes.map(item => item.distanceKm))'),
        JSON.stringify(expected)
      );
    });
  }
}