// UET Bus Route Info - Main Application Logic

let appState = {
  selectedCampus: 'ksk', // 'ksk' or 'main'
  currentLocation: null, // { lat, lng, name, formattedAddress, placeId, source }
  selectedStopSuggestion: null,
  highlightedStop: null,
  recommendationResults: null, // { status: 'within_radius' | 'nearest' | 'none', matchingRoutes, allNearby, userLat, userLng, locationLabel, targetCampus }
  activeRecommendationIndex: 0,
  locationSearchError: null,
  activePage: 'home',
  routeScheduleQuery: '',
  favorites: JSON.parse(localStorage.getItem('uet_fav_routes') || '[]'),
  selectedRouteId: null,
  routeListScrollY: 0,
  routeListState: null, // campus, query and scroll position before opening details
  map: null,
  markers: []
};

// Centralized schedule version & data freshness metadata.
const scheduleMeta = Object.freeze({
  semester: 'Fall 2026',
  sourceDate: null,
  lastVerified: null
});

// Normalize display labels without changing stored route numbers or route IDs.
function formatRouteLabel(routeNo) {
  const number = String(routeNo ?? '').trim().replace(/^(?:route\b\s*)+/i, '').trim();
  return number ? `Route ${number}` : 'Route';
}
// Haversine distances are straight-line estimates, not walking routes or durations.
function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 'Unavailable';
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(2)} km`;
}

// Theme Management (Professional Light / Dark Mode with Persistence)
function getInitialTheme() {
  const saved = localStorage.getItem('uet_theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
  if (save) {
    localStorage.setItem('uet_theme', theme);
  }
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (toggleBtn) {
    const isDark = theme === 'dark';
    toggleBtn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    toggleBtn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  }
  refreshLucideIcons();
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || getInitialTheme();
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme, true);
}

function initThemeToggle() {
  const currentTheme = getInitialTheme();
  applyTheme(currentTheme, false);

  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleTheme);
  }

  // OS theme change listener when no explicit saved preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('uet_theme')) {
        applyTheme(e.matches ? 'dark' : 'light', false);
      }
    });
  }
}

// ─── Professional Search Loader ──────────────────────────────────────────────
const SearchLoader = (() => {
  const MESSAGES = ['Finding nearby UET pickup points...'];
  const MIN_DURATION_MS = 1400;   // minimum visible time so fast results feel polished
  const MSG_INTERVAL_MS = 900;    // how often the message cycles

  let _msgTimer = null;
  let _msgIndex = 0;
  let _startTime = 0;
  let _resolveMinTimer = null;
  let _pendingHide = false;

  function _getEl() { return document.getElementById('search-loading-overlay'); }
  function _getMsgEl() { return document.getElementById('search-loader-message'); }
  function _getBarEl() { return document.getElementById('search-loader-progress-bar'); }

  function _setMessage(text) {
    const el = _getMsgEl();
    if (!el) return;
    el.classList.add('exiting');
    setTimeout(() => {
      el.textContent = text;
      el.classList.remove('exiting');
    }, 260);
  }

  function _startMessageCycle() {
    _msgIndex = 0;
    _setMessage(MESSAGES[0]);
    _msgTimer = setInterval(() => {
      _msgIndex = (_msgIndex + 1) % MESSAGES.length;
      _setMessage(MESSAGES[_msgIndex]);
    }, MSG_INTERVAL_MS);
  }

  function _stopMessageCycle() {
    if (_msgTimer) { clearInterval(_msgTimer); _msgTimer = null; }
  }

  function _disableButtons(state) {
    ['btn-find-bus', 'btn-locate-me'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = state;
    });
  }

  function show(type = 'find') {
    // Reset bar so CSS animation replays
    const bar = _getBarEl();
    if (bar) {
      bar.classList.remove('complete');
      // Force reflow to restart animation
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }

    const overlay = _getEl();
    if (overlay) overlay.classList.add('active');

    _disableButtons(true);
    _startTime = Date.now();
    _pendingHide = false;
    _stopMessageCycle();
    _startMessageCycle();

    // Set first message based on action type
    _setMessage(type === 'gps' ? 'Detecting your location...' : MESSAGES[0]);
  }

  function hide() {
    const elapsed = Date.now() - _startTime;
    const remaining = MIN_DURATION_MS - elapsed;

    if (remaining > 0) {
      // Wait until minimum duration is met, then hide
      _pendingHide = true;
      setTimeout(() => {
        if (_pendingHide) _doHide();
      }, remaining);
    } else {
      _doHide();
    }
  }

  function _doHide() {
    _pendingHide = false;
    _stopMessageCycle();

    // Flash to 100% progress then fade
    const bar = _getBarEl();
    const msgEl = _getMsgEl();
    if (bar) bar.classList.add('complete');
    if (msgEl) { msgEl.classList.remove('exiting'); msgEl.textContent = '✅ Preparing your results...'; }

    setTimeout(() => {
      const overlay = _getEl();
      if (overlay) overlay.classList.remove('active');
      _disableButtons(false);
      // Reset bar class after fade
      setTimeout(() => { if (bar) bar.classList.remove('complete'); }, 400);
    }, 450);
  }

  return { show, hide };
})();


// Force refresh Lucide SVG icons in dynamic containers
function refreshLucideIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    const iconEls = document.querySelectorAll('i[class*="lucide-"]');
    iconEls.forEach(icon => {
      icon.setAttribute('aria-hidden', 'true');
      const name = Array.from(icon.classList).find(cls => cls.startsWith('lucide-'));
      if (name && !icon.hasAttribute('data-lucide')) {
        icon.setAttribute('data-lucide', name.replace(/^lucide-/, ''));
      }
      if (!icon.classList.contains('lucide')) {
        icon.classList.add('lucide');
      }
    });
    window.lucide.createIcons({
      root: document,
      nameAttr: 'data-lucide'
    });
  }
}

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initUIEvents();
  renderHomePage();
  renderRoutesPage();
  renderFaqs();
  updateFavoritesBadge();
  handleUrlRouting();
  refreshLucideIcons();
});


// Calculate Haversine Distance (in kilometers) between two GPS points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Pickup selection policy (kilometers). Adjust these named limits together.
const NEARBY_ROUTE_CONFIG = Object.freeze({
  nearbyRadiusKm: 1.5,
  fallbackDistanceGapKm: 0.15,
  maxPickupDistanceKm: 1.5
});

/** Find individual campus pickup stops, preserving multiple stops on one route. */function findNearbyRoutes(userLat, userLng, campusFilter, config = NEARBY_ROUTE_CONFIG) {
  const { nearbyRadiusKm, fallbackDistanceGapKm, maxPickupDistanceKm } = config;
  if (![nearbyRadiusKm, fallbackDistanceGapKm, maxPickupDistanceKm].every(value => Number.isFinite(value) && value >= 0) ||
      maxPickupDistanceKm < nearbyRadiusKm || maxPickupDistanceKm === 0) {
    return { status: 'error', error: 'Invalid nearby pickup configuration.', matchingRoutes: [], allNearby: [] };
  }
  const latitude = userLat;
  const longitude = userLng;
  const targetCampus = (campusFilter || '').toString().toLowerCase();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { status: 'error', error: 'Invalid location coordinates.', matchingRoutes: [], allNearby: [] };
  }

  if (targetCampus !== 'main' && targetCampus !== 'ksk') {
    return { status: 'error', error: 'Invalid campus selection.', matchingRoutes: [], allNearby: [] };
  }

  // Step 1: Resolve selected campus ('main' or 'ksk')
  // Step 2: Filter the route database to ONLY that campus (FIRST FILTER).
  const campusRoutes = UET_DATA.routes.filter(route => {
    const rCampusId = (route.campusId || '').toLowerCase();
    const rCampus = (route.campus || '').toLowerCase();
    if (targetCampus === 'main') {
      return rCampusId === 'main' || rCampus === 'main' || rCampus.includes('main');
    }
    if (targetCampus === 'ksk') {
      return rCampusId === 'ksk' || rCampus === 'ksk' || rCampus.includes('ksk');
    }
    return rCampusId === targetCampus || rCampus === targetCampus;
  });

  const stopCandidates = [];

  // Step 3 & 4: Collect stops only from the filtered campus routes and calculate Haversine distance
  campusRoutes.forEach(route => {
    // Keep each stop separate so one route can provide multiple nearby options.
    route.stops.forEach((stop, index) => {
      // Exclude final campus destination stop if it's the terminal destination
      if (index === route.stops.length - 1 && route.stops.length > 1) {
        return;
      }

      const dist = calculateDistance(latitude, longitude, stop.lat, stop.lng);
      if (Number.isFinite(dist)) {
        stopCandidates.push({
        route: route,
        stop: stop,
        stopIndex: index,
        distanceKm: dist
        });
      }
    });
  });

  // Sort individual pickup stops by distance, not routes.
  stopCandidates.sort((a, b) => a.distanceKm - b.distanceKm);

  const nearestStop = stopCandidates[0] || null;
  if (!nearestStop || nearestStop.distanceKm > maxPickupDistanceKm) {
    return { status: 'none', targetCampus, nearestStop, matchingRoutes: [], allNearby: [], maxPickupDistanceKm };
  }

  const hasStopsInRadius = nearestStop.distanceKm <= nearbyRadiusKm;
  const selectionRadiusKm = hasStopsInRadius
    ? nearbyRadiusKm
    : Math.min(maxPickupDistanceKm, nearestStop.distanceKm + fallbackDistanceGapKm);
  const matchingRoutes = stopCandidates.filter(item => item.distanceKm <= selectionRadiusKm);
  return {
    status: hasStopsInRadius ? 'within_radius' : 'nearest',
    targetCampus, nearestStop, selectionRadiusKm, nearbyRadiusKm, maxPickupDistanceKm,
    matchingRoutes,
    // Only expose relevant candidates: no separate broad-radius list of distant stops.
    allNearby: matchingRoutes
  };
}
function runNearbyRouteSearch(latitude, longitude, location, source) {
  SearchLoader.show();
  try {
    const targetCampus = appState.selectedCampus;
    const result = findNearbyRoutes(latitude, longitude, targetCampus);
    if (result.status === 'error') {
      showLocationSearchError(result.error);
      return result;
    }

    appState.currentLocation = {
      lat: Number(latitude),
      lng: Number(longitude),
      name: location.name,
      formattedAddress: location.formattedAddress || location.name,
      placeId: location.placeId || null,
      source: source
    };
    if (source !== 'stop-search') appState.highlightedStop = null;
    appState.locationSearchError = null;
    appState.activeRecommendationIndex = 0;
    appState.recommendationResults = {
      ...result,
      userLat: Number(latitude),
      userLng: Number(longitude),
      locationLabel: location.formattedAddress || location.name,
      campus: targetCampus
    };

    renderResultPage();
    navigateToPage('result');
    return result;
  } finally {
    SearchLoader.hide();
  }
}

function showLocationSearchError(message) {
  appState.currentLocation = null;
  appState.selectedStopSuggestion = null;
  appState.highlightedStop = null;
  appState.locationSearchError = message;
  appState.recommendationResults = null;
  renderResultPage();
  navigateToPage('result');
}

const STOP_SEARCH_MIN_CHARS = 1;
const STOP_SEARCH_MAX_RESULTS = 10;
let stopSearchActiveIndex = -1;
let stopSearchVisibleMatches = [];

function setStopSearchStatus(message) {
  const status = document.getElementById('stop-search-status');
  if (status) status.textContent = message;
}

function getCampusShortName(campusId) {
  const campus = UET_DATA.campuses.find(item => item.id === campusId);
  if (campus?.shortName) return campus.shortName;
  return campusId === 'ksk' ? 'KSK Campus' : 'Main Campus';
}

function buildUetStopSearchIndex(campusId = null) {
  const routes = campusId
    ? UET_DATA.routes.filter(route => route.campusId === campusId)
    : UET_DATA.routes.slice();
  const index = [];
  routes.forEach(route => {
    (route.stops || []).forEach((stop, stopIndex) => {
      index.push({
        key: `${route.campusId}|${route.id}|${stopIndex}`,
        campusId: route.campusId,
        campusLabel: getCampusShortName(route.campusId),
        routeId: route.id,
        routeNo: route.routeNo,
        routeName: route.name || '',
        startPoint: route.startPoint || '',
        stopIndex,
        stopName: stop.name,
        aliases: Array.isArray(stop.aliases) ? stop.aliases : [],
        time: stop.time,
        driverName: getDisplayDriverName(route),
        driverPhone: getDisplayDriverPhone(route),
        vehicleNo: getDisplayVehicleNo(route),
        arrivalTime: route.arrivalTime
      });
    });
  });
  return index;
}

function getStopSearchRank(entry, query) {
  const normalizedQuery = normalizeStopSearchText(query);
  if (!normalizedQuery) return 0;
  const compactQuery = normalizedQuery.replace(/\s/g, '');
  const name = normalizeStopSearchText(entry.stopName);
  const compactName = name.replace(/\s/g, '');
  const aliasNorms = (entry.aliases || []).map(alias => {
    const normalized = normalizeStopSearchText(alias);
    return { normalized, compact: normalized.replace(/\s/g, '') };
  });
  if (name === normalizedQuery || compactName === compactQuery) return 1;
  if (name.startsWith(normalizedQuery) || compactName.startsWith(compactQuery)) return 2;
  if (aliasNorms.some(alias => alias.normalized.startsWith(normalizedQuery) || alias.compact.startsWith(compactQuery))) return 3;
  if (name.includes(normalizedQuery) || compactName.includes(compactQuery)) return 4;
  if (aliasNorms.some(alias => alias.normalized.includes(normalizedQuery) || alias.compact.includes(compactQuery))) return 5;
  return 0;
}

function searchUetStops(query, campusId = null, limit = STOP_SEARCH_MAX_RESULTS) {
  const normalizedQuery = normalizeStopSearchText(query);
  if (normalizedQuery.length < STOP_SEARCH_MIN_CHARS) return [];
  return buildUetStopSearchIndex(campusId)
    .map(entry => ({ ...entry, rank: getStopSearchRank(entry, query) }))
    .filter(entry => entry.rank > 0)
    .sort((a, b) => a.rank - b.rank
      || String(a.routeNo).localeCompare(String(b.routeNo), undefined, { numeric: true })
      || a.stopIndex - b.stopIndex)
    .slice(0, limit);
}

function getStopSearchDropdown() {
  return document.getElementById('stop-search-suggestions');
}

function closeStopSearchDropdown() {
  const dropdown = getStopSearchDropdown();
  const input = document.getElementById('main-location-input');
  stopSearchActiveIndex = -1;
  if (dropdown) {
    dropdown.hidden = true;
    dropdown.innerHTML = '';
  }
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
}

function setStopSearchActiveIndex(index) {
  const dropdown = getStopSearchDropdown();
  if (!dropdown || dropdown.hidden) return;
  const options = [...dropdown.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  stopSearchActiveIndex = ((index % options.length) + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === stopSearchActiveIndex;
    option.setAttribute('aria-selected', String(isActive));
    option.classList.toggle('is-active', isActive);
  });
  const active = options[stopSearchActiveIndex];
  const input = document.getElementById('main-location-input');
  if (input) input.setAttribute('aria-activedescendant', active.id);
  active.scrollIntoView({ block: 'nearest' });
}

function renderStopSearchDropdown(matches, query) {
  const dropdown = getStopSearchDropdown();
  const input = document.getElementById('main-location-input');
  if (!dropdown || !input) return;
  stopSearchVisibleMatches = matches;
  const normalizedQuery = normalizeStopSearchText(query);
  if (normalizedQuery.length < STOP_SEARCH_MIN_CHARS) {
    closeStopSearchDropdown();
    setStopSearchStatus('Search a UET bus stop by name.');
    return;
  }
  if (!matches.length) {
    dropdown.innerHTML = '<li class="stop-search-empty" role="status">No matching UET bus stop found.</li>';
    dropdown.hidden = false;
    stopSearchActiveIndex = -1;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    setStopSearchStatus('No matching UET bus stop found.');
    return;
  }
  dropdown.innerHTML = matches.map((match, index) => `
    <li>
      <button type="button" class="stop-search-option" role="option" id="stop-search-option-${index}"
        data-stop-key="${match.key}" aria-selected="false">
        <span class="stop-search-option-main">
          <i class="lucide-bus" aria-hidden="true"></i>
          <span class="stop-search-option-text">
            <span class="stop-search-option-name">${match.stopName}</span>
            <span class="stop-search-option-meta">${formatRouteLabel(match.routeNo)} &bull; ${match.campusLabel}</span>
          </span>
        </span>
      </button>
    </li>
  `).join('');
  dropdown.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  setStopSearchActiveIndex(0);
  setStopSearchStatus(`${matches.length} matching UET bus stop${matches.length === 1 ? '' : 's'}.`);
  refreshLucideIcons();
}

function updateStopSearchSuggestions() {
  const input = document.getElementById('main-location-input');
  if (!input) return;
  const query = input.value;
  appState.selectedStopSuggestion = null;
  const matches = searchUetStops(query, appState.selectedCampus);
  renderStopSearchDropdown(matches, query);
}

function applySelectedUetStop(entry) {
  if (!entry) return;
  const route = UET_DATA.routes.find(item => item.id === entry.routeId);
  const stop = route?.stops?.[entry.stopIndex];
  if (!route || !stop) return;

  const input = document.getElementById('main-location-input');
  if (input) input.value = stop.name;
  closeStopSearchDropdown();
  appState.selectedStopSuggestion = entry;
  appState.locationSearchError = null;
  appState.currentLocation = {
    name: stop.name,
    formattedAddress: stop.name,
    source: 'stop-search'
  };
  appState.highlightedStop = { routeId: route.id, stopIndex: entry.stopIndex };
  appState.activeRecommendationIndex = 0;
  appState.recommendationResults = {
    status: 'exact_stop',
    source: 'stop-search',
    matchingRoutes: [{ route, stop, stopIndex: entry.stopIndex }],
    allNearby: [],
    locationLabel: stop.name,
    campus: route.campusId
  };
  setStopSearchStatus('Select a UET bus stop to view its route.');
  renderResultPage();
  navigateToPage('result');
}

function handleStopSearchKeydown(event) {
  const dropdown = getStopSearchDropdown();
  if (event.key === 'Escape') {
    closeStopSearchDropdown();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!dropdown || dropdown.hidden || !stopSearchVisibleMatches.length) {
      updateStopSearchSuggestions();
    }
    if (!stopSearchVisibleMatches.length) return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    setStopSearchActiveIndex(stopSearchActiveIndex < 0 ? 0 : stopSearchActiveIndex + delta);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    handleLocationSearch();
  }
}

function getDisplayDriverName(route) {
  if (!route || route.campusId === 'main') return 'N/A';
  const name = String(route.driverName || '').trim();
  return (!name || /^main\s+campus\s+driver/i.test(name)) ? 'N/A' : name;
}

function getDisplayDriverPhone(route) {
  if (!route || route.campusId === 'main') return 'N/A';
  const phone = String(route.driverPhone || '').trim();
  return phone || 'N/A';
}

function getDisplayVehicleNo(route) {
  if (!route || route.campusId === 'main') return 'N/A';
  const vehicle = String(route.vehicleNo || '').trim();
  return (!vehicle || /^uet-m/i.test(vehicle)) ? 'N/A' : vehicle;
}

function setSelectedCampus(campusId, { updateHistory = true } = {}) {
  const campusChanged = appState.selectedCampus !== campusId;
  appState.selectedCampus = campusId;
  const selectedRoute = UET_DATA.routes.find(route => route.id === appState.selectedRouteId);
  if (appState.selectedRouteId && (!selectedRoute || selectedRoute.campusId !== campusId)) {
    appState.selectedRouteId = null;
  }
  if (campusChanged) {
    // A previous campus's Back snapshot must not restore its route list later.
    appState.routeListState = null;
    appState.routeListScrollY = 0;
    if (appState.selectedStopSuggestion && appState.selectedStopSuggestion.campusId !== campusId) {
      appState.selectedStopSuggestion = null;
    }
  }

  document.querySelectorAll('.campus-btn, .route-campus-btn, .result-campus-btn').forEach(btn => {
    const isActive = btn.dataset.campus === campusId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  renderHomePage();
  renderRoutesPage();
  if (updateHistory) saveNavigationEntry(true);
  if (document.getElementById('main-location-input')?.value) updateStopSearchSuggestions();

  // If on result page with an active location, re-run recommendation with new campus filter
  if (appState.currentLocation && appState.activePage === 'result') {
    const location = appState.currentLocation;
    if (location.source === 'stop-search') {
      const matches = searchUetStops(location.name, campusId);
      const exact = matches.find(match => normalizeStopSearchText(match.stopName) === normalizeStopSearchText(location.name));
      if (exact) applySelectedUetStop(exact);
      else showLocationSearchError('No matching UET bus stop found.');
      return;
    }
    runNearbyRouteSearch(location.lat, location.lng, {
      name: location.name,
      formattedAddress: location.formattedAddress || location.name,
      lat: location.lat,
      lng: location.lng,
      placeId: location.placeId
    }, location.source || 'gps');
  }
}

// Navigation & Tab Switching
function navigateToPage(pageId, { resetScroll = true, updateHistory = true, routeId = null, fromRouteList = false } = {}) {
  if (updateHistory) saveNavigationEntry(true);
  if (pageId === 'routes') {
    const route = UET_DATA.routes.find(item => item.id === routeId);
    if (route) setSelectedCampus(route.campusId, { updateHistory: false });
    appState.selectedRouteId = route?.id || null;
    renderRoutesPage();
  }
  appState.activePage = pageId;
  document.querySelectorAll('.page-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const targetSec = document.getElementById(`page-${pageId}`);
  if (targetSec) {
    targetSec.classList.add('active');
  }

  // Update nav links
  document.querySelectorAll('.nav-btn, .mobile-menu-item').forEach(btn => {
    if (btn.dataset.page === pageId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (pageId === 'favorites') {
    renderFavoritesPage();
  }

  refreshLucideIcons();
  if (pageId === 'routes' && routeId) document.querySelector?.('.route-back-button')?.focus({preventScroll:true});
  if (updateHistory) saveNavigationEntry(false, fromRouteList, resetScroll ? 0 : window.scrollY);
  if (resetScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Shared modal focus management for dialogs and the mobile navigation drawer.
let activeAccessibleLayer = null;
function layerFocusableElements(root) {
  return [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length && !element.closest('[inert], [hidden]'));
}
function openAccessibleLayer(root, initialFocus) {
  if (!root || !document.body) return;
  if (activeAccessibleLayer) closeAccessibleLayer(false);
  const trigger = document.activeElement;
  root.inert = false;
  root.setAttribute('aria-hidden', 'false');
  const siblings = [...document.body.children].filter(element => element !== root &&
    element.id !== 'mobile-menu-overlay' && !['SCRIPT','STYLE'].includes(element.tagName));
  const previousInert = siblings.map(element => [element, element.inert]);
  // Move focus before making the background inert.
  (initialFocus || layerFocusableElements(root)[0] || root).focus({preventScroll:true});
  siblings.forEach(element => { element.inert = true; });
  activeAccessibleLayer = {root, trigger, previousInert};
}
function closeAccessibleLayer(restoreFocus = true) {
  if (!activeAccessibleLayer) return;
  const {root, trigger, previousInert} = activeAccessibleLayer;
  activeAccessibleLayer = null;
  if (root.contains(document.activeElement)) document.activeElement.blur();
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  previousInert.forEach(([element, inert]) => { element.inert = inert; });
  if (restoreFocus) setTimeout(() => {
    const target = trigger?.isConnected && trigger.getClientRects().length
      ? trigger : document.querySelector('.page-section.active button, .page-section.active a[href], .nav-toggle');
    target?.focus({preventScroll:true});
  }, 0);
}
function handleLayerKeydown(event) {
  if (!activeAccessibleLayer) return;
  const root = activeAccessibleLayer.root;
  if (event.key === 'Escape') {
    event.preventDefault();
    root.id === 'mobile-menu-drawer' ? closeMobileMenu() : closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = layerFocusableElements(root);
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); root.focus(); return; }
  const current = document.activeElement;
  if (event.shiftKey && (current === first || !controls.includes(current))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (current === last || !controls.includes(current))) {
    event.preventDefault(); first.focus();
  }
}

// UI Event Handlers Setup
function closeMobileMenu() {
  if (activeAccessibleLayer?.root.id === 'mobile-menu-drawer') closeAccessibleLayer();
  const drawer = document.getElementById('mobile-menu-drawer');
  const overlay = document.getElementById('mobile-menu-overlay');
  const toggle = document.querySelector('.nav-toggle');

  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.inert = true;
  }

  if (overlay) {
    overlay.classList.remove('active');
  }

  document.body.classList.remove('menu-open');

  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
  }
}

function openMobileMenu() {
  const drawer = document.getElementById('mobile-menu-drawer');
  const overlay = document.getElementById('mobile-menu-overlay');
  const toggle = document.querySelector('.nav-toggle');

  if (drawer) {
    drawer.classList.add('open');
  }

  if (overlay) {
    overlay.classList.add('active');
  }

  document.body.classList.add('menu-open');

  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
  }
  openAccessibleLayer(drawer, drawer?.querySelector('.mobile-menu-close'));
}

function initUIEvents() {
  // Navigation button clicks
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const page = btn.dataset.page;
      navigateToPage(page);
      closeMobileMenu();
    });
  });

  const navToggle = document.querySelector('.nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const drawer = document.getElementById('mobile-menu-drawer');
      if (!drawer) return;
      const isOpen = drawer.classList.contains('open');
      if (isOpen) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }

  const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
  if (mobileMenuOverlay) {
    mobileMenuOverlay.addEventListener('click', closeMobileMenu);
  }

  const mobileMenuClose = document.querySelector('.mobile-menu-close');
  if (mobileMenuClose) {
    mobileMenuClose.addEventListener('click', closeMobileMenu);
  }

  document.addEventListener('keydown', handleLayerKeydown);
  window.addEventListener?.('resize', () => {
    if (window.innerWidth > 1024 && activeAccessibleLayer?.root.id === 'mobile-menu-drawer') closeMobileMenu();
  });

  // Campus Toggle Buttons
  document.querySelectorAll('.campus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setSelectedCampus(btn.dataset.campus);
    });
  });

  document.addEventListener('click', (e) => {
    const campusBtn = e.target.closest('.route-campus-btn, .result-campus-btn');
    if (!campusBtn) return;
    setSelectedCampus(campusBtn.dataset.campus);
  });

  // Homepage UET bus-stop autocomplete (local dataset only)
  const mainSearchInput = document.getElementById('main-location-input');
  if (mainSearchInput) {
    mainSearchInput.addEventListener('input', updateStopSearchSuggestions);
    mainSearchInput.addEventListener('keydown', handleStopSearchKeydown);
    mainSearchInput.addEventListener('focus', () => {
      if (normalizeStopSearchText(mainSearchInput.value)) updateStopSearchSuggestions();
    });
  }

  const stopSearchDropdown = document.getElementById('stop-search-suggestions');
  if (stopSearchDropdown) {
    stopSearchDropdown.addEventListener('mousedown', (e) => e.preventDefault());
    stopSearchDropdown.addEventListener('click', (e) => {
      const option = e.target.closest('[data-stop-key]');
      if (!option) return;
      const match = stopSearchVisibleMatches.find(item => item.key === option.dataset.stopKey);
      if (match) applySelectedUetStop(match);
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#main-location-input, #stop-search-suggestions, .location-search-field')) return;
    closeStopSearchDropdown();
  });

  // Find Bus Button
  const btnFindBus = document.getElementById('btn-find-bus');
  if (btnFindBus) {
    btnFindBus.addEventListener('click', handleLocationSearch);
  }

  // Detect GPS Location Button
  const btnLocate = document.getElementById('btn-locate-me');
  if (btnLocate) {
    btnLocate.addEventListener('click', detectUserGeolocation);
  }

  const routeScheduleInput = document.getElementById('route-schedule-search');
  if (routeScheduleInput) {
    routeScheduleInput.addEventListener('input', (e) => {
      appState.routeScheduleQuery = e.target.value.trim();
      renderRoutesPage();
    });

    routeScheduleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        routeScheduleInput.value = '';
        appState.routeScheduleQuery = '';
        renderRoutesPage();
      }
    });
  }

  // Modal Close buttons
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el || el.classList.contains('modal-close')) {
        closeModal();
      }
    });
  });
}

// Geolocation Handler - Uses pure browser Geolocation API coordinates
function detectUserGeolocation() {
  if (!navigator.geolocation) {
    showLocationSearchError('Geolocation is not supported by your browser. Please search a UET bus stop.');
    return;
  }

  SearchLoader.show('gps');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const input = document.getElementById('main-location-input');
      if (input && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        input.value = `GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
      }
      runNearbyRouteSearch(latitude, longitude, {
        name: 'Your Current GPS Location',
        formattedAddress: 'Your Current GPS Location'
      }, 'gps');
    },
    (err) => {
      const message = err.code === 1
        ? 'Location permission was denied. Please allow access or search a UET bus stop.'
        : err.code === 3
          ? 'Location detection timed out. Please try again or search a UET bus stop.'
          : 'Your location is unavailable. Please try again or search a UET bus stop.';
      SearchLoader.hide();
      showLocationSearchError(message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
function normalizeStopSearchText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\bgovt\b/g, 'government').trim().replace(/\s+/g, ' ');
}

// Shared by exact header lookup and partial Route Schedules filtering.
function stopMatchesSearch(stop, query, { exact = false } = {}) {
  const normalizedQuery = normalizeStopSearchText(query);
  if (!normalizedQuery) return false;
  const compactQuery = normalizedQuery.replace(/\s/g, '');
  const names = [stop.name, ...(Array.isArray(stop.aliases) ? stop.aliases : [])];
  return names.some(name => {
    const normalizedName = normalizeStopSearchText(name);
    const compactName = normalizedName.replace(/\s/g, '');
    return exact
      ? compactName === compactQuery
      : normalizedName.includes(normalizedQuery) || compactName.includes(compactQuery);
  });
}

// Comprehensive search for Route Schedules page supporting:
// route number, formatted route label, route name, start area, campus, stop name, and stop aliases
function routeMatchesScheduleSearch(route, query) {
  const normalizedQuery = normalizeStopSearchText(query);
  if (!normalizedQuery) return true;
  const compactQuery = normalizedQuery.replace(/\s/g, '');

  // 1. Route number and formatted route label
  const routeNoNorm = normalizeStopSearchText(String(route.routeNo || ''));
  const routeLabelNorm = normalizeStopSearchText(formatRouteLabel(route.routeNo));
  if (routeNoNorm === normalizedQuery || routeNoNorm === compactQuery ||
      routeLabelNorm === normalizedQuery || routeLabelNorm.replace(/\s/g, '') === compactQuery ||
      routeLabelNorm.includes(normalizedQuery) || routeLabelNorm.replace(/\s/g, '').includes(compactQuery) ||
      routeNoNorm.includes(normalizedQuery)) {
    return true;
  }

  // 2. Route Name
  const routeNameNorm = normalizeStopSearchText(route.name || '');
  if (routeNameNorm.includes(normalizedQuery) || routeNameNorm.replace(/\s/g, '').includes(compactQuery)) {
    return true;
  }

  // 3. Start Area
  const startAreaNorm = normalizeStopSearchText(route.startPoint || '');
  if (startAreaNorm.includes(normalizedQuery) || startAreaNorm.replace(/\s/g, '').includes(compactQuery)) {
    return true;
  }

  // 4. Campus
  const campusLabel = route.campusId === 'ksk' ? 'ksk new campus' : 'main campus gt road';
  const campusNorm = normalizeStopSearchText(route.campusId || '');
  const sourceCampus = normalizeStopSearchText(route.campus || '');
  if (campusNorm === normalizedQuery || campusLabel.includes(normalizedQuery) || sourceCampus.includes(normalizedQuery)) {
    return true;
  }

  // 5. Stops and Stop Aliases
  return (route.stops || []).some(stop => stopMatchesSearch(stop, normalizedQuery));
}

function findExactStopMatches(query, preferredCampusId = null) {
  const normalizedQuery = normalizeStopSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const preferredMatches = preferredCampusId
    ? UET_DATA.routes.filter(route => route.campusId === preferredCampusId && route.stops.some(stop => stopMatchesSearch(stop, normalizedQuery, { exact: true })))
    : [];

  if (preferredMatches.length > 0) {
    return preferredMatches;
  }

  return UET_DATA.routes.filter(route =>
    route.stops.some(stop => stopMatchesSearch(stop, normalizedQuery, { exact: true }))
  );
}

function handleLocationSearch() {
  const input = document.getElementById('main-location-input');
  const query = input ? input.value : '';
  if (appState.selectedStopSuggestion) {
    applySelectedUetStop(appState.selectedStopSuggestion);
    return;
  }
  if (!normalizeStopSearchText(query)) {
    showLocationSearchError('Please select a UET bus stop from the suggestions.');
    return;
  }
  const matches = stopSearchVisibleMatches.length
    ? stopSearchVisibleMatches
    : searchUetStops(query, appState.selectedCampus);
  if (!matches.length) {
    renderStopSearchDropdown([], query);
    showLocationSearchError('No matching UET bus stop found.');
    return;
  }
  const selected = matches[Math.max(0, stopSearchActiveIndex)] || matches[0];
  applySelectedUetStop(selected);
}

// Quick Chip Select - passes coordinates into pure GPS distance algorithm for selected campus
function selectAreaChip(areaName) {
  const area = POPULAR_AREAS.find(a => a.name === areaName);
  if (area) {
    const input = document.getElementById('main-location-input');
    if (input) input.value = area.name;
    runNearbyRouteSearch(area.lat, area.lng, {
      name: area.name,
      formattedAddress: area.name,
      lat: area.lat,
      lng: area.lng
    }, 'quick-chip');
  }
}

// Count named stops without treating unverified coordinates as physical identity.
function countUniqueStops(routes) {
  const names = routes.flatMap(route => route.stops || [])
    .map(stop => (stop.name || '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  return new Set(names).size;
}

function calculateCampusStats(routes, campuses) {
  return campuses.map(campus => {
    const campusRoutes = routes.filter(route => route.campusId === campus.id);
    return {
      campusId: campus.id,
      name: campus.shortName || campus.name,
      routeCount: campusRoutes.length,
      uniqueStopCount: countUniqueStops(campusRoutes),
      arrivalTimes: [...new Set(campusRoutes.map(route => route.arrivalTime?.trim()).filter(Boolean))].sort()
    };
  });
}

function calculateRouteStats(routes, campuses) {
  return { totalRoutes: routes.length, uniqueStops: countUniqueStops(routes),
    campuses: calculateCampusStats(routes, campuses) };
}

function formatCampusArrivalSummary(campus) {
  if (!campus.arrivalTimes || !campus.arrivalTimes.length) return '';
  if (campus.id === 'ksk' || campus.arrivalTimes.length === 1) {
    return `Arrival: ${campus.arrivalTimes[0]}`;
  }
  const compactTimes = campus.arrivalTimes.map(time => time.replace(/\s*AM$/i, ''));
  return `Arrivals: ${compactTimes.join(' • ')}`;
}

function renderHomeStats() {
  const container = document.getElementById('home-stats');
  if (!container) return;
  const stats = calculateRouteStats(UET_DATA.routes, UET_DATA.campuses);
  const cards = [
    {icon:'bus', value:stats.totalRoutes, label:'Total Routes'},
    {icon:'map-pin', value:stats.uniqueStops, label:'Unique Stops'}
  ];
  stats.campuses.forEach(campus => cards.push({
    icon:'graduation-cap', value:campus.routeCount, label:`${campus.name} Routes`,
    detail: formatCampusArrivalSummary(campus)
  }));
  container.innerHTML = cards.map(card => `
    <div class="stat-card">
      <div class="stat-icon"><i class="lucide-${card.icon}"></i></div>
      <div class="stat-content">
        <div class="stat-val">${card.value}</div>
        <div class="stat-lbl stat-title">${card.label}</div>
        ${card.detail ? `<div class="stat-lbl stat-detail">${card.detail}</div>` : ''}
      </div>
    </div>
  `).join('');
}
// Render Home Page
function renderHomePage() {
  renderHomeStats();
  const routesGrid = document.getElementById('home-routes-grid');
  if (!routesGrid) return;

  // Filter routes by campus choice
  const displayRoutes = UET_DATA.routes.filter(r => r.campusId === appState.selectedCampus);

  let html = '';
  displayRoutes.forEach(route => {
    const isFav = appState.favorites.includes(route.id);
    const stopCount = route.stops.length;
    const firstStop = route.stops[0].name;
    const lastStop = route.stops[stopCount - 1].name;

    html += `
      <div class="route-card">
        <div>
          <div class="route-card-header">
            <span class="route-badge">${formatRouteLabel(route.routeNo)}</span>
            <span class="campus-chip">${route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}</span>
          </div>
          <h3 class="route-card-title">${route.name}</h3>
          <p class="route-card-stops">
            <i class="lucide-map-pin" style="font-size:0.85rem; color:var(--primary-light);"></i> 
            <strong>${firstStop}</strong> &rarr; <strong>${lastStop}</strong> (${stopCount} Stops)
          </p>
          <div class="route-meta-grid">
            <div class="meta-item">
              <i class="lucide-user"></i>
              <span>${getDisplayDriverName(route)}</span>
            </div>
            <div class="meta-item">
              <i class="lucide-phone"></i>
              <span>${getDisplayDriverPhone(route)}</span>
            </div>
            <div class="meta-item">
              <i class="lucide-clock"></i>
              <span>Arrival: ${route.arrivalTime}</span>
            </div>
            <div class="meta-item">
              <i class="lucide-bus"></i>
              <span>${getDisplayVehicleNo(route)}</span>
            </div>
          </div>
        </div>
        
        <div class="route-card-actions">
          <button class="btn-card-primary" onclick="viewRouteDetail('${route.id}')">
            <i class="lucide-eye"></i> View Morning Route
          </button>
          <button class="btn-fav ${isFav ? 'active' : ''}" aria-pressed="${isFav}" onclick="toggleFavorite('${route.id}', this)" aria-label="${isFav ? 'Remove from Saved' : 'Save Route'}" title="${isFav ? 'Remove from Saved' : 'Save Route'}">
            <i class="lucide-bookmark"></i>
          </button>
        </div>
      </div>
    `;
  });

  routesGrid.innerHTML = html;

  // Render Popular Area Chips
  const chipsContainer = document.getElementById('area-chips-wrapper');
  if (chipsContainer && typeof POPULAR_AREAS !== 'undefined') {
    chipsContainer.innerHTML = `
      <span class="quick-chip-title"><i class="lucide-sparkles"></i> Popular Areas:</span>
      ${POPULAR_AREAS.map(a => `
        <button class="area-chip" onclick="selectAreaChip('${a.name}')">${a.name}</button>
      `).join('')}
    `;
  }
  refreshLucideIcons();
}

// Switch active recommendation when multiple routes are found
function selectActiveRecommendation(index) {
  appState.activeRecommendationIndex = index;
  renderResultPage();
  document.querySelector?.('[data-pickup-index="' + index + '"]')?.focus();
}

// Render Result Page (GPS-based Bus Route Recommendation Result)
function renderResultPage() {
  const container = document.getElementById('result-content-container');
  if (!container) return;

  const currentCampusName = appState.selectedCampus === 'main' ? 'Main Campus (GT Road)' : 'KSK / New Campus';

  // Campus Selector Bar for Result Page
  const campusToggleBarHtml = `
    <div class="info-card" style="margin-bottom:1.25rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Target Campus Filter:</span>
          <div style="margin-top:0.15rem; font-weight:700; color:var(--heading-color); font-size:1.05rem;">
            ${currentCampusName}
          </div>
        </div>
        <div class="campus-toggle-wrapper" style="margin:0; background:var(--bg-surface-subtle); border:1px solid var(--border-light); padding:0.25rem;">
          <button class="route-campus-btn ${appState.selectedCampus === 'ksk' ? 'active' : ''}" data-campus="ksk" aria-pressed="${appState.selectedCampus === 'ksk'}" style="padding:0.45rem 1.1rem; font-size:0.85rem;">
            <i class="lucide-building-2"></i> KSK Campus
          </button>
          <button class="route-campus-btn ${appState.selectedCampus === 'main' ? 'active' : ''}" data-campus="main" aria-pressed="${appState.selectedCampus === 'main'}" style="padding:0.45rem 1.1rem; font-size:0.85rem;">
            <i class="lucide-graduation-cap"></i> Main Campus
          </button>
        </div>
      </div>
    </div>
  `;

  if (appState.locationSearchError) {
    container.innerHTML = `
      ${campusToggleBarHtml}
      <div class="info-card no-result-box">
        <div class="no-result-icon"><i class="lucide-map-pin-off"></i></div>
        <h3>Location not found</h3>
        <p>${appState.locationSearchError}</p>
        <div style="margin-top:1.5rem;">
          <button class="btn-find-bus" style="margin:0 auto;" onclick="detectUserGeolocation()">
            <i class="lucide-crosshair"></i> Use GPS Location
          </button>
        </div>
      </div>
    `;
    return;
  }

  const rec = appState.recommendationResults;
  if (!rec || rec.status === 'none' || !rec.matchingRoutes || rec.matchingRoutes.length === 0) {
    container.innerHTML = `
      ${campusToggleBarHtml}
      <div class="info-card no-result-box">
        <div class="no-result-icon"><i class="lucide-search-x"></i></div>
        <h3>No nearby UET bus stop found within 1.5 km.</h3>
        <p>No UET pickup stop in the schedule data was found within 1.5 km of your location for <strong>${currentCampusName}</strong>.</p>
        <div style="margin-top:1.5rem; display:flex; gap:0.75rem; justify-content:center; flex-wrap:wrap;">
          <button class="btn-find-bus" onclick="detectUserGeolocation()">
            <i class="lucide-crosshair"></i> Retry GPS
          </button>
          <button class="btn-secondary" onclick="setSelectedCampus('${appState.selectedCampus === 'main' ? 'ksk' : 'main'}')">
            <i class="lucide-arrow-right-left"></i> Check ${appState.selectedCampus === 'main' ? 'KSK' : 'Main'} Campus Routes
          </button>
          <button class="btn-secondary" onclick="navigateToPage('routes')">
            <i class="lucide-route"></i> Browse All Routes
          </button>
        </div>
      </div>
    `;
    return;
  }

  const activeIdx = appState.activeRecommendationIndex || 0;
  const primaryItem = rec.matchingRoutes[activeIdx] || rec.matchingRoutes[0];
  const { route, stop, stopIndex, distanceKm } = primaryItem;
  const isFav = appState.favorites.includes(route.id);
  const formattedDist = formatDistance(distanceKm);
  const userLocationLabel = rec.locationLabel || "Your Location";
  const userLat = rec.userLat;
  const userLng = rec.userLng;
  const campusLabel = route.campusId === 'ksk' ? 'KSK New Campus' : 'Main Campus';

  // Build complete route stops timeline
  let timelineHtml = '';
  route.stops.forEach((s, idx) => {
    let typeClass = '';
    let badgeText = '';

    if (idx === 0) {
      typeClass = 'origin';
      badgeText = 'Morning Origin';
    } else if (idx === route.stops.length - 1) {
      typeClass = 'destination';
      badgeText = 'Campus Arrival';
    } else if (idx === stopIndex) {
      typeClass = 'nearest';
      badgeText = 'Nearest Pickup Stop';
    }

    timelineHtml += `
      <div class="timeline-item ${typeClass}" style="--timeline-delay:${idx * 70}ms;">
        <div class="timeline-marker" aria-hidden="true"></div>
        <div class="timeline-stop-content">
          <div class="timeline-name">${s.name}</div>
          <div class="timeline-stop-meta">
            <span>Stop #${idx + 1}</span>
            ${badgeText ? `<span class="timeline-status">${badgeText}</span>` : ''}
          </div>
        </div>
        <div class="timeline-time">${s.time}</div>
      </div>
    `;
  });

  // Show every nearby pickup candidate, including multiple stops on one route.
  const isMultiMatch = rec.matchingRoutes.length > 1;
  let multiRouteSelectorHtml = '';
  if (isMultiMatch) {
    multiRouteSelectorHtml = `
      <div class="info-card" style="margin-bottom:1.25rem;">
        <div class="info-card-title">
          <i class="lucide-map-pin" style="color:var(--primary-light)"></i>
          <span>Nearby Pickup Options (${rec.matchingRoutes.length} Found)</span>
        </div>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1rem;">
          ${rec.status === 'nearest' ? 'The nearest pickup stop and options at a similar distance, sorted from nearest to farthest:' : `Pickup stops within 1.5 km, sorted from nearest to farthest:`}
        </p>
        <div style="display:flex; flex-direction:column; gap:0.6rem;">
          ${rec.matchingRoutes.map((item, i) => {
            const isSelected = i === activeIdx;
            const distStr = formatDistance(item.distanceKm);
            return `
              <button type="button" class="pickup-option" aria-pressed="${isSelected}" data-pickup-index="${i}" onclick="selectActiveRecommendation(${i})" style="cursor:pointer; background:${isSelected ? 'var(--bg-surface-highlight)' : 'var(--bg-surface-subtle)'}; border:2px solid ${isSelected ? 'var(--primary-light)' : 'var(--border-light)'}; border-radius:var(--radius-md); padding:0.85rem 1rem; display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; transition:var(--transition-fast);">
                <span style="display:flex; align-items:center; gap:0.75rem;">
                  <span>
                    <span style="font-weight:700; color:var(--heading-color); font-size:0.95rem;">${item.stop.name}</span>
                    <span style="font-size:0.82rem; color:var(--text-muted);">
                      ${formatRouteLabel(item.route.routeNo)} &bull; ${item.route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}
                    </span>
                  </span>
                  <span>
                    <span style="font-size:0.82rem; color:var(--text-muted);">
                      Pickup time: <strong>${item.stop.time}</strong>
                    </span>
                  </span>
                </span>
                <span style="display:flex; align-items:center; gap:0.5rem;">
                  <span class="distance-badge"><i class="lucide-map-pin"></i> Approx. distance: ${distStr}</span>
                  <span style="font-size:0.8rem; font-weight:600; color:${isSelected ? 'var(--primary-light)' : 'var(--text-muted)'};">${isSelected ? '✓ Recommended' : 'Select'}</span>
                </span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Map markers for Leaflet
  const mapPoints = [
    { lat: userLat, lng: userLng, title: 'Your GPS Location', popup: `<b>Your GPS Location</b><br>${userLocationLabel}` },
    { lat: stop.lat, lng: stop.lng, title: `Pickup: ${stop.name}`, popup: `<b>${formatRouteLabel(route.routeNo)} - ${stop.name}</b><br>Pickup Time: ${stop.time}<br>Approx. distance: ${formattedDist}` },
    { lat: route.stops[route.stops.length - 1].lat, lng: route.stops[route.stops.length - 1].lng, title: 'Campus Destination', popup: `<b>${route.stops[route.stops.length - 1].name}</b>` }
  ];

  container.innerHTML = `
    ${campusToggleBarHtml}

    <!-- Hero Recommendation Banner -->
    <div class="result-hero-box">
      <div class="nearest-stop-banner">
        <div class="stop-pin-icon">
          <i class="lucide-navigation"></i>
        </div>
        <div class="nearest-stop-info" style="flex:1;">
          <div style="font-size:0.85rem; text-transform:uppercase; font-weight:700; color:var(--text-muted);">
            Recommended ${campusLabel} Bus Stop for ${userLocationLabel}
          </div>
          <h2>${stop.name}</h2>
          <div style="display:flex; gap:0.5rem; align-items:center; margin-top:0.3rem; flex-wrap:wrap;">
            <span class="route-badge" style="font-size:0.95rem;">${formatRouteLabel(route.routeNo)}</span>
            <span class="distance-badge"><i class="lucide-map-pin"></i> Approx. distance: ${formattedDist}</span>
            <span style="font-size:0.85rem; color:var(--text-muted);"><i class="lucide-clock"></i> Pickup Time: <strong>${stop.time}</strong></span>
            <span class="campus-chip">${campusLabel}</span>
          </div>
        </div>
        <div>
          ${renderStopNavigation(stop)}
        </div>
      </div>
    </div>

    ${multiRouteSelectorHtml}

    <!-- Main Detail Grid -->
    <div class="details-split-grid">
      <div>
        <div class="info-card">
          <div class="info-card-title">
            <i class="lucide-bus" style="color:var(--primary-light)"></i>
            <span>Complete Route Stops & Morning Schedule</span>
            <span class="route-badge" style="margin-left:auto;">${formatRouteLabel(route.routeNo)}</span>
          </div>
          <div style="font-size:1.1rem; font-weight:700; color:var(--heading-color); margin-bottom:0.4rem;">
            ${route.name}
          </div>
          <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:1rem;">
            Destination Campus: <strong>${campusLabel} (Arrival: ${route.arrivalTime})</strong>
          </p>

          <h4 style="font-size:0.95rem; color:var(--heading-color); margin-top:1.25rem; margin-bottom:0.75rem;">
            <i class="lucide-list"></i> Complete Route Stops (In Order)
          </h4>
          <div class="stops-timeline">
            ${timelineHtml}
          </div>
        </div>


      </div>

      <div>
        <div class="info-card">
          <div class="info-card-title">
            <i class="lucide-user-check" style="color:var(--primary-light)"></i>
            <span>Driver & Vehicle Information</span>
          </div>
          <div class="driver-contact-box" style="margin-bottom:1rem;">
            <div class="driver-avatar">${(getDisplayDriverName(route) || 'N/A').charAt(0)}</div>
            <div class="driver-info">
              <h4>${getDisplayDriverName(route)}</h4>
              <p style="font-size:0.82rem; color:var(--text-muted);">UET Bus Driver</p>
              <p style="font-size:0.85rem; font-weight:600; margin-top:0.2rem;">${getDisplayDriverPhone(route)}</p>
            </div>
            <a href="${(route.campusId === 'main' || getDisplayDriverPhone(route) === 'N/A') ? 'javascript:void(0)' : `tel:${route.driverPhone}`}" class="btn-call" title="${(route.campusId === 'main' || getDisplayDriverPhone(route) === 'N/A') ? 'Driver phone unavailable' : 'Call Driver'}" ${(route.campusId === 'main' || getDisplayDriverPhone(route) === 'N/A') ? 'onclick="return false;"' : ''}>
              <i class="lucide-phone-call"></i> ${(route.campusId === 'main' || getDisplayDriverPhone(route) === 'N/A') ? 'N/A' : 'Call'}
            </a>
          </div>

          <div style="background:var(--bg-surface-subtle); padding:0.85rem; border-radius:var(--radius-md); font-size:0.85rem; margin-bottom:1rem; border:1px solid var(--border-light);">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-muted);">Pickup Stop:</span>
              <strong>${stop.name} (${stop.time})</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-muted);">Approx. distance:</span>
              <strong style="color:var(--success);">${formattedDist}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-muted);">Vehicle Number:</span>
              <strong>${getDisplayVehicleNo(route)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted);">Campus Destination:</span>
              <strong>${campusLabel}</strong>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:0.5rem;">
            <button class="btn-secondary" style="width:100%; justify-content:center;" onclick="printRouteSchedule('${route.id}')">
              <i class="lucide-printer"></i> Print / Download Route PDF
            </button>
            <button class="btn-secondary ${isFav ? 'active' : ''}" style="width:100%; justify-content:center;" aria-pressed="${isFav}" onclick="toggleFavorite('${route.id}', this)" aria-label="${isFav ? 'Remove from Saved' : 'Save Route'}" title="${isFav ? 'Remove from Saved' : 'Save Route'}">
              <i class="lucide-bookmark"></i> ${isFav ? 'Saved' : 'Save Route'}
            </button>
          </div>
        </div>

        <div class="info-card">
          <div class="info-card-title">
            <i class="lucide-map" style="color:var(--primary-light)"></i>
            <span>Interactive Pickup Location Map</span>
          </div>
          <div id="result-map" class="map-container" style="height:280px; border-radius:var(--radius-md);"></div>
        </div>
      </div>
    </div>
  `;

  // Init Leaflet map after DOM render
  setTimeout(() => {
    initLeafletMap('result-map', [stop.lat, stop.lng], 13, mapPoints);
  }, 100);
}

function renderRouteSummaryCard(route) {
  const firstStop = route.stops[0];
  return `
    <article class="route-card" id="route-card-${route.id}">
      <div>
        <div class="route-card-header">
          <span class="route-badge">${formatRouteLabel(route.routeNo)}</span>
          <span class="campus-chip">${route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}</span>
        </div>
        <h3 class="route-card-title">${route.name}</h3>
        <p class="route-card-stops">Starts at ${route.startPoint || firstStop.name}</p>
        <div class="route-meta-grid">
          <div class="meta-item"><i class="lucide-user"></i><span>${getDisplayDriverName(route)}</span></div>
          <div class="meta-item"><i class="lucide-phone"></i><span>${getDisplayDriverPhone(route)}</span></div>
          <div class="meta-item"><i class="lucide-bus"></i><span>${getDisplayVehicleNo(route)}</span></div>
          <div class="meta-item"><i class="lucide-clock"></i><span>${firstStop.time} report</span></div>
          <div class="meta-item"><i class="lucide-map-pin"></i><span>${firstStop.name}</span></div>
          <div class="meta-item"><i class="lucide-list"></i><span>${route.stops.length} stops</span></div>
        </div>
      </div>
      <div class="route-card-actions">
        <button class="btn-card-primary" onclick="viewRouteDetail('${route.id}')">
          <i class="lucide-arrow-right"></i> View Full Route
        </button>
      </div>
    </article>
  `;
}

function renderRouteDetailView(route) {
  const isFav = appState.favorites.includes(route.id);
  const campusLabel = route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus';
  const firstStop = route.stops[0];
  return `
    <button class="btn-secondary route-back-button" onclick="returnToRouteList()">
      <i class="lucide-arrow-left"></i> Back to Route Schedules
    </button>
    <div class="route-detail-heading">
      <div>
        <h2>${formatRouteLabel(route.routeNo)} - Full Details</h2>
        <p>${route.name}</p>
      </div>
      <span class="campus-chip">${campusLabel}</span>
    </div>
    <div class="details-split-grid">
      <div class="info-card">
        <div class="info-card-title"><i class="lucide-bus"></i><span>Complete Route Stops & Morning Schedule</span></div>
        <div class="route-detail-meta">
          <span><strong>Reporting:</strong> ${firstStop.time}</span>
          <span><strong>Arrival:</strong> ${route.arrivalTime}</span>
          <span><strong>Stops:</strong> ${route.stops.length}</span>
        </div>
        <div class="stops-timeline schedule-timeline">
          ${route.stops.map((s, idx) => `
            <div class="timeline-item ${idx === route.stops.length - 1 ? 'destination' : ''}" style="--timeline-delay:${idx * 70}ms;">
              <div class="timeline-marker" aria-hidden="true"></div>
              <div class="timeline-stop-content">
                <div class="timeline-name">${s.name}${idx === route.stops.length - 1 ? '<span class="timeline-status">Campus Destination</span>' : ''}</div>
                <div class="timeline-stop-meta">Stop #${idx + 1}</div>
              </div>
              <div class="timeline-time">${s.time}</div>
            </div>
          `).join('')}
        </div>
        ${route.notes ? `<div class="route-notes"><strong>Note:</strong> ${route.notes}</div>` : ''}
      </div>
      <div class="info-card">
        <div class="info-card-title"><i class="lucide-user-check"></i><span>Driver & Vehicle Information</span></div>
        <div class="driver-contact-box">
          <div class="driver-avatar">${(getDisplayDriverName(route) || 'N/A').charAt(0)}</div>
          <div class="driver-info">
            <h4>${getDisplayDriverName(route)}</h4>
            <p>${getDisplayDriverPhone(route)}</p>
          </div>
          ${(route.campusId === 'main' || getDisplayDriverPhone(route) === 'N/A') ? '' : `<a href="tel:${route.driverPhone}" class="btn-call"><i class="lucide-phone-call"></i> Call</a>`}
        </div>
        <div class="route-detail-facts">
          <div><span>Bus Number</span><strong>${getDisplayVehicleNo(route)}</strong></div>
          <div><span>Start Area</span><strong>${route.startPoint || firstStop.name}</strong></div>
          <div><span>Campus Arrival</span><strong>${route.arrivalTime}</strong></div>
        </div>
        <div class="route-detail-actions">
          <button class="btn-secondary" onclick="printRouteSchedule('${route.id}')"><i class="lucide-printer"></i> Print / Download</button>
          <button class="btn-secondary ${isFav ? 'active' : ''}" aria-pressed="${isFav}" onclick="toggleFavorite('${route.id}', this)"><i class="lucide-bookmark"></i> ${isFav ? 'Saved' : 'Save Route'}</button>
        </div>
      </div>
    </div>
  `;
}

// Render Route Schedules as summary cards or one selected route detail.
function renderRoutesPage() {
  const container = document.getElementById('routes-detail-container');
  if (!container) return;

  const listControls = document.getElementById('route-schedule-controls');
  const searchInput = document.getElementById('route-schedule-search');
  if (searchInput) searchInput.value = appState.routeScheduleQuery;
  if (listControls) listControls.hidden = false;

  if (appState.selectedRouteId) {
    const selectedRoute = UET_DATA.routes.find(route => route.id === appState.selectedRouteId);
    if (selectedRoute) {
      if (listControls) listControls.hidden = true;
      container.innerHTML = renderRouteDetailView(selectedRoute);
      refreshLucideIcons();
      return;
    }
    appState.selectedRouteId = null;
  }

  const routeSearchQuery = normalizeStopSearchText(appState.routeScheduleQuery);
  const campusFilteredRoutes = UET_DATA.routes.filter(route =>
    !appState.selectedCampus || route.campusId === appState.selectedCampus
  );
  const displayRoutes = routeSearchQuery
    ? campusFilteredRoutes.filter(route => routeMatchesScheduleSearch(route, routeSearchQuery))
    : campusFilteredRoutes;
  let html = `
    <div class="route-schedules-heading">
      <div>
        <h2>UET Route Schedules (${appState.selectedCampus === 'ksk' ? 'KSK New Campus' : 'Main Campus - 22 Morning Routes'})</h2>
        <p>Based on Official Transport Schedule Data${scheduleMeta.semester ? ` &bull; Schedule: ${scheduleMeta.semester}` : ''}${scheduleMeta.lastVerified ? ` &bull; Route data last verified: ${scheduleMeta.lastVerified}` : ''}</p>
      </div>
    </div>
    <div class="info-card route-campus-filter">
      <div class="campus-toggle-wrapper" style="justify-content:flex-start; margin:0;">
        <button class="route-campus-btn ${appState.selectedCampus === 'main' ? 'active' : ''}" data-campus="main" aria-pressed="${appState.selectedCampus === 'main'}"><i class="lucide-graduation-cap"></i> Main Campus</button>
        <button class="route-campus-btn ${appState.selectedCampus === 'ksk' ? 'active' : ''}" data-campus="ksk" aria-pressed="${appState.selectedCampus === 'ksk'}"><i class="lucide-building-2"></i> KSK Campus</button>
      </div>
    </div>
  `;
  if (displayRoutes.length === 0) {
    html += `<div class="info-card no-result-box"><div class="no-result-icon"><i class="lucide-search-x"></i></div><h3>No matching routes found</h3><p>Try another route number, area, or stop in the selected campus.</p></div>`;
  } else {
    html += `<div class="routes-grid">${displayRoutes.map(renderRouteSummaryCard).join('')}</div>`;
  }
  container.innerHTML = html;
  refreshLucideIcons();
}

// Leaflet Map Initialization Helper
function initLeafletMap(containerId, centerCoords, zoomLevel, points) {
  const container = document.getElementById(containerId);
  if (!container || typeof L === 'undefined') return;

  if (appState.map) {
    appState.map.remove();
    appState.map = null;
  }

  const map = L.map(containerId).setView(centerCoords, zoomLevel);
  appState.map = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  points.forEach(pt => {
    L.marker([pt.lat, pt.lng])
      .addTo(map)
      .bindPopup(pt.popup || pt.title);
  });
}

// Every detail opened from a card has a route-list history entry behind it.
function viewRouteDetail(routeId) {
  const route = UET_DATA.routes.find(item => item.id === routeId);
  if (!route) return;
  if (appState.activePage !== 'routes' || appState.selectedRouteId) {
    navigateToPage('routes', { resetScroll: false });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  appState.routeListState = {
    campus: appState.selectedCampus, query: appState.routeScheduleQuery, scrollY: window.scrollY
  };
  appState.routeListScrollY = window.scrollY;
  navigateToPage('routes', { routeId, resetScroll: false, fromRouteList: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
  saveNavigationEntry(true, true, 0);
}

function returnToRouteList() {
  if (window.history?.state?.uetNavigation && window.history.state.fromRouteList) {
    window.history.back();
    return;
  }
  // Directly loaded detail URLs have no guaranteed in-site Back entry.
  navigateToPage('routes');
}
// Toggle Save / Favorite Route
function toggleFavorite(routeId, btnEl) {
  const idx = appState.favorites.indexOf(routeId);
  const willBeSaved = idx === -1;
  if (willBeSaved) {
    appState.favorites.push(routeId);
  } else {
    appState.favorites.splice(idx, 1);
  }

  localStorage.setItem('uet_fav_routes', JSON.stringify(appState.favorites));
  updateFavoritesBadge();

  const updateBtn = (btn) => {
    btn.classList.toggle('active', willBeSaved);
    btn.setAttribute('aria-pressed', String(willBeSaved));
    btn.setAttribute('aria-label', willBeSaved ? 'Remove from Saved' : 'Save Route');
    btn.setAttribute('title', willBeSaved ? 'Remove from Saved' : 'Save Route');
    if (btn.classList.contains('btn-secondary') || (btn.textContent && (btn.textContent.includes('Save') || btn.textContent.includes('Saved')))) {
      btn.innerHTML = `<i class="lucide-bookmark"></i> ${willBeSaved ? 'Saved' : 'Save Route'}`;
    }
  };

  if (btnEl) updateBtn(btnEl);

  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll(`button[onclick*="toggleFavorite('${routeId}'"]`).forEach(btn => {
      if (btn !== btnEl) updateBtn(btn);
    });
  }

  if (appState.activePage === 'favorites') {
    renderFavoritesPage();
  } else if (appState.activePage === 'home') {
    renderHomePage();
  }
  refreshLucideIcons();
}

let pendingDeleteRouteId = null;

// Open Confirmation Popup to Remove Route from Saved
function promptRemoveFavorite(routeId) {
  pendingDeleteRouteId = routeId;
  const modal = document.getElementById('delete-confirm-modal');
  if (modal) {
    modal.classList.add('active');
    openAccessibleLayer(modal, modal.querySelector('button'));
    refreshLucideIcons();
  }
}

// Close Delete Confirmation Popup
function closeDeleteModal() {
  if (activeAccessibleLayer?.root.id === 'delete-confirm-modal') closeAccessibleLayer();
  pendingDeleteRouteId = null;
  const modal = document.getElementById('delete-confirm-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// Confirm and Execute Deletion from Saved Routes
function executeDeleteFavorite() {
  if (pendingDeleteRouteId) {
    const idx = appState.favorites.indexOf(pendingDeleteRouteId);
    if (idx > -1) {
      appState.favorites.splice(idx, 1);
      localStorage.setItem('uet_fav_routes', JSON.stringify(appState.favorites));
      updateFavoritesBadge();
    }
    pendingDeleteRouteId = null;
  }
  closeDeleteModal();
  renderFavoritesPage();
  renderHomePage();
}

// Favorites Count Badge
function updateFavoritesBadge() {
  const favCount = appState.favorites.length;
  document.querySelectorAll('.fav-badge-count').forEach(el => {
    el.textContent = favCount;
    el.style.display = favCount > 0 ? 'inline-block' : 'none';
  });
}

// Render Saved Favorites View
function renderFavoritesPage() {
  const container = document.getElementById('favorites-content-container');
  if (!container) return;

  const favRoutes = UET_DATA.routes.filter(r => appState.favorites.includes(r.id));

  if (favRoutes.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:4rem 1rem; background:var(--bg-surface); border-radius:var(--radius-lg); border:1px solid var(--border-light);">
        <i class="lucide-bookmark" style="font-size:3rem; color:var(--text-light); margin-bottom:1rem;"></i>
        <h3 style="color:var(--heading-color);">No Saved Routes Yet</h3>
        <p style="color:var(--text-muted); margin-bottom:1.5rem;">Bookmark your daily commuting routes for 1-click access anytime!</p>
        <button class="btn-find-bus" style="margin:0 auto;" onclick="navigateToPage('home')">
          Explore Routes
        </button>
      </div>
    `;
    refreshLucideIcons();
    return;
  }

  let html = `<div class="routes-grid">`;
  favRoutes.forEach(route => {
    html += `
      <div class="route-card">
        <div>
          <div class="route-card-header">
            <span class="route-badge">${formatRouteLabel(route.routeNo)}</span>
            <span class="campus-chip">${route.campusId === 'ksk' ? 'KSK' : 'Main'}</span>
          </div>
          <h3 class="route-card-title">${route.name}</h3>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.75rem;">
            Driver: ${getDisplayDriverName(route)} (${getDisplayDriverPhone(route)})
          </p>
        </div>
        <div class="route-card-actions">
          <button class="btn-card-primary" onclick="viewRouteDetail('${route.id}')">View Route</button>
          <button class="btn-fav active" onclick="promptRemoveFavorite('${route.id}')" aria-label="Delete from Saved" title="Delete from Saved">
            <i class="lucide-trash-2"></i>
          </button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
  refreshLucideIcons();
}

// FAQ Accordion Handler
function renderFaqs() {
  const container = document.getElementById('faq-accordion-container');
  if (!container) return;

  container.innerHTML = UET_DATA.faqs.map((faq, i) => `
    <div class="faq-item">
      <h4 class="faq-heading"><button type="button" class="faq-header" id="faq-control-${i}" aria-controls="faq-body-${i}" aria-expanded="false" onclick="toggleFaq(${i})">
        <span>${faq.q}</span>
        <i class="lucide-chevron-down faq-icon-${i}" aria-hidden="true"></i>
      </button></h4>
      <div class="faq-body" id="faq-body-${i}" role="region" aria-labelledby="faq-control-${i}" hidden>
        ${faq.a}
      </div>
    </div>
  `).join('');
  refreshLucideIcons();
}

function toggleFaq(index) {
  const item = document.querySelectorAll('.faq-item')[index];
  if (item) {
    const expanded = item.classList.toggle('active');
    document.getElementById('faq-control-' + index).setAttribute('aria-expanded', String(expanded));
    document.getElementById('faq-body-' + index).hidden = !expanded;
  }
}

// Google Maps URLs work in desktop browsers and the mobile Maps app.
// Never use a stop name as a Place ID. coordinateStatus is informational only.
function getStopNavigationUrl(stop) {
  if (!stop || !Number.isFinite(stop.lat) || stop.lat < -90 || stop.lat > 90 ||
      !Number.isFinite(stop.lng) || stop.lng < -180 || stop.lng > 180) return null;

  let url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`;
  // Future explicit opt-in after the Google Place ID itself is verified.
  // A verified coordinateStatus alone does not verify an associated Place ID.
  if (stop.placeIdVerified === true && typeof stop.placeId === 'string' && stop.placeId.trim()) {
    url += `&destination_place_id=${encodeURIComponent(stop.placeId.trim())}`;
  }
  return url;
}

function renderStopNavigation(stop) {
  const url = getStopNavigationUrl(stop);
  if (!url) return '<span class="navigation-unavailable" role="status">Navigation location not available</span>';
  return `<a class="btn-accent" href="${url.replace(/&/g, '&amp;')}" target="_blank" rel="noopener noreferrer">
    <i class="lucide-navigation"></i> Directions to Stop
  </a>`;
}
// Route Print / PDF Trigger
function printRouteSchedule(routeId) {
  const route = UET_DATA.routes.find(r => r.id === routeId);
  if (!route) return;

  const modal = document.getElementById('print-modal');
  const body = document.getElementById('print-modal-body');
  
  body.innerHTML = `
    <div id="printable-area" style="padding:1rem;">
      <div style="border-bottom:2px solid var(--border-light); padding-bottom:0.75rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 id="print-dialog-title" tabindex="-1" style="color:var(--heading-color); font-size:1.5rem;">UET Bus Route Info — ${formatRouteLabel(route.routeNo)}</h2>
          <p style="color:var(--text-muted); font-size:0.85rem;">Based on Official Transport Schedule Data — ${route.name}</p>
        </div>
        <span class="route-badge" style="font-size:1.1rem; padding:0.5rem 1rem;">${route.campusId === 'ksk' ? 'KSK CAMPUS' : 'MAIN CAMPUS'}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; font-size:0.9rem; background:var(--bg-surface-subtle); padding:0.85rem; border-radius:8px; border:1px solid var(--border-light);">
        <div><strong>Driver:</strong> ${getDisplayDriverName(route)}</div>
        <div><strong>Contact:</strong> ${getDisplayDriverPhone(route)}</div>
        <div><strong>Vehicle No:</strong> ${getDisplayVehicleNo(route)}</div>
        <div><strong>Morning Arrival:</strong> ${route.arrivalTime}</div>
      </div>

      <div class="data-table-wrapper" style="margin-bottom:1.5rem;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Stop #</th>
              <th>Pickup Location</th>
              <th>Scheduled Pickup Time</th>
            </tr>
          </thead>
          <tbody>
            ${route.stops.map((s, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td>${s.name}</td>
                <td><strong>${s.time}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="font-size:0.75rem; color:var(--text-muted); text-align:center; border-top:1px dashed var(--border-light); padding-top:0.75rem;">
        Prepared using UET Bus Route Info for the UET community.<br>Source: Official Transport Routes<br>Transport contact: Chairman Transport Committee UET — Mr. M. Mushtaq 0304-0165776
      </div>
    </div>

    <div style="margin-top:1.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
      <button class="btn-find-bus" onclick="window.print()"><i class="lucide-printer"></i> Print / Save as PDF</button>
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  modal.classList.add('active');
  openAccessibleLayer(modal, document.getElementById('print-dialog-title'));
  refreshLucideIcons();
}

function closeModal() {
  closeAccessibleLayer();
  pendingDeleteRouteId = null;
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

// Hash URLs keep direct links compatible with static GitHub Pages hosting.
function parseNavigationHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const parts = raw.split('/');
  if (parts[0] === 'routes' || parts[0] === 'stops') {
    let routeId = null;
    try {
      if (parts.length === 2) routeId = decodeURIComponent(parts[1]);
    } catch (_) { /* Malformed URL safely becomes the route list. */ }
    const route = UET_DATA.routes.find(item => item.id === routeId);
    return { page: 'routes', routeId: route?.id || null,
      hash: route ? `#routes/${encodeURIComponent(route.id)}` : '#routes' };
  }
  const page = ['home','result','favorites','notices','contact'].includes(raw) ? raw : 'home';
  return {page, routeId:null, hash:`#${page}`};
}

function saveNavigationEntry(replace = false, fromRouteList, scrollY = window.scrollY || 0) {
  if (!window.history || !window.location) return;
  const hash = appState.activePage === 'routes' && appState.selectedRouteId
    ? `#routes/${encodeURIComponent(appState.selectedRouteId)}` : `#${appState.activePage}`;
  const sameEntry = window.location.hash === hash;
  const state = {
    uetNavigation: true, hash, campus: appState.selectedCampus,
    query: appState.routeScheduleQuery, scrollY,
    routeListState: appState.routeListState,
    fromRouteList: fromRouteList ?? (sameEntry && window.history.state?.fromRouteList) ?? false
  };
  window.history[replace || sameEntry ? 'replaceState' : 'pushState'](state, '', hash);
}

function handleUrlRouting() {
  const target = parseNavigationHash(window.location.hash);
  const saved = window.history.state?.hash === target.hash ? window.history.state : null;
  const route = UET_DATA.routes.find(item => item.id === target.routeId);
  const campus = route?.campusId || saved?.campus || appState.selectedCampus;
  appState.selectedRouteId = null;
  appState.routeScheduleQuery = saved?.query || '';
  setSelectedCampus(campus, { updateHistory: false });
  appState.routeListState = saved?.routeListState || null;
  appState.routeListScrollY = saved?.scrollY || 0;
  navigateToPage(target.page, { routeId: target.routeId, updateHistory: false, resetScroll: false });
  window.history.scrollRestoration = 'manual';
  saveNavigationEntry(true, saved?.fromRouteList || false, saved?.scrollY || 0);
  setTimeout(() => window.scrollTo({top:saved?.scrollY || 0, behavior:'instant'}), 0);
}

window.addEventListener?.('popstate', handleUrlRouting);
window.addEventListener?.('hashchange', handleUrlRouting);