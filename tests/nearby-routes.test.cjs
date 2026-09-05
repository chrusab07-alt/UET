const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const inputEvents = {};
  const input = { value: '', dataset: {}, addEventListener: (name, callback) => { inputEvents[name] = callback; } };
  let place, onPlace, gpsError;
  const context = vm.createContext({
    console, localStorage: { getItem: () => null },
    document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => id === 'main-location-input' ? input : null },
    navigator: { geolocation: { getCurrentPosition(success, failure) {
      if (gpsError) failure({ code: gpsError });
      else success({ coords: { latitude: place.lat, longitude: place.lng } });
    } } },
    window: { google: { maps: { places: { Autocomplete: function () {
      this.addListener = (_, callback) => { onPlace = callback; };
      this.getPlace = () => place.detailsUnavailable ? {} : ({
        name: 'Johar Town', formatted_address: 'Johar Town, Lahore', place_id: 'test-place-id',
        geometry: { location: { lat: () => place.lat, lng: () => place.lng } }
      });
    } } } } }
  });
  for (const file of ['data.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
  }
  vm.runInContext(`
    var renders = 0, shows = 0, hides = 0;
    SearchLoader.show = () => shows++;
    SearchLoader.hide = () => hides++;
    renderResultPage = () => renders++;
    navigateToPage = page => appState.activePage = page;
    initUIEvents();
    initGoogleLocationSearch();
  `, context);
  const run = code => vm.runInContext(code, context);
  return { run, input, edit: text => { input.value = text; inputEvents.input(); }, google: () => onPlace(), setPlace: value => { place = value; },
    setGpsError: value => { gpsError = value; } };
}

for (const campus of ['main', 'ksk']) {
  test(`${campus}: GPS, Places selection, and search button return identical pickup options`, () => {
    const h = setup();
    h.run(`appState.selectedCampus = '${campus}'`);
    const points = h.run(`UET_DATA.routes.filter(r => r.campusId === '${campus}').flatMap(r => r.stops.slice(0, -1))`);
    assert.ok(points.length);
    for (const point of points) {
      h.setPlace(point);
      h.run('detectUserGeolocation()');
      const gps = h.run('JSON.stringify({status: appState.recommendationResults.status, matches: appState.recommendationResults.matchingRoutes, nearby: appState.recommendationResults.allNearby})');
      assert.equal(h.run('appState.currentLocation.source'), 'gps');
      h.google();
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

test('validation, thresholds, and multiple stops from the same route', () => {
  const h = setup();
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
    assert.equal(h.run(`findNearbyRoutes(0, 0, '${campus}').allNearby.length`), 3);
    assert.equal(h.run(`findNearbyRoutes(0.03, 0, '${campus}').status`), 'nearest');
    assert.equal(h.run(`findNearbyRoutes(1, 0, '${campus}').status`), 'none');
  }
});

test('source errors remain distinct and clear stale results', () => {
  const h = setup();
  h.setPlace({ lat: 31.55, lng: 74.35 });
  for (const [code, message] of [[1, 'permission was denied'], [2, 'unavailable'], [3, 'timed out']]) {
    h.google();
    h.setGpsError(code);
    h.run('detectUserGeolocation()');
    assert.ok(h.run('appState.locationSearchError').includes(message));
    assert.equal(h.run('appState.currentLocation'), null);
    assert.equal(h.run('appState.recommendationResults'), null);
  }
  h.setPlace({ detailsUnavailable: true });
  h.google();
  assert.ok(h.run('appState.locationSearchError').includes('Place details are unavailable'));
  h.run('handleLocationSearch()');
  assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
});
for (const text of ['Johar Town', 'xyz-invalid-location-123']) {
  test(`manual text without suggestion is rejected: ${text}`, () => {
    const h = setup();
    h.run('runNearbyRouteSearch = () => { throw new Error("Route search must not run"); }');
    h.edit(text);
    h.run('handleLocationSearch()');
    assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
  });
}

test('selected Johar Town uses place coordinates; editing invalidates even if text is restored', () => {
  const h = setup();
  h.setPlace({ lat: 31.4697, lng: 74.2728 });
  h.google();
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

test('invalid Places coordinates never enter route search', () => {
  for (const coords of [{ lat: null, lng: 74 }, { lat: 31, lng: NaN }, { lat: 91, lng: 74 }, { lat: 31, lng: 181 }]) {
    const h = setup();
    h.run('runNearbyRouteSearch = () => { throw new Error("Invalid coordinates must not reach route search"); }');
    h.setPlace(coords);
    h.google();
    assert.equal(h.run('appState.selectedPlace'), null);
    assert.ok(h.run('appState.locationSearchError').includes('Place details are unavailable'));
    h.input.value = 'Johar Town, Lahore';
    h.run("appState.selectedPlace = {lat: null, lng: 74, formattedAddress: 'Johar Town, Lahore'}");
    h.run('handleLocationSearch()');
    assert.equal(h.run('appState.locationSearchError'), 'Please select a location from the suggestions.');
  }
});