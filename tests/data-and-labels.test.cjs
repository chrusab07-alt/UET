const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const {loadData, validateStopCoordinates, auditStopCoordinates} = require('../scripts/audit-stop-coordinates.cjs');
const root = path.resolve(__dirname, '..');

function app() {
  const elements = new Map();
  const context = vm.createContext({
    window: {}, localStorage: {getItem: () => null}, setTimeout() {},
    document: {addEventListener() {}, querySelectorAll: () => [], getElementById: id => {
      if (!elements.has(id)) elements.set(id, {innerHTML: '', classList: {add() {}}});
      return elements.get(id);
    }}
  });
  for (const file of ['data.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
  return {run: code => vm.runInContext(code, context), elements};
}

test('route label normalization is idempotent and never duplicates Route', () => {
  const h = app();
  for (const [input, expected] of [[1,'Route 1'],['19','Route 19'],['Route 1','Route 1'],['route 19','Route 19'],
    [' Route Route 1 ','Route 1'],['01','Route 01'],['11 - 15','Route 11 - 15'],['Route 2A','Route 2A']]) {
    const actual = h.run(`formatRouteLabel(${JSON.stringify(input)})`);
    assert.equal(actual, expected);
    assert.equal(h.run(`formatRouteLabel(${JSON.stringify(actual)})`), expected);
    assert.doesNotMatch(actual, /\broute\s+route\b/i);
  }
});

test('all rendered route views avoid duplicate prefixes for every route', () => {
  const h = app();
  const ids = h.run('UET_DATA.routes.map(route => route.id)');
  for (const id of ids) {
    h.run(`appState.selectedRouteId = null; appState.locationSearchError = null;
      appState.favorites = [${JSON.stringify(id)}];
      var route = UET_DATA.routes.find(r => r.id === ${JSON.stringify(id)});
      appState.selectedCampus = route.campusId;
      renderHomePage(); renderRoutesPage(); renderFavoritesPage(); printRouteSchedule(route.id);
      appState.recommendationResults = {...findNearbyRoutes(route.stops[0].lat, route.stops[0].lng, route.campusId),
        userLat: route.stops[0].lat, userLng: route.stops[0].lng, locationLabel: 'Test location'};
      renderResultPage();`);
    for (const [name, element] of h.elements) assert.doesNotMatch(element.innerHTML, /\broute\s+route\b/i, `${id}: ${name}`);
    for (const render of ['renderRouteSummaryCard', 'renderRouteDetailView']) {
      const html = h.run(`${render}(route)`);
      assert.doesNotMatch(html, /\broute\s+route\b/i);
      assert.ok(html.includes(h.run('formatRouteLabel(route.routeNo)')));
    }
  }
  // Prevent future templates bypassing the shared formatter.
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.doesNotMatch(source, /\$\{(?:item\.)?route\.routeNo[^}]*\}/);
});

test('all original dataset values remain unchanged after stripping added metadata', () => {
  const data = loadData();
  for (const route of data.routes) for (const stop of route.stops) {
    assert.equal(stop.coordinateStatus, 'unverified');
    assert.equal(stop.placeId, null);
    assert.equal(stop.source, null);
    assert.ok(Array.isArray(stop.aliases));
    for (const key of ['coordinateStatus','placeId','source','aliases']) delete stop[key];
  }
  const actual = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  assert.equal(actual, 'a06023af202497b7bdb547df915aac1ca61c3425aa6ce7da46deab00302f93d7');
});

test('coordinate validator rejects missing, nonnumeric, nonfinite, and out-of-range values without coercion', () => {
  for (const stop of [{}, {lat:null,lng:74}, {lat:31,lng:''}, {lat:'31',lng:74}, {lat:NaN,lng:74},
    {lat:31,lng:Infinity}, {lat:91,lng:74}, {lat:31,lng:-181}]) assert.ok(validateStopCoordinates(stop).length);
  assert.deepEqual(validateStopCoordinates({lat:0,lng:0}), []);
  assert.deepEqual(validateStopCoordinates({lat:-90,lng:180}), []);
});

test('audit reports suspicious duplicates without modifying stops or merging routes', () => {
  const metadata = {coordinateStatus:'unverified', placeId:null, source:null, aliases:[]};
  const routes = [{id:'a',stops:[{...metadata,name:'One',lat:31,lng:74},{...metadata,name:'Two',lat:31,lng:74}]},
    {id:'b',stops:[{...metadata,name:'One',lat:31,lng:74},{...metadata,name:'Missing'}]}];
  const before = JSON.stringify(routes);
  const result = auditStopCoordinates(routes);
  assert.equal(result.invalidCoordinates.length, 1);
  assert.equal(result.duplicateCoordinates.length, 1);
  assert.equal(result.duplicateCoordinates[0].suspicious, true);
  assert.equal(result.duplicateCoordinates[0].stops.length, 3);
  assert.equal(JSON.stringify(routes), before);
  assert.equal(auditStopCoordinates(loadData().routes).invalidCoordinates.length, 0);
});
// Informational metadata must not change any functional decision or generated UI.
function setMetadataVariant(h, variant, includeAliases = true) {
  h.run(`
    UET_DATA.routes.forEach((route, routeIndex) => route.stops.forEach((stop, stopIndex) => {
      for (const key of ['coordinateStatus', 'placeId', 'source', 'aliases']) {
        if (key !== 'aliases' || ${includeAliases}) delete stop[key];
      }
      const variant = ${JSON.stringify(variant)};
      if (variant !== 'absent') Object.assign(stop, {
        coordinateStatus: variant === 'mixed' ? ['verified', 'approximate', 'unverified'][(routeIndex + stopIndex) % 3] : variant,
        placeId: 'metadata-only-' + routeIndex + '-' + stopIndex,
        source: 'Test citation; must not affect application behavior',
        ...(${includeAliases} ? { aliases: ['metadata-only-search-alias'] } : {})
      });
    }));
  `);
}

for (const campus of ['main', 'ksk']) {
  test(`${campus}: metadata cannot change recommendation candidates, ordering, distances, or status`, () => {
    const h = app();
    h.run(`
      function recommendationSnapshot() {
        const points = UET_DATA.routes.flatMap(route => route.stops.map(stop => [stop.lat, stop.lng]));
        // Existing stops, nearby/farther offsets, and a location outside route coverage.
        const probes = points.flatMap(([lat, lng]) => [[lat,lng], [lat + 0.006,lng], [lat + 0.06,lng]]);
        probes.push([0,0]);
        const candidate = item => ({routeId:item.route.id, stopIndex:item.stopIndex,
          name:item.stop.name, time:item.stop.time, lat:item.stop.lat, lng:item.stop.lng, distanceKm:item.distanceKm});
        return JSON.stringify(probes.map(([lat,lng]) => {
          const result = findNearbyRoutes(lat,lng,'${campus}');
          return {status:result.status, targetCampus:result.targetCampus,
            matchingRoutes:result.matchingRoutes.map(candidate), allNearby:result.allNearby.map(candidate)};
        }));
      }
    `);
    setMetadataVariant(h, 'absent');
    const baseline = h.run('recommendationSnapshot()');
    for (const variant of ['unverified','approximate','verified','mixed']) {
      setMetadataVariant(h, variant);
      assert.equal(h.run('recommendationSnapshot()'), baseline, variant);
    }
  });
}

test('metadata cannot change campus filtering, exact/partial search, cards, results, saved routes, or print UI', () => {
  const h = app();
  h.run(`
    function uiSnapshot() {
      // Hold saved-route state constant across metadata variants.
      appState.favorites = UET_DATA.routes.map(route => route.id);
      const output = [];
      const queries = [...new Set(UET_DATA.routes.flatMap(route => route.stops.map(stop => stop.name)))];
      queries.push('', 'Johar', 'metadata-only-search-alias', 'not-a-real-stop');
      for (const campus of ['main','ksk']) {
        appState.selectedCampus = campus;
        appState.selectedRouteId = null;
        for (const query of queries) {
          output.push(findExactStopMatches(query,campus).map(route => route.id));
          appState.routeScheduleQuery = query;
          renderRoutesPage();
          output.push(document.getElementById('routes-detail-container').innerHTML);
        }
        appState.routeScheduleQuery = '';
        renderHomePage();
        output.push(document.getElementById('home-routes-grid').innerHTML);
      }
      appState.favorites = UET_DATA.routes.map(route => route.id);
      renderFavoritesPage();
      // Collect saved-route markup without depending on the container's name.
      for (const route of UET_DATA.routes) {
        output.push(renderRouteSummaryCard(route), renderRouteDetailView(route));
        printRouteSchedule(route.id);
        output.push(document.getElementById('print-modal-body').innerHTML);
        appState.selectedCampus = route.campusId;
        appState.locationSearchError = null;
        appState.activeRecommendationIndex = 0;
        for (const offset of [0, 0.006, 1]) {
          const lat = route.stops[0].lat + offset, lng = route.stops[0].lng;
          appState.recommendationResults = {...findNearbyRoutes(lat,lng,route.campusId),
            userLat:lat, userLng:lng, locationLabel:'Identical location'};
          renderResultPage();
          output.push(document.getElementById('result-content-container').innerHTML);
        }
      }
      return JSON.stringify(output);
    }
  `);
  const snapshot = () => {
    const output = h.run('uiSnapshot()');
    const savedHtml = [...h.elements.entries()].filter(([id]) => /fav|saved/i.test(id)).map(([id, el]) => [id, el.innerHTML]);
    assert.ok(savedHtml.length, 'Saved route markup must be included');
    return createHash('sha256').update(output).update(JSON.stringify(savedHtml)).digest('hex');
  };
  setMetadataVariant(h, 'absent', false);
  const baseline = snapshot();
  for (const variant of ['unverified','approximate','verified','mixed']) {
    setMetadataVariant(h, variant, false);
    assert.equal(snapshot(), baseline, variant);
  }
});
test('navigation uses coordinates and only explicitly verified Place IDs', () => {
  const h = app();
  const stop = {lat:31.5,lng:74.3,name:'A stop name',coordinateStatus:'verified',placeId:'Unverified ID'};
  const urlFor = value => h.run(`getStopNavigationUrl(${JSON.stringify(value)})`);
  const url = new URL(urlFor(stop));
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('destination'), '31.5,74.3');
  assert.equal(url.searchParams.has('destination_place_id'), false);
  const verified = new URL(urlFor({...stop,placeId:'ChIJ-test-id',placeIdVerified:true}));
  assert.equal(verified.searchParams.get('destination_place_id'), 'ChIJ-test-id');
  assert.equal(verified.searchParams.get('destination'), '31.5,74.3');
  for (const coords of ['null', '{}', '{lat:null,lng:74}', '{lat:31,lng:undefined}',
    '{lat:NaN,lng:74}', '{lat:31,lng:Infinity}', '{lat:91,lng:74}', '{lat:31,lng:-181}',
    '{lat:"31",lng:74}', '{lat:"",lng:74}']) {
    assert.equal(h.run(`getStopNavigationUrl(${coords})`), null);
    const html = h.run(`renderStopNavigation(${coords})`);
    assert.match(html, /Navigation location not available/);
    assert.doesNotMatch(html, /href=|onclick=|<button/);
  }
  assert.ok(urlFor({lat:0,lng:0}));
  for (const route of loadData().routes) for (const stop of route.stops) {
    const actual = new URL(urlFor(stop));
    assert.equal(actual.searchParams.get('destination'), `${stop.lat},${stop.lng}`);
    assert.equal(actual.searchParams.has('destination_place_id'), false);
  }
});
test('distance formatting uses meters below 1 km and kilometers at or above 1 km', () => {
  const h = app();
  for (const [distance, expected] of [[0,'0 m'],[0.35,'350 m'],[0.999,'999 m'],[1,'1.00 km'],[1.25,'1.25 km'],[5,'5.00 km']]) {
    assert.equal(h.run(`formatDistance(${distance})`), expected);
  }
  for (const invalid of ['null','undefined','NaN','Infinity','-1',"'0.35'"]) {
    assert.equal(h.run(`formatDistance(${invalid})`), 'Unavailable');
  }
});

test('distance presentation labels straight-line estimates and does not change selected stops', () => {
  const h = app();
  h.run(`var sampleRoute = UET_DATA.routes[0];
    appState.selectedCampus = sampleRoute.campusId;
    appState.recommendationResults = {...findNearbyRoutes(sampleRoute.stops[0].lat, sampleRoute.stops[0].lng, sampleRoute.campusId),
      userLat:sampleRoute.stops[0].lat,userLng:sampleRoute.stops[0].lng,locationLabel:'Test'};`);
  const before = h.run('JSON.stringify(appState.recommendationResults)');
  h.run('renderResultPage()');
  assert.equal(h.run('JSON.stringify(appState.recommendationResults)'), before);
  const html = h.elements.get('result-content-container').innerHTML;
  assert.match(html, /Approx\. distance: 0 m/);
  assert.doesNotMatch(html, /mins? walk|walking time|footprints/i);
  assert.doesNotMatch(html, /Approx\. distance:\s*Approx\. distance:/);
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.doesNotMatch(source, /estimatedWalk|distanceKm\s*\*\s*12/);
});
for (const [from, to] of [['main','ksk'], ['ksk','main']]) {
  test(`campus switch ${from} to ${to} clears stale details and old Back state`, () => {
    const h = app();
    h.run(`appState.selectedCampus = '${from}';
      appState.selectedRouteId = UET_DATA.routes.find(route => route.campusId === '${from}').id;
      appState.routeListState = {campus:'${from}',query:'',scrollY:300};
      renderRoutesPage();`);
    assert.equal(h.elements.get('route-schedule-controls').hidden, true);
    h.run(`setSelectedCampus('${to}')`);
    assert.equal(h.run('appState.selectedRouteId'), null);
    assert.equal(h.run('appState.routeListState'), null);
    assert.equal(h.elements.get('route-schedule-controls').hidden, false);
    const html = h.elements.get('routes-detail-container').innerHTML;
    assert.doesNotMatch(html, /route-detail-heading/);
    assert.ok(html.includes(`route-card-${to}-`));
    assert.ok(!html.includes(`route-card-${from}-`));
  });
}

test('selecting the same campus preserves its valid full route', () => {
  const h = app();
  h.run("appState.selectedCampus = 'main'; appState.selectedRouteId = 'main-01'; setSelectedCampus('main')");
  assert.equal(h.run('appState.selectedRouteId'), 'main-01');
  assert.equal(h.elements.get('route-schedule-controls').hidden, true);
});
test('homepage stats derive route counts and unique named stops from data', () => {
  const h = app();
  h.run(`var campuses = [{id:'main',shortName:'Main'},{id:'ksk',shortName:'KSK'}];
    var routes = [
      {campusId:'main',arrivalTime:'07:45 AM',stops:[{name:'Shared Stop',lat:1,lng:2},{name:'Different Name',lat:1,lng:2}]},
      {campusId:'ksk',arrivalTime:'07:50 AM',stops:[{name:' shared  STOP '},{name:'Another Stop'}]}
    ]; var stats = calculateRouteStats(routes,campuses);`);
  assert.equal(h.run('stats.totalRoutes'), 2);
  assert.equal(h.run('stats.uniqueStops'), 3);
  assert.equal(h.run('stats.campuses[0].routeCount'), 1);
  assert.equal(h.run('stats.campuses[1].arrivalTimes[0]'), '07:50 AM');
  assert.equal(h.run('stats.campuses[0].arrivalTimes[0]'), '07:45 AM');
  h.run("routes.push({campusId:'main',arrivalTime:'08:00 AM',stops:[{name:'New Stop'}]}); stats = calculateRouteStats(routes,campuses)");
  assert.equal(h.run('stats.totalRoutes'), 3);
  assert.equal(h.run('stats.uniqueStops'), 4);
  assert.equal(h.run('stats.campuses[0].routeCount'), 2);
  assert.equal(h.run('stats.campuses[0].arrivalTimes.length'), 2);
  assert.equal(h.run('calculateRouteStats([],campuses).totalRoutes'), 0);
  assert.equal(h.run('countUniqueStops([])'), 0);
});

test('homepage renders current data totals and campus times without unsupported commuter claims', () => {
  const h = app();
  h.run('renderHomeStats()');
  const html = h.elements.get('home-stats').innerHTML;
  const stats = h.run('calculateRouteStats(UET_DATA.routes,UET_DATA.campuses)');
  assert.ok(html.includes(`<div class="stat-val">${stats.totalRoutes}</div>`));
  assert.ok(html.includes(`<div class="stat-val">${stats.uniqueStops}</div>`));
  for (const campus of stats.campuses) {
    assert.ok(html.includes(`${campus.name} Routes`));
    assert.ok(html.includes(`Scheduled arrival: ${campus.arrivalTimes.join(' / ')}`));
  }
  assert.doesNotMatch(html, /commuters|on-time|15,000/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'), /Daily Student Commuters|19\+|120\+|15,000\+|On-Time Campus Arrival/);
});
test('stop normalization handles case, spacing, Unicode, and punctuation without regex injection', () => {
  const h = app();
  assert.equal(h.run("normalizeStopSearchText('  R. A.   BAZAR / Lahore  ')"), 'r a bazar lahore');
  assert.equal(h.run("normalizeStopSearchText(null)"), '');
  assert.equal(h.run("normalizeStopSearchText('---.*[]')"), '');
  assert.equal(h.run("stopMatchesSearch({name:'R. A. Bazar'},'ra bazar',{exact:true})"), true);
  assert.equal(h.run("stopMatchesSearch({name:'Mughal Pura'},'mughalpura',{exact:true})"), true);
  assert.equal(h.run("stopMatchesSearch({name:'Stop'},'.*')"), false);
});

test('official names and aliases support exact/partial searches while retaining campus filtering', () => {
  const h = app();
  for (const query of ['Islampura','Islam Pura','Ismailpura','Main Bazar Islam Pura']) {
    assert.equal(h.run(`findExactStopMatches(${JSON.stringify(query)},'main').some(route => route.id === 'main-19')`), true);
    h.run(`appState.selectedCampus = 'main'; appState.routeScheduleQuery = ${JSON.stringify(query)}; renderRoutesPage()`);
    const html = h.elements.get('routes-detail-container').innerHTML;
    assert.ok(html.includes('route-card-main-19'));
    assert.doesNotMatch(html, /route-card-ksk-/);
  }
  h.run("appState.selectedCampus='main'; appState.routeScheduleQuery='islamp'; renderRoutesPage()");
  assert.ok(h.elements.get('routes-detail-container').innerHTML.includes('route-card-main-19'));
  for (const campus of ['main','ksk']) {
    assert.equal(h.run(`findExactStopMatches('Laal Pull','${campus}').every(route => route.campusId === '${campus}')`), true);
    assert.ok(h.run(`findExactStopMatches('Laal Pull','${campus}').length`) > 0);
  }
  assert.equal(h.run("UET_DATA.routes.find(route=>route.id==='main-19').stops.some(stop=>stop.name==='Main Bazar Islam Pura')"), true);
});
test('route URL parser resolves valid IDs and safely canonicalizes invalid links', () => {
  const h = app();
  assert.equal(h.run("parseNavigationHash('#routes/main-19').routeId"), 'main-19');
  assert.equal(h.run("parseNavigationHash('#routes/ksk-01').routeId"), 'ksk-01');
  for (const hash of ['#routes/missing','#routes/%E0%A4','#routes/main-19/extra','#routes/','#stops']) {
    assert.equal(h.run(`parseNavigationHash(${JSON.stringify(hash)}).hash`), '#routes');
    assert.equal(h.run(`parseNavigationHash(${JSON.stringify(hash)}).routeId`), null);
  }
});
test('schedule search covers all fields, abbreviations, normalization and empty results', () => {
 const h=app();
 const route={routeNo:19,name:'Distinct Route Name',startPoint:'Start Area',campusId:'main',campus:'Main Campus',stops:[{name:'Local Govt. Complex',aliases:['Civic Offices']},{name:'MAO College'},{name:'Islam Pura',aliases:['Ismailpura']}]};
 for(const query of ['19','Route 19','distinct','Start Area','MAIN','MAO','Islam','Local Government','  local   GOVERNMENT  ','Civic Offices','Ismailpura']) assert.equal(h.run('routeMatchesScheduleSearch('+JSON.stringify(route)+','+JSON.stringify(query)+')'),true,query);
 h.run("appState.selectedCampus='main';appState.routeScheduleQuery='Local Government';renderRoutesPage()");
 assert.ok(h.elements.get('routes-detail-container').innerHTML.includes('Local Govt. Complex'));
 h.run("appState.routeScheduleQuery='zzzz-no-route';renderRoutesPage()");
 assert.ok(h.elements.get('routes-detail-container').innerHTML.includes('No matching routes found'));
});
