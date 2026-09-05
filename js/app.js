// UET Bus Route Info - Main Application Logic

let appState = {
  selectedCampus: 'ksk', // 'ksk' or 'main'
  currentLocation: null, // { lat, lng, name, formattedAddress, placeId, source }
  selectedPlace: null,
  recommendationResults: null, // { status: 'within_500m' | 'nearest' | 'none', matchingRoutes, allNearby, userLat, userLng, locationLabel, targetCampus }
  activeRecommendationIndex: 0,
  locationSearchError: null,
  activePage: 'home',
  routeScheduleQuery: '',
  favorites: JSON.parse(localStorage.getItem('uet_fav_routes') || '[]'),
  selectedRouteId: null,
  routeListScrollY: 0,
  map: null,
  markers: []
};

function getGoogleMapsApiKey() {
  return (window.UET_CONFIG && window.UET_CONFIG.googleMapsApiKey) || '';
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

// Legacy stubs so any leftover calls don't break
function showLoadingScreen() { SearchLoader.show(); }
function hideLoadingScreen() { SearchLoader.hide(); }

// Force refresh Lucide SVG icons in dynamic containers
function refreshLucideIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    const iconEls = document.querySelectorAll('i[class*="lucide-"]');
    iconEls.forEach(icon => {
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
  loadGoogleMapsApi();
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

/**
 * Shared coordinate-based UET pickup recommendation algorithm.
 * 
 * Workflow:
 * 1. User selects campus (Main or KSK).
 * 2. Filter the route database to ONLY that selected campus (First Filter).
 * 3. Calculate distance from user's GPS coordinates to every stop in those filtered routes.
 * 4. Keep every qualifying stop as an independent pickup candidate.
 * 5. If multiple stops are within 500 meters (0.5 km) for that campus, return all matching stops sorted by distance.
 * 6. If no stops are within 500m, but stops exist within 5 km, recommend the nearest stop from that campus.
 * 7. If no stop found within 5 km for that campus, returns status: 'none' -> "No nearby UET bus stop found."
 */
function findNearbyRoutes(userLat, userLng, campusFilter) {
  const MAX_RADIUS_KM = 5.0;       // 5 km max radius
  const NEARBY_THRESHOLD_KM = 0.5;   // 500 meters threshold
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
      if (dist <= MAX_RADIUS_KM) {
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

  if (stopCandidates.length === 0) {
    return {
      status: 'none',
      targetCampus: targetCampus,
      matchingRoutes: [],
      allNearby: []
    };
  }

  // Filter stops within 500 meters; multiple stops from one route remain visible.
  const within500m = stopCandidates.filter(item => item.distanceKm <= NEARBY_THRESHOLD_KM);

  if (within500m.length > 0) {
    return {
      status: 'within_500m',
      targetCampus: targetCampus,
      matchingRoutes: within500m,
      allNearby: stopCandidates
    };
  }

  // Fallback: nearest individual stop within 5 km from the selected campus.
  return {
    status: 'nearest',
    targetCampus: targetCampus,
    matchingRoutes: [stopCandidates[0]],
    allNearby: stopCandidates
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
    appState.selectedPlace = source === 'google' ? { ...location } : null;
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
  appState.selectedPlace = null;
  appState.locationSearchError = message;
  appState.recommendationResults = null;
  renderResultPage();
  navigateToPage('result');
}

function loadGoogleMapsApi() {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return;
  }

  if (window.google && window.google.maps && window.google.maps.places) {
    initGoogleLocationSearch();
    return;
  }

  if (document.querySelector('script[data-google-maps="uet"]')) {
    return;
  }

  window.__uetGoogleMapsReady = function () {
    initGoogleLocationSearch();
  };

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=window.__uetGoogleMapsReady`;
  script.async = true;
  script.defer = true;
  script.setAttribute('data-google-maps', 'uet');
  document.head.appendChild(script);
}

function initGoogleLocationSearch() {
  const input = document.getElementById('main-location-input');
  if (!input || !window.google || !window.google.maps || !window.google.maps.places) {
    return;
  }

  if (input.dataset.googleAutocompleteBound === 'true') {
    return;
  }

  const autocomplete = new window.google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'pk' },
    fields: ['place_id', 'name', 'formatted_address', 'geometry']
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    const loc = place && place.geometry && place.geometry.location;
    if (!loc || typeof loc.lat !== 'function' || typeof loc.lng !== 'function') {
      showLocationSearchError('Place details are unavailable. Please select a location from the suggestions or use "Detect My Area".');
      return;
    }

    const lat = loc.lat();
    const lng = loc.lng();
    const selectedPlace = {
      name: place.name || input.value.trim(),
      formattedAddress: place.formatted_address || input.value.trim(),
      lat,
      lng,
      placeId: place.place_id || null
    };
    if (!hasValidSelectedPlace(selectedPlace)) {
      showLocationSearchError('Place details are unavailable. Please select a location from the suggestions or use "Detect My Area".');
      return;
    }
    appState.selectedPlace = selectedPlace;
    input.value = selectedPlace.formattedAddress;
    handleLocationSearch();
  });

  input.dataset.googleAutocompleteBound = 'true';
}

function getDisplayDriverPhone(route) {
  return route && route.campusId === 'main' ? 'N/A' : (route?.driverPhone || 'N/A');
}

function getDisplayVehicleNo(route) {
  return route && route.campusId === 'main' ? 'N/A' : (route?.vehicleNo || 'N/A');
}

function setSelectedCampus(campusId) {
  appState.selectedCampus = campusId;

  document.querySelectorAll('.campus-btn, .route-campus-btn, .result-campus-btn').forEach(btn => {
    const isActive = btn.dataset.campus === campusId;
    btn.classList.toggle('active', isActive);
  });

  renderHomePage();
  renderRoutesPage();

  // If on result page with an active location, re-run recommendation with new campus filter
  if (appState.currentLocation && appState.activePage === 'result') {
    const location = appState.currentLocation;
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
function navigateToPage(pageId) {
  appState.activePage = pageId;
  document.querySelectorAll('.page-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const targetSec = document.getElementById(`page-${pageId}`);
  if (targetSec) {
    targetSec.classList.add('active');
  }

  // Update nav links
  document.querySelectorAll('.nav-btn, .mobile-nav-item, .mobile-menu-item').forEach(btn => {
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// UI Event Handlers Setup
function closeMobileMenu() {
  const drawer = document.getElementById('mobile-menu-drawer');
  const overlay = document.getElementById('mobile-menu-overlay');
  const toggle = document.querySelector('.nav-toggle');

  if (drawer) {
    drawer.classList.remove('open');
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileMenu();
    }
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

  // Location Search Box Input
  const mainSearchInput = document.getElementById('main-location-input');
  if (mainSearchInput) {
    mainSearchInput.addEventListener('input', () => {
      appState.selectedPlace = null;
    });
    mainSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLocationSearch();
      }
    });
  }

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

  // Header route stop search form
  const headerSearchForm = document.getElementById('header-stop-search-form');
  if (headerSearchForm) {
    headerSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleHeaderStopSearch();
    });
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
    showLocationSearchError('Geolocation is not supported by your browser. Please select a Google place.');
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
        ? 'Location permission was denied. Please allow access or select a Google place.'
        : err.code === 3
          ? 'Location detection timed out. Please try again or select a Google place.'
          : 'Your location is unavailable. Please try again or select a Google place.';
      SearchLoader.hide();
      showLocationSearchError(message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}
function normalizeStopSearchText(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findExactStopMatches(query, preferredCampusId = null) {
  const normalizedQuery = normalizeStopSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const preferredMatches = preferredCampusId
    ? UET_DATA.routes.filter(route => route.campusId === preferredCampusId && route.stops.some(stop => normalizeStopSearchText(stop.name) === normalizedQuery))
    : [];

  if (preferredMatches.length > 0) {
    return preferredMatches;
  }

  return UET_DATA.routes.filter(route =>
    route.stops.some(stop => normalizeStopSearchText(stop.name) === normalizedQuery)
  );
}

function handleHeaderStopSearch() {
  const headerInput = document.getElementById('header-stop-search');
  const rawQuery = headerInput ? headerInput.value : '';
  const normalizedQuery = normalizeStopSearchText(rawQuery);

  if (!normalizedQuery) {
    return;
  }

  appState.routeScheduleQuery = rawQuery;
  const matchingRoutes = findExactStopMatches(rawQuery, appState.selectedCampus);

  if (matchingRoutes.length > 0) {
    appState.selectedCampus = matchingRoutes[0].campusId;
  }

  navigateToPage('routes');

  const routeSearchInput = document.getElementById('route-schedule-search');
  if (routeSearchInput) {
    routeSearchInput.value = rawQuery;
    routeSearchInput.focus();
  }

  renderRoutesPage();

  setTimeout(() => {
    const highlightedMatch = document.querySelector('.route-search-match');
    if (highlightedMatch) {
      highlightedMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

// Validate Places data before entering the shared route-search workflow.
function hasValidSelectedPlace(place) {
  return !!place &&
    Number.isFinite(place.lat) && place.lat >= -90 && place.lat <= 90 &&
    Number.isFinite(place.lng) && place.lng >= -180 && place.lng <= 180 &&
    typeof place.formattedAddress === 'string' && place.formattedAddress.trim().length > 0;
}
// Location Text Search Handler - only a selected Google place may provide coordinates.
function handleLocationSearch() {
  const input = document.getElementById('main-location-input');
  const selectedPlace = appState.selectedPlace;
  if (!hasValidSelectedPlace(selectedPlace) || !input || input.value.trim() !== selectedPlace.formattedAddress) {
    showLocationSearchError('Please select a location from the suggestions.');
    return;
  }

  runNearbyRouteSearch(selectedPlace.lat, selectedPlace.lng, selectedPlace, 'google');
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

// Render Home Page
function renderHomePage() {
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
            <span class="route-badge">${route.routeNo}</span>
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
              <span>${route.driverName}</span>
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
          <button class="btn-fav ${isFav ? 'active' : ''}" onclick="toggleFavorite('${route.id}', this)" title="${isFav ? 'Remove from Saved' : 'Save Route'}">
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
          <button class="route-campus-btn ${appState.selectedCampus === 'ksk' ? 'active' : ''}" data-campus="ksk" onclick="setSelectedCampus('ksk')" style="padding:0.45rem 1.1rem; font-size:0.85rem;">
            <i class="lucide-building-2"></i> KSK Campus
          </button>
          <button class="route-campus-btn ${appState.selectedCampus === 'main' ? 'active' : ''}" data-campus="main" onclick="setSelectedCampus('main')" style="padding:0.45rem 1.1rem; font-size:0.85rem;">
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
        <h3>No nearby UET bus stop found.</h3>
        <p>No official UET bus stop was found within 5 km of your location for <strong>${currentCampusName}</strong>.</p>
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
  const formattedDist = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} meters` : `${distanceKm.toFixed(2)} km`;
  const estimatedWalk = Math.max(1, Math.round(distanceKm * 12));
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
          Pickup stops within 500 meters of your location, sorted from nearest to farthest:
        </p>
        <div style="display:flex; flex-direction:column; gap:0.6rem;">
          ${rec.matchingRoutes.map((item, i) => {
            const isSelected = i === activeIdx;
            const distStr = item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)}m` : `${item.distanceKm.toFixed(2)} km`;
            return `
              <div onclick="selectActiveRecommendation(${i})" style="cursor:pointer; background:${isSelected ? 'var(--bg-surface-highlight)' : 'var(--bg-surface-subtle)'}; border:2px solid ${isSelected ? 'var(--primary-light)' : 'var(--border-light)'}; border-radius:var(--radius-md); padding:0.85rem 1rem; display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; transition:var(--transition-fast);">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                  <div>
                    <div style="font-weight:700; color:var(--heading-color); font-size:0.95rem;">${item.stop.name}</div>
                    <div style="font-size:0.82rem; color:var(--text-muted);">
                      Route ${item.route.routeNo} &bull; ${item.route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}
                    </div>
                  </div>
                  <div>
                    <div style="font-size:0.82rem; color:var(--text-muted);">
                      Pickup time: <strong>${item.stop.time}</strong>
                    </div>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <span class="distance-badge"><i class="lucide-map-pin"></i> ${distStr} away</span>
                  <span style="font-size:0.8rem; font-weight:600; color:${isSelected ? 'var(--primary-light)' : 'var(--text-muted)'};">${isSelected ? '✓ Recommended' : 'Select'}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Other nearby pickup points within 5 km for this campus.
  const otherNearby = rec.allNearby
    .filter(item => !rec.matchingRoutes.some(m => m.route.id === item.route.id && m.stopIndex === item.stopIndex))
    .slice(0, 4);
  let otherNearbyHtml = '';
  if (otherNearby.length > 0) {
    otherNearbyHtml = `
      <div class="info-card" style="margin-top:1.25rem;">
        <div class="info-card-title">
          <i class="lucide-compass" style="color:var(--primary-light)"></i>
          <span>Other Nearby ${campusLabel} Routes (Within 5 km)</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.6rem;">
          ${otherNearby.map((item) => {
            const distStr = item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)}m` : `${item.distanceKm.toFixed(2)} km`;
            return `
              <div style="background:var(--bg-surface-subtle); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <div>
                  <span class="route-badge" style="font-size:0.78rem; padding:0.2rem 0.5rem;">${item.route.routeNo}</span>
                  <strong style="margin-left:0.4rem; color:var(--heading-color); font-size:0.9rem;">${item.stop.name}</strong>
                  <span style="font-size:0.8rem; color:var(--text-muted); margin-left:0.4rem;">(${item.stop.time})</span>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <span class="distance-badge"><i class="lucide-map-pin"></i> ${distStr}</span>
                  <button class="btn-card-primary" style="padding:0.3rem 0.6rem; font-size:0.78rem;" onclick="viewRouteDetail('${item.route.id}')">
                    View
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Map markers for Leaflet
  const mapPoints = [
    { lat: userLat, lng: userLng, title: 'Your GPS Location', popup: `<b>Your GPS Location</b><br>${userLocationLabel}` },
    { lat: stop.lat, lng: stop.lng, title: `Pickup: ${stop.name}`, popup: `<b>${route.routeNo} - ${stop.name}</b><br>Pickup Time: ${stop.time}<br>Distance: ${formattedDist}` },
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
            <span class="route-badge" style="font-size:0.95rem;">${route.routeNo}</span>
            <span class="distance-badge"><i class="lucide-map-pin"></i> ${formattedDist} away</span>
            <span style="font-size:0.85rem; color:var(--text-muted);"><i class="lucide-footprints"></i> ~${estimatedWalk} mins walk</span>
            <span style="font-size:0.85rem; color:var(--text-muted);"><i class="lucide-clock"></i> Pickup Time: <strong>${stop.time}</strong></span>
            <span class="campus-chip">${campusLabel}</span>
          </div>
        </div>
        <div>
          <button class="btn-accent" onclick="openGoogleMapsDirections(${stop.lat}, ${stop.lng}, '${encodeURIComponent(stop.name)}')">
            <i class="lucide-navigation"></i> Directions to Stop
          </button>
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
            <span class="route-badge" style="margin-left:auto;">${route.routeNo}</span>
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

        ${otherNearbyHtml}
      </div>

      <div>
        <div class="info-card">
          <div class="info-card-title">
            <i class="lucide-user-check" style="color:var(--primary-light)"></i>
            <span>Driver & Vehicle Information</span>
          </div>
          <div class="driver-contact-box" style="margin-bottom:1rem;">
            <div class="driver-avatar">${route.driverName.charAt(0)}</div>
            <div class="driver-info">
              <h4>${route.driverName}</h4>
              <p style="font-size:0.82rem; color:var(--text-muted);">UET Bus Driver</p>
              <p style="font-size:0.85rem; font-weight:600; margin-top:0.2rem;">${getDisplayDriverPhone(route)}</p>
            </div>
            <a href="${route.campusId === 'main' ? 'javascript:void(0)' : `tel:${route.driverPhone}`}" class="btn-call" title="${route.campusId === 'main' ? 'Driver phone unavailable' : 'Call Driver'}" ${route.campusId === 'main' ? 'onclick="return false;"' : ''}>
              <i class="lucide-phone-call"></i> ${route.campusId === 'main' ? 'N/A' : 'Call'}
            </a>
          </div>

          <div style="background:var(--bg-surface-subtle); padding:0.85rem; border-radius:var(--radius-md); font-size:0.85rem; margin-bottom:1rem; border:1px solid var(--border-light);">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-muted);">Pickup Stop:</span>
              <strong>${stop.name} (${stop.time})</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-muted);">Distance from GPS:</span>
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
            <button class="btn-secondary ${isFav ? 'active' : ''}" style="width:100%; justify-content:center;" onclick="toggleFavorite('${route.id}', this)">
              <i class="lucide-bookmark"></i> ${isFav ? 'Remove from Saved' : 'Save to Favorites'}
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
  const driverPhone = route.campusId === 'main' ? 'N/A' : route.driverPhone;
  return `
    <article class="route-card" id="route-card-${route.id}">
      <div>
        <div class="route-card-header">
          <span class="route-badge">Route ${route.routeNo}</span>
          <span class="campus-chip">${route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}</span>
        </div>
        <h3 class="route-card-title">${route.name}</h3>
        <p class="route-card-stops">Starts at ${route.startPoint || firstStop.name}</p>
        <div class="route-meta-grid">
          <div class="meta-item"><i class="lucide-user"></i><span>${route.driverName}</span></div>
          <div class="meta-item"><i class="lucide-phone"></i><span>${driverPhone}</span></div>
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
        <h2>Route ${route.routeNo} - Full Details</h2>
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
          <div class="driver-avatar">${route.driverName.charAt(0)}</div>
          <div class="driver-info">
            <h4>${route.driverName}</h4>
            <p>${route.campusId === 'main' ? 'Contact unavailable' : route.driverPhone}</p>
          </div>
          ${route.campusId === 'main' ? '' : `<a href="tel:${route.driverPhone}" class="btn-call"><i class="lucide-phone-call"></i> Call</a>`}
        </div>
        <div class="route-detail-facts">
          <div><span>Bus Number</span><strong>${getDisplayVehicleNo(route)}</strong></div>
          <div><span>Start Area</span><strong>${route.startPoint || firstStop.name}</strong></div>
          <div><span>Campus Arrival</span><strong>${route.arrivalTime}</strong></div>
        </div>
        <div class="route-detail-actions">
          <button class="btn-secondary" onclick="printRouteSchedule('${route.id}')"><i class="lucide-printer"></i> Print / Download</button>
          <button class="btn-secondary ${isFav ? 'active' : ''}" onclick="toggleFavorite('${route.id}', this)"><i class="lucide-bookmark"></i> ${isFav ? 'Saved' : 'Save Route'}</button>
        </div>
      </div>
    </div>
  `;
}

// Render Route Schedules as summary cards or one selected route detail.
function renderRoutesPage() {
  const container = document.getElementById('routes-detail-container');
  if (!container) return;

  if (appState.selectedRouteId) {
    const selectedRoute = UET_DATA.routes.find(route => route.id === appState.selectedRouteId);
    if (selectedRoute) {
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
    ? campusFilteredRoutes.filter(route =>
      route.stops.some(stop => normalizeStopSearchText(stop.name).includes(routeSearchQuery))
    )
    : campusFilteredRoutes;
  let html = `
    <div class="route-schedules-heading">
      <div>
        <h2>Official UET Bus Routes (${appState.selectedCampus === 'ksk' ? 'KSK New Campus' : 'Main Campus - 22 Morning Routes'})</h2>
        <p>Morning Arrival Schedules extracted from official Transport Office PDF</p>
      </div>
    </div>
    <div class="info-card route-campus-filter">
      <div class="campus-toggle-wrapper" style="justify-content:flex-start; margin:0;">
        <button class="route-campus-btn ${appState.selectedCampus === 'main' ? 'active' : ''}" data-campus="main"><i class="lucide-graduation-cap"></i> Main Campus</button>
        <button class="route-campus-btn ${appState.selectedCampus === 'ksk' ? 'active' : ''}" data-campus="ksk"><i class="lucide-building-2"></i> KSK Campus</button>
      </div>
    </div>
  `;
  if (displayRoutes.length === 0) {
    html += `<div class="info-card no-result-box"><div class="no-result-icon"><i class="lucide-search-x"></i></div><h3>No result found</h3><p>No bus stop matching your search was found.</p></div>`;
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

// View one route without rendering the other route details.
function viewRouteDetail(routeId) {
  const route = UET_DATA.routes.find(r => r.id === routeId);
  if (!route) return;

  appState.routeListScrollY = window.scrollY;
  appState.selectedRouteId = routeId;
  navigateToPage('routes');
  renderRoutesPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function returnToRouteList() {
  appState.selectedRouteId = null;
  renderRoutesPage();
  navigateToPage('routes');
  setTimeout(() => window.scrollTo({ top: appState.routeListScrollY, behavior: 'smooth' }), 0);
}

// Toggle Save / Favorite Route
function toggleFavorite(routeId, btnEl) {
  const idx = appState.favorites.indexOf(routeId);
  if (idx > -1) {
    appState.favorites.splice(idx, 1);
  } else {
    appState.favorites.push(routeId);
  }

  localStorage.setItem('uet_fav_routes', JSON.stringify(appState.favorites));
  updateFavoritesBadge();

  if (btnEl) {
    btnEl.classList.toggle('active');
  }

  renderHomePage();
  refreshLucideIcons();
}

let pendingDeleteRouteId = null;

// Open Confirmation Popup to Remove Route from Saved
function promptRemoveFavorite(routeId) {
  pendingDeleteRouteId = routeId;
  const modal = document.getElementById('delete-confirm-modal');
  if (modal) {
    modal.classList.add('active');
    refreshLucideIcons();
  }
}

// Close Delete Confirmation Popup
function closeDeleteModal() {
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
            <span class="route-badge">${route.routeNo}</span>
            <span class="campus-chip">${route.campusId === 'ksk' ? 'KSK' : 'Main'}</span>
          </div>
          <h3 class="route-card-title">${route.name}</h3>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.75rem;">
            Driver: ${route.driverName} (${route.campusId === 'main' ? 'N/A' : route.driverPhone})
          </p>
        </div>
        <div class="route-card-actions">
          <button class="btn-card-primary" onclick="viewRouteDetail('${route.id}')">View Route</button>
          <button class="btn-fav active" onclick="promptRemoveFavorite('${route.id}')" title="Delete from Saved">
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
      <div class="faq-header" onclick="toggleFaq(${i})">
        <span>${faq.q}</span>
        <i class="lucide-chevron-down faq-icon-${i}"></i>
      </div>
      <div class="faq-body" id="faq-body-${i}">
        ${faq.a}
      </div>
    </div>
  `).join('');
  refreshLucideIcons();
}

function toggleFaq(index) {
  const item = document.querySelectorAll('.faq-item')[index];
  if (item) {
    item.classList.toggle('active');
  }
}

// Google Maps Navigation Trigger
function openGoogleMapsDirections(lat, lng, label) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${label}`;
  window.open(url, '_blank');
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
          <h2 style="color:var(--heading-color); font-size:1.5rem;">UET BUS ${route.routeNo.toUpperCase()}</h2>
          <p style="color:var(--text-muted); font-size:0.85rem;">Official Transport Morning Schedule - ${route.name}</p>
        </div>
        <span class="route-badge" style="font-size:1.1rem; padding:0.5rem 1rem;">${route.campusId === 'ksk' ? 'KSK CAMPUS' : 'MAIN CAMPUS'}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; font-size:0.9rem; background:var(--bg-surface-subtle); padding:0.85rem; border-radius:8px; border:1px solid var(--border-light);">
        <div><strong>Driver:</strong> ${route.driverName}</div>
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
        Issued by Chairman Transport Committee UET | Contact: Mr. M. Mushtaq 0304-0165776
      </div>
    </div>

    <div style="margin-top:1.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
      <button class="btn-find-bus" onclick="window.print()"><i class="lucide-printer"></i> Print / Save as PDF</button>
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  modal.classList.add('active');
  refreshLucideIcons();
}

function closeModal() {
  pendingDeleteRouteId = null;
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

// Route URL Hashes
function handleUrlRouting() {
  const hash = window.location.hash.replace('#', '');
  const normalizedHash = hash === 'stops' ? 'routes' : hash;
  if (normalizedHash && ['home', 'result', 'routes', 'favorites', 'notices', 'contact'].includes(normalizedHash)) {
    if (normalizedHash === 'favorites') renderFavoritesPage();
    navigateToPage(normalizedHash);
  }
}
