const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function setup() {
  let input, place, gpsError;
  const elements = {};
  class MockInput {
    constructor(options) { this.options = options; this.value = ''; this.dataset = {}; this.events = {}; }
    setAttribute() {}
    addEventListener(name, callback) { this.events[name] = callback; }
    replaceWith(element) { input = element; }
  }
  input = new MockInput();
  const context = vm.createContext({
    console, URLSearchParams, setTimeout, clearTimeout, localStorage: { getItem: () => null },
    document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => id === 'main-location-input' ? input : elements[id] || null },
    navigator: { geolocation: { getCurrentPosition(success, failure) {
      if (gpsError) failure({ code: gpsError });
      else success({ coords: { latitude: place.lat, longitude: place.lng } });
    } } },
    window: { google: { maps: { importLibrary: async () => ({ PlaceAutocompleteElement: MockInput }) } } }
  });
  for (const file of ['data.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
  }
  await vm.runInContext(`
    var renders = 0, shows = 0, hides = 0;
    SearchLoader.show = () => shows++;
    SearchLoader.hide = () => hides++;
    renderResultPage = () => renders++;
    navigateToPage = page => appState.activePage = page;
    initUIEvents();
    initGoogleLocationSearch();
  `, context);
  const run = code => vm.runInContext(code, context);
  return { run, get input() { return input; },
    edit: text => { input.value = text; input.events.input(); },
    google: () => {
      const current = place;
      return input.events['gmp-select']({ placePrediction: { toPlace: () => ({
        displayName: 'Johar Town', formattedAddress: 'Johar Town, Lahore', id: 'test-place-id',
        location: current.detailsUnavailable ? null : { lat: () => current.lat, lng: () => current.lng },
        fetchFields: current.fetchFields || (async () => {})
      }) } });
    },
    setPlace: value => { place = value; }, setGpsError: value => { gpsError = value; } };
}
for (const campus of ['main', 'ksk']) {
  test(`${campus}: GPS, Places selection, and search button return identical pickup options`, async () => {
    const h = await setup();
    h.run(`appState.selectedCampus = '${campus}'`);
    const points = h.run(`UET_DATA.routes.filter(r => r.campusId === '${campus}').flatMap(r => r.stops.slice(0, -1))`);
    assert.ok(points.length);
    for (const point of points) {
      h.setPlace(point);
      h.run('detectUserGeolocation()');
      const gps = h.run('JSON.stringify({status: appState.recommendationResults.status, matches: appState.recommendationResults.matchingRoutes, nearby: appState.recommendationResults.allNearby})');
      assert.equal(h.run('appState.currentLocation.source'), 'gps');
      await h.google();
      const result = () => h.run('JSON.stringify({status: appState.recommendationResults.status, matches: appState.recommendationResults.matchingRoutes, nearby: appState.recommendationResults.allNearby})');
      assert.equal(result(), gps);
      assert.equal(h.run('appState.currentLocation.source'), 'google');
      h.run('handleLocationSearch()');
      assert.equal(result(), gps);
      assert.ok(h.run(`appState.recommendationResults.allNearby.every(x => x.route.campusId === '${campus}')`));
      assert.ok(h.run('appState.recommendationResults.allNearby.every((x, i, all) => !i || all[i - 1].distanceKm <= x.distanceKm)'));
    }
    assert.equal(h.run('renders'), points.length * 3);
    assert.equal(h.run('hides'), points.length * 3);
  });
}

test('validation, thresholds, and multiple stops from the same route', async () => {
  const h = await setup();
  for (const value of ['null', 'undefined', "''", "'31'", 'NaN', 'Infinity', 'true', '91']) {
    assert.equal(h.run(`findNearbyRoutes(${value}, 74, 'main').status`), 'error');
  }
  assert.equal(h.run("findNearbyRoutes(31, 181, 'main').status"), 'error');
  assert.equal(h.run("findNearbyRoutes(31, 74, '').status"), 'error');
  h.run(`UET_DATA.routes = ['main', 'ksk'].map(campusId => ({ campusId, stops: [
    {lat: 0, lng: 0}, {lat: 0.001, lng: 0}, {lat: 0.01, lng: 0}, {lat: 0.1, lng: 0}
  ] }))`);
  for (const campus of ['main', 'ksk']) {
    assert.equal(h.run(`findNearbyRoutes(0, 0, '${campus}').matchingRoutes.length`), 2);
    assert.equal(h.run(`findNearbyRoutes(0, 0, '${campus}').allNearby.length`), 2);
    assert.equal(h.run(`findNearbyRoutes(0.016, 0, '${campus}').status`), 'nearest');
    assert.equal(h.run(`findNearbyRoutes(1, 0, '${campus}').status`), 'none');
  }
});

test('source errors remain distinct and clear stale results', async () => {
  const h = await setup();
  h.setPlace({ lat: 31.55, lng: 74.35 });
  for (const [code, message] of [[1, 'permission was denied'], [2, 'unavailable'], [3, 'timed out']]) {
    await h.google();
    h.setGpsError(code);
    h.run('detectUserGeolocation()');
    assert.ok(h.run('appState.locationSearchError').includes(message));
    assert.equal(h.run('appState.currentLocation'), null);
    assert.equal(h.run('appState.recommendationResults'), null);
  }
  h.setPlace({ detailsUnavailable: true });
  await h.google();
  assert.ok(h.run('appState.locationSearchError').includes('Place details are unavailable'));
  h.run('handleLocationSearch()');
  assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
});
for (const text of ['Johar Town', 'xyz-invalid-location-123']) {
  test(`manual text without suggestion is rejected: ${text}`, async () => {
    const h = await setup();
    h.run('runNearbyRouteSearch = () => { throw new Error("Route search must not run"); }');
    h.edit(text);
    h.run('handleLocationSearch()');
    assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
  });
}

test('selected Johar Town uses place coordinates; editing invalidates even if text is restored', async () => {
  const h = await setup();
  h.setPlace({ lat: 31.4697, lng: 74.2728 });
  await h.google();
  assert.equal(h.run('appState.selectedPlace.placeId'), 'test-place-id');
  h.run('handleLocationSearch()');
  assert.equal(h.run('appState.currentLocation.lat'), 31.4697);
  assert.equal(h.run('appState.currentLocation.lng'), 74.2728);
  h.edit('Johar Town changed');
  assert.equal(h.run('appState.selectedPlace'), null);
  h.edit('Johar Town, Lahore');
  h.run('runNearbyRouteSearch = () => { throw new Error("Stale coordinates must not be used"); }');
  h.run('handleLocationSearch()');
  assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
});

test('invalid Places coordinates never enter route search', async () => {
  for (const coords of [{ lat: null, lng: 74 }, { lat: 31, lng: NaN }, { lat: 91, lng: 74 }, { lat: 31, lng: 181 }]) {
    const h = await setup();
    h.run('runNearbyRouteSearch = () => { throw new Error("Invalid coordinates must not reach route search"); }');
    h.setPlace(coords);
    await h.google();
    assert.equal(h.run('appState.selectedPlace'), null);
    assert.ok(h.run('appState.locationSearchError').includes('Place details are unavailable'));
    h.input.value = 'Johar Town, Lahore';
    h.run("appState.selectedPlace = {lat: null, lng: 74, formattedAddress: 'Johar Town, Lahore'}");
    h.run('handleLocationSearch()');
    assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
  }
});
test('editing while place details load discards the pending response', async () => {
  const h = await setup();
  let resolve;
  h.setPlace({ lat: 31.5, lng: 74.3, fetchFields: () => new Promise(r => { resolve = r; }) });
  const pending = h.google();
  h.edit('Different location');
  resolve();
  await pending;
  assert.equal(h.run('appState.selectedPlace'), null);
  assert.equal(h.run('renders'), 0);
});

test('widget uses Pakistan restriction, Lahore bias, and all place types', async () => {
  const h = await setup();
  assert.equal(h.input.options.includedRegionCodes[0], 'pk');
  assert.equal(h.input.options.locationBias.center.lat, 31.5204);
  assert.equal(h.input.options.includedPrimaryTypes, undefined);
});
test('GPS completion wins over pending Places details', async () => {
  const h = await setup();
  let resolve;
  h.setPlace({ lat: 31.5, lng: 74.3, fetchFields: () => new Promise(r => { resolve = r; }) });
  const pending = h.google();
  h.run('detectUserGeolocation()');
  resolve();
  await pending;
  assert.equal(h.run('appState.currentLocation.source'), 'gps');
  assert.equal(h.run('renders'), 1);
});

test('newer place selection wins over an older detail response', async () => {
  const h = await setup();
  let resolve;
  h.setPlace({ lat: 31.5, lng: 74.3, fetchFields: () => new Promise(r => { resolve = r; }) });
  const pending = h.google();
  h.setPlace({ lat: 31.6, lng: 74.4 });
  await h.google();
  resolve();
  await pending;
  assert.equal(h.run('appState.currentLocation.lat'), 31.6);
  assert.equal(h.run('renders'), 1);
});
for (const campus of ['main','ksk']) {
  for (const [name, distances, expected] of [
    ['280m + 300m', [0.28,0.3], [0.28,0.3]],
    ['550m + 610m excludes 1.8km', [1.8,0.61,0.55], [0.55,0.61]],
    ['only one nearby stop', [0.7,1.8], [0.7]],
    ['several nearby stops', [0.49,0.28,0.3,0.1,1.8], [0.1,0.28,0.3,0.49]],
    ['no reasonable stops', [1.8,3], []],
    ['maximum distance caps fallback', [0.95,1,1.05], [0.95,1]],
    ['normal radius does not broaden when occupied', [0.28,0.5,0.61], [0.28,0.5,]]
  ]) {
    test(`${campus}: ${name}`, async () => {
      const h = await setup();
      h.run(`
        calculateDistance = (lat,lng,stopLat,stopLng) => stopLat;
        UET_DATA.routes = [
          {id:'selected',campusId:'${campus}',stops:${JSON.stringify(distances.map(distance => ({name:'Test stop',lat:distance,lng:0})))}.concat([{name:'Terminal',lat:0,lng:0}])},
          {id:'other',campusId:'${campus === 'main' ? 'ksk' : 'main'}',stops:[{name:'Wrong campus',lat:0.01,lng:0}]}
        ];
        var result = findNearbyRoutes(0,0,'${campus}');
      `);
      assert.equal(h.run('JSON.stringify(result.matchingRoutes.map(item => item.distanceKm))'), JSON.stringify(expected));
      assert.equal(h.run('JSON.stringify(result.allNearby.map(item => item.distanceKm))'), JSON.stringify(expected));
      assert.equal(h.run('result.nearestStop.distanceKm'), Math.min(...distances));
      assert.ok(h.run("result.matchingRoutes.every(item => item.route.id === 'selected')"));
    });
  }
}

test('empty campus and configurable normal radius', async () => {
  const h = await setup();
  h.run("UET_DATA.routes = []; var empty = findNearbyRoutes(0,0,'main')");
  assert.equal(h.run('empty.status'), 'none');
  assert.equal(h.run('empty.nearestStop'), null);
  h.run(`calculateDistance = (a,b,lat) => lat;
    UET_DATA.routes = [{id:'one',campusId:'main',stops:[{lat:0.75,lng:0},{lat:0.78,lng:0},{lat:0,lng:0}]}];
    var custom = findNearbyRoutes(0,0,'main',{nearbyRadiusKm:0.8,fallbackDistanceGapKm:0.1,maxPickupDistanceKm:1});`);
  assert.equal(h.run('custom.status'), 'within_radius');
  assert.equal(h.run('custom.matchingRoutes.length'), 2);
});