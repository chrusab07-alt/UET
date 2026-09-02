// UET Bus Route Info - Main Application Logic

let appState = {
  selectedCampus: 'ksk', // 'ksk' or 'main'
  currentLocation: null, // { lat, lng, name }
  nearestResult: null,
  nearbyRouteResults: [],
  locationSearchError: null,
  activePage: 'home',
  searchQuery: '',
  routeScheduleQuery: '',
  favorites: JSON.parse(localStorage.getItem('uet_fav_routes') || '[]'),
  selectedRouteId: null,
  map: null,
  markers: []
};

function getGoogleMapsApiKey() {
  return (window.UET_CONFIG && window.UET_CONFIG.googleMapsApiKey) || '';
}

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initUIEvents();
  loadGoogleMapsApi();
  renderHomePage();
  renderRoutesPage();
  renderFaqs();
  updateFavoritesBadge();
  handleUrlRouting();
});

// Calculate Haversine Distance (in kilometers)
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
    types: ['geocode'],
    componentRestrictions: { country: 'pk' }
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    const loc = place && place.geometry && place.geometry.location;
    if (!loc) {
      appState.locationSearchError = 'Location not found. Please enter a valid address or area.';
      appState.nearbyRouteResults = [];
      renderResultPage();
      navigateToPage('result');
      return;
    }

    const lat = loc.lat();
    const lng = loc.lng();
    const label = place.formatted_address || input.value.trim();
    showNearbyBusRoutes(lat, lng, label);
  });

  input.dataset.googleAutocompleteBound = 'true';
}

async function geocodeLocationQuery(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    return null;
  }

  const apiKey = getGoogleMapsApiKey();
  if (apiKey) {
    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${apiKey}`);
      const data = await response.json();
      const result = data && data.results && data.results[0];
      if (data.status === 'OK' && result && result.geometry && result.geometry.location) {
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formattedAddress: result.formatted_address || trimmed
        };
      }
    } catch (error) {
      console.warn('Google Geocoding lookup failed:', error);
    }
  }

  const normalizedQuery = normalizeText(trimmed).toLowerCase();
  const ignoredWords = new Set(['a', 'an', 'the', 'is', 'this', 'that', 'for', 'in', 'on', 'at', 'near', 'of', 'my', 'your', 'city', 'area', 'place', 'lahore', 'lhr', 'pakistan']);
  const queryWords = (trimmed.toLowerCase().match(/[a-z0-9]+/g) || [])
    .map(w => normalizeText(w))
    .filter(w => w.length > 2 && !ignoredWords.has(w));

  const fallbackMatch = LAHORE_AREAS.find(area => {
    const normalizedArea = normalizeText(area.name).toLowerCase();
    if (normalizedArea.includes(normalizedQuery) || normalizedQuery.includes(normalizedArea)) {
      return true;
    }

    const areaWords = (area.name.toLowerCase().match(/[a-z0-9]+/g) || []).map(w => normalizeText(w));
    if (!areaWords.length || !queryWords.length) {
      return false;
    }

    const overlap = queryWords.filter(word => areaWords.includes(word) || normalizedArea.includes(word)).length;
    return overlap >= Math.min(2, Math.max(1, queryWords.length - 1));
  });

  if (!fallbackMatch) {
    return null;
  }

  return {
    lat: fallbackMatch.lat,
    lng: fallbackMatch.lng,
    formattedAddress: fallbackMatch.name
  };
}

function buildNearbyRouteResults(userLat, userLng, radiusKm = 3, campusFilter = null) {
  const candidateRoutes = campusFilter
    ? UET_DATA.routes.filter(route => route.campusId === campusFilter)
    : UET_DATA.routes;

  const routeMap = new Map();

  candidateRoutes.forEach(route => {
    let bestNearbyStop = null;
    let bestDistanceKm = Infinity;

    route.stops.forEach(stop => {
      const distanceKm = calculateDistance(userLat, userLng, stop.lat, stop.lng);
      if (distanceKm <= radiusKm && distanceKm < bestDistanceKm) {
        bestNearbyStop = stop;
        bestDistanceKm = distanceKm;
      }
    });

    if (bestNearbyStop) {
      routeMap.set(route.id, {
        route,
        stop: bestNearbyStop,
        distanceKm: bestDistanceKm
      });
    }
  });

  return Array.from(routeMap.values())
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function buildNearbyStopSuggestions(userLat, userLng, maxDistanceKm = 1.5, campusFilter = null) {
  const candidateRoutes = campusFilter
    ? UET_DATA.routes.filter(route => route.campusId === campusFilter)
    : UET_DATA.routes;

  const stopMap = new Map();

  candidateRoutes.forEach(route => {
    route.stops.forEach(stop => {
      const distanceKm = calculateDistance(userLat, userLng, stop.lat, stop.lng);
      if (distanceKm <= maxDistanceKm) {
        const key = `${route.id}:${stop.name}`;
        if (!stopMap.has(key)) {
          stopMap.set(key, {
            route,
            stop,
            distanceKm
          });
        }
      }
    });
  });

  return Array.from(stopMap.values())
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function showNearbyBusRoutes(lat, lng, locationLabel, radiusKm = 3) {
  const nearbyRoutes = buildNearbyRouteResults(lat, lng, radiusKm, appState.selectedCampus);
  appState.nearbyRouteResults = nearbyRoutes;
  appState.locationSearchError = null;
  appState.nearestResult = null;

  if (nearbyRoutes.length === 0) {
    appState.nearbyRouteResults = [];
    renderResultPage();
    navigateToPage('result');
    return;
  }

  appState.currentLocation = {
    lat,
    lng,
    name: locationLabel
  };

  renderResultPage();
  navigateToPage('result');
}

function getDisplayDriverPhone(route) {
  return route && route.campusId === 'main' ? 'N/A' : (route?.driverPhone || 'N/A');
}

function getDisplayVehicleNo(route) {
  return route && route.campusId === 'main' ? 'N/A' : (route?.vehicleNo || 'N/A');
}

function getNearestStopCandidate(routes, userLat, userLng) {
  let minDistance = Infinity;
  let bestMatch = null;

  routes.forEach(route => {
    route.stops.forEach((stop, index) => {
      if (index === route.stops.length - 1) return;

      const dist = calculateDistance(userLat, userLng, stop.lat, stop.lng);
      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = {
          route: route,
          stop: stop,
          stopIndex: index,
          distanceKm: dist
        };
      }
    });
  });

  return bestMatch;
}

// Find Nearest Stop across selected campus routes (or all routes)
function findNearestStop(userLat, userLng, targetCampusId = null) {
  const candidateRoutes = UET_DATA.routes.filter(r => 
    !targetCampusId || targetCampusId === 'all' || r.campusId === targetCampusId
  );

  const campusBestMatch = getNearestStopCandidate(candidateRoutes, userLat, userLng);

  if (!targetCampusId || targetCampusId === 'all' || !campusBestMatch) {
    return campusBestMatch;
  }

  if (campusBestMatch.distanceKm <= 7) {
    return campusBestMatch;
  }

  const fallbackBestMatch = getNearestStopCandidate(UET_DATA.routes, userLat, userLng);
  return fallbackBestMatch && fallbackBestMatch.distanceKm < campusBestMatch.distanceKm ? fallbackBestMatch : campusBestMatch;
}

function setSelectedCampus(campusId) {
  appState.selectedCampus = campusId;

  document.querySelectorAll('.campus-btn, .route-campus-btn').forEach(btn => {
    const isActive = btn.dataset.campus === campusId;
    btn.classList.toggle('active', isActive);
  });

  renderHomePage();
  renderRoutesPage();
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
  document.querySelectorAll('.nav-btn, .mobile-nav-item').forEach(btn => {
    if (btn.dataset.page === pageId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// UI Event Handlers Setup
function initUIEvents() {
  // Navigation button clicks
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const page = btn.dataset.page;
      navigateToPage(page);
      const navLinks = document.querySelector('.nav-links');
      if (navLinks && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
      }
    });
  });

  const navToggle = document.querySelector('.nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const navLinks = document.querySelector('.nav-links');
      if (!navLinks) return;
      const isOpen = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // Campus Toggle Buttons
  document.querySelectorAll('.campus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setSelectedCampus(btn.dataset.campus);
    });
  });

  document.addEventListener('click', (e) => {
    const campusBtn = e.target.closest('.route-campus-btn');
    if (!campusBtn) return;
    setSelectedCampus(campusBtn.dataset.campus);
  });

  // Location Search Box Input
  const mainSearchInput = document.getElementById('main-location-input');
  if (mainSearchInput) {
    mainSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLocationSearch();
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

// Geolocation Handler
function detectUserGeolocation() {
  const btnLocate = document.getElementById('btn-locate-me');
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser. Please select or search your area manually.");
    return;
  }

  btnLocate.innerHTML = `<i class="lucide-loader-2 spin"></i> Locating...`;
  
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btnLocate.innerHTML = `<i class="lucide-crosshair"></i> Detect My Area`;
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;
      
      appState.currentLocation = {
        lat: userLat,
        lng: userLng,
        name: "Your Current GPS Location"
      };

      document.getElementById('main-location-input').value = "GPS: Current Location";
      showNearbyBusRoutes(userLat, userLng, "Your Current Location");
    },
    (err) => {
      btnLocate.innerHTML = `<i class="lucide-crosshair"></i> Detect My Area`;
      console.warn("GPS error/denied. Using sample Lahore area coordinates.");
      const sample = LAHORE_AREAS.find(a => a.name.includes("Kalma"));
      if (sample) {
        document.getElementById('main-location-input').value = sample.name;
        showNearbyBusRoutes(sample.lat, sample.lng, sample.name);
      }
    },
    { timeout: 10000 }
  );
}

// Normalize text for fuzzy matching (remove spaces, dashes, dots for comparison)
function normalizeText(text) {
  return text.toLowerCase().replace(/[\s\-\.\/,]+/g, '');
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

// Location Text Search Handler
async function handleLocationSearch() {
  const rawQuery = document.getElementById('main-location-input').value.trim();
  if (!rawQuery) {
    appState.locationSearchError = 'Location not found. Please enter a valid address or area.';
    appState.nearbyRouteResults = [];
    renderResultPage();
    navigateToPage('result');
    return;
  }

  const btnFindBus = document.getElementById('btn-find-bus');
  if (btnFindBus) {
    btnFindBus.disabled = true;
    btnFindBus.innerHTML = '<i class="lucide-loader-2 spin"></i> Searching...';
  }

  try {
    const geocode = await geocodeLocationQuery(rawQuery);
    if (!geocode) {
      appState.locationSearchError = 'Location not found. Please enter a valid address or area.';
      appState.nearbyRouteResults = [];
      renderResultPage();
      navigateToPage('result');
      return;
    }

    showNearbyBusRoutes(geocode.lat, geocode.lng, geocode.formattedAddress || rawQuery);
  } catch (error) {
    appState.locationSearchError = 'Location not found. Please enter a valid address or area.';
    appState.nearbyRouteResults = [];
    renderResultPage();
    navigateToPage('result');
  } finally {
    if (btnFindBus) {
      btnFindBus.disabled = false;
      btnFindBus.innerHTML = '<i class="lucide-search"></i> Find Bus Route';
    }
  }
}

// Execute Nearest Stop Search & Display Result
function executeFindNearest(lat, lng, locationLabel) {
  appState.nearbyRouteResults = [];
  appState.locationSearchError = null;

  const result = findNearestStop(lat, lng, appState.selectedCampus);
  if (!result) {
    alert("No routes found matching your criteria.");
    return;
  }

  appState.nearestResult = {
    ...result,
    userLocationLabel: locationLabel,
    userLat: lat,
    userLng: lng
  };

  renderResultPage();
  navigateToPage('result');
}

// Quick Chip Select
function selectAreaChip(areaName) {
  const area = LAHORE_AREAS.find(a => a.name === areaName);
  if (area) {
    document.getElementById('main-location-input').value = area.name;
    executeFindNearest(area.lat, area.lng, area.name);
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

  // Render Area Chips
  const chipsContainer = document.getElementById('area-chips-wrapper');
  if (chipsContainer) {
    chipsContainer.innerHTML = `
      <span class="quick-chip-title"><i class="lucide-sparkles"></i> Popular Areas:</span>
      ${LAHORE_AREAS.slice(0, 12).map(a => `
        <button class="area-chip" onclick="selectAreaChip('${a.name}')">${a.name}</button>
      `).join('')}
    `;
  }
}

// Render Result Page (Bus Route Finding Result)
function renderResultPage() {
  const container = document.getElementById('result-content-container');
  if (!container) return;

  if (appState.locationSearchError) {
    container.innerHTML = `
      <div class="info-card no-result-box">
        <div class="no-result-icon"><i class="lucide-map-pin-off"></i></div>
        <h3>Location not found</h3>
        <p>${appState.locationSearchError}</p>
      </div>
    `;
    return;
  }

  if (appState.nearbyRouteResults && appState.nearbyRouteResults.length > 0) {
    const nearbyResults = appState.nearbyRouteResults;
    const locationLabel = appState.currentLocation ? appState.currentLocation.name : 'Selected location';
    const userLat = appState.currentLocation ? appState.currentLocation.lat : nearbyResults[0].route.stops[0].lat;
    const userLng = appState.currentLocation ? appState.currentLocation.lng : nearbyResults[0].route.stops[0].lng;
    const nearbyStops = buildNearbyStopSuggestions(userLat, userLng, 1.5, appState.selectedCampus);
    const yourStops = nearbyStops.filter(item => item.distanceKm <= 0.5);
    const suggestedStops = nearbyStops.filter(item => item.distanceKm > 0.5 && item.distanceKm <= 1.5);

    const mapPoints = [
      { lat: userLat, lng: userLng, title: 'Your Location', popup: `<b>Your Location</b><br>${locationLabel}` },
      ...nearbyResults.slice(0, 12).map((item) => ({
        lat: item.stop.lat,
        lng: item.stop.lng,
        title: `${item.route.routeNo} - ${item.stop.name}`,
        popup: `<b>${item.route.routeNo}</b><br>${item.stop.name}<br>Distance: ${item.distanceKm.toFixed(1)} km`
      }))
    ];

    const renderStopList = (items, title, emptyText) => {
      if (!items.length) {
        return `
          <div class="info-card" style="margin-bottom:1rem;">
            <div class="info-card-title">
              <i class="lucide-map-pin" style="color:var(--primary-light)"></i>
              <span>${title}</span>
            </div>
            <div style="color:var(--text-muted); padding:0.5rem 0;">${emptyText}</div>
          </div>
        `;
      }

      return `
        <div class="info-card" style="margin-bottom:1rem;">
          <div class="info-card-title">
            <i class="lucide-map-pin" style="color:var(--primary-light)"></i>
            <span>${title}</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:0.75rem;">
            ${items.map(({ route, stop, distanceKm }) => `
              <div style="background:#F8FAFC; border:1px solid var(--border-light); border-radius:var(--radius-md); padding:0.85rem 1rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap;">
                  <div>
                    <span class="route-badge">${route.routeNo}</span>
                    <div style="font-size:1rem; font-weight:700; color:var(--primary); margin-top:0.4rem;">${stop.name}</div>
                  </div>
                  <span class="distance-badge"><i class="lucide-map-pin"></i> ${distanceKm.toFixed(1)} km</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <div class="result-hero-box">
        <div class="nearest-stop-banner">
          <div class="stop-pin-icon">
            <i class="lucide-map-pin"></i>
          </div>
          <div class="nearest-stop-info" style="flex:1;">
            <div style="font-size:0.85rem; text-transform:uppercase; font-weight:700; color:var(--text-muted);">
              Nearby UET Routes for "${locationLabel}"
            </div>
            <h2>Available Routes Near Your Location</h2>
            <div style="display:flex; gap:0.5rem; align-items:center; margin-top:0.3rem; flex-wrap:wrap;">
              <span class="distance-badge"><i class="lucide-route"></i> ${nearbyResults.length} route(s) nearby</span>
            </div>
          </div>
        </div>
      </div>

      <div class="details-split-grid">
        <div>
          ${renderStopList(yourStops, 'Your Stop', 'No stop found within 0.5 km of your location.')}
          ${renderStopList(suggestedStops, 'Other Suggested Stops', 'No additional nearby stops between 0.5 km and 1.5 km.')}

          <div class="info-card">
            <div class="info-card-title">
              <i class="lucide-bus" style="color:var(--primary-light)"></i>
              <span>Nearby UET Bus Routes</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:0.9rem;">
              ${nearbyResults.map(({ route, stop, distanceKm }) => `
                <div style="background:#F8FAFC; border:1px solid var(--border-light); border-radius:var(--radius-md); padding:1rem;">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.5rem;">
                    <div>
                      <span class="route-badge">${route.routeNo}</span>
                      <div style="font-size:1.05rem; font-weight:700; color:var(--primary); margin-top:0.45rem;">${route.name}</div>
                    </div>
                    <span class="distance-badge"><i class="lucide-map-pin"></i> ${distanceKm.toFixed(1)} km</span>
                  </div>
                  <div style="font-size:0.9rem; color:var(--text-muted); margin-bottom:0.8rem;">
                    <strong>Nearest Stop:</strong> ${stop.name}
                  </div>
                  <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button class="btn-card-primary" onclick="viewRouteDetail('${route.id}')">
                      <i class="lucide-eye"></i> View Route
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div>
          <div class="info-card">
            <div class="info-card-title">
              <i class="lucide-map" style="color:var(--primary-light)"></i>
              <span>Nearby Stops Map</span>
            </div>
            <div id="result-map" class="map-container"></div>
          </div>
        </div>
      </div>
    `;

    setTimeout(() => {
      initLeafletMap('result-map', [userLat, userLng], 12, mapPoints);
    }, 100);

    return;
  }

  if (appState.nearbyRouteResults && appState.nearbyRouteResults.length === 0) {
    container.innerHTML = `
      <div class="info-card no-result-box">
        <div class="no-result-icon"><i class="lucide-search-x"></i></div>
        <h3>No UET bus routes found near this location.</h3>
        <p>Try searching a nearby area or increasing the search radius.</p>
      </div>
    `;
    return;
  }

  const result = appState.nearestResult;
  if (!result) {
    container.innerHTML = `
      <div class="info-card no-result-box">
        <div class="no-result-icon"><i class="lucide-search-x"></i></div>
        <h3>No UET bus routes found near this location.</h3>
        <p>Try searching a nearby area or increasing the search radius.</p>
      </div>
    `;
    return;
  }

  const { route, stop, stopIndex, distanceKm, userLocationLabel } = result;
  const isFav = appState.favorites.includes(route.id);
  const formattedDist = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} meters` : `${distanceKm.toFixed(1)} km`;
  const estimatedWalk = Math.max(2, Math.round(distanceKm * 12));

  let timelineHtml = '';
  route.stops.forEach((s, idx) => {
    let typeClass = '';
    let badgeText = '';

    if (idx === 0) {
      typeClass = 'origin';
      badgeText = 'Morning Start Point';
    } else if (idx === route.stops.length - 1) {
      typeClass = 'destination';
      badgeText = 'Campus Arrival';
    } else if (idx === stopIndex) {
      typeClass = 'nearest';
      badgeText = 'Recommended Pickup';
    }

    timelineHtml += `
      <div class="timeline-item ${typeClass}">
        <div>
          <div class="timeline-name">
            ${s.name} ${badgeText ? `<span class="campus-chip" style="margin-left:0.5rem; background:${idx === stopIndex ? 'var(--accent)' : ''}; color:${idx === stopIndex ? 'var(--primary-dark)' : ''}">${badgeText}</span>` : ''}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Stop #${idx + 1}</div>
        </div>
        <div class="timeline-time">${s.time}</div>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="result-hero-box">
      <div class="nearest-stop-banner">
        <div class="stop-pin-icon">
          <i class="lucide-navigation"></i>
        </div>
        <div class="nearest-stop-info" style="flex:1;">
          <div style="font-size:0.85rem; text-transform:uppercase; font-weight:700; color:var(--text-muted);">
            Nearest Morning Pickup Stop for "${userLocationLabel}"
          </div>
          <h2>${stop.name}</h2>
          <div style="display:flex; gap:0.5rem; align-items:center; margin-top:0.3rem; flex-wrap:wrap;">
            <span class="distance-badge"><i class="lucide-map-pin"></i> ${formattedDist} away</span>
            <span style="font-size:0.85rem; color:var(--text-muted);"><i class="lucide-footprints"></i> ~${estimatedWalk} mins walk</span>
            <span style="font-size:0.85rem; color:var(--text-muted);"><i class="lucide-clock"></i> Pickup: <strong>${stop.time}</strong></span>
          </div>
        </div>
        <div>
          <button class="btn-accent" onclick="openGoogleMapsDirections(${stop.lat}, ${stop.lng}, '${encodeURIComponent(stop.name)}')">
            <i class="lucide-navigation"></i> Navigate to Pickup Stop
          </button>
        </div>
      </div>
    </div>

    <div class="details-split-grid">
      <div>
        <div class="info-card">
          <div class="info-card-title">
            <i class="lucide-bus" style="color:var(--primary-light)"></i>
            <span>Morning Route Schedule & Stops</span>
            <span class="route-badge" style="margin-left:auto;">${route.routeNo}</span>
          </div>
          <div style="font-size:1.05rem; font-weight:700; color:var(--primary); margin-bottom:0.5rem;">
            ${route.name}
          </div>
          <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:1rem;">
            Target Destination: <strong>${route.campusId === 'ksk' ? 'UET KSK New Campus (Arrival 07:50 AM)' : 'UET Main Campus GT Road (Arrival 07:45 AM)'}</strong>
          </p>

          <h4 style="font-size:0.9rem; color:var(--primary); margin-top:1.25rem; margin-bottom:0.75rem;">
            Morning Stop Schedule (In Order)
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
            <div class="driver-avatar">${route.driverName.charAt(0)}</div>
            <div class="driver-info">
              <h4>${route.driverName}</h4>
              <p style="font-size:0.82rem; color:var(--text-muted);">Bus Driver / Operator</p>
              <p style="font-size:0.85rem; font-weight:600; margin-top:0.2rem;">${getDisplayDriverPhone(route)}</p>
            </div>
            <a href="${route.campusId === 'main' ? 'javascript:void(0)' : `tel:${route.driverPhone}`}" class="btn-call" title="${route.campusId === 'main' ? 'Driver phone unavailable' : 'Call Driver'}" ${route.campusId === 'main' ? 'onclick="return false;"' : ''}>
              <i class="lucide-phone-call"></i> ${route.campusId === 'main' ? 'N/A' : 'Call'}
            </a>
          </div>

          <div style="background:#F8FAFC; padding:0.85rem; border-radius:var(--radius-md); font-size:0.85rem; margin-bottom:1rem; border:1px solid var(--border-light);">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="color:var(--text-muted);">Vehicle Number:</span>
              <strong>${getDisplayVehicleNo(route)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted);">Campus Destination:</span>
              <strong>${route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}</strong>
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
            <span>Interactive Stop Map</span>
          </div>
          <div id="result-map" class="map-container"></div>
        </div>
      </div>
    </div>
  `;

  // Init Leaflet map after DOM render
  setTimeout(() => {
    initLeafletMap('result-map', [stop.lat, stop.lng], 13, [
      { lat: stop.lat, lng: stop.lng, title: `Pickup: ${stop.name}`, popup: `<b>Nearest Stop: ${stop.name}</b><br>Pickup Time: ${stop.time}` },
      { lat: route.stops[route.stops.length-1].lat, lng: route.stops[route.stops.length-1].lng, title: 'Campus Destination', popup: `<b>${route.stops[route.stops.length-1].name}</b>` }
    ]);
  }, 100);
}

// Render Route Details View Page
function renderRoutesPage() {
  const container = document.getElementById('routes-detail-container');
  if (!container) return;

  const routeSearchQuery = normalizeStopSearchText(appState.routeScheduleQuery);
  const campusFilteredRoutes = UET_DATA.routes.filter(r => 
    !appState.selectedCampus || r.campusId === appState.selectedCampus
  );
  const selectedRoutes = routeSearchQuery
    ? campusFilteredRoutes.filter(route =>
        route.stops.some(stop => normalizeStopSearchText(stop.name).includes(routeSearchQuery))
      )
    : campusFilteredRoutes;
  const displayRoutes = selectedRoutes;

  let html = `
    <div style="margin-bottom:1.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
      <div>
        <h2>Official UET Bus Routes (${appState.selectedCampus === 'ksk' ? 'KSK New Campus' : 'Main Campus - 22 Morning Routes'})</h2>
        <p style="color:var(--text-muted); font-size:0.9rem;">Morning Arrival Schedules extracted from official Transport Office PDF</p>
      </div>
    </div>

    <div class="info-card" style="margin-bottom:1.5rem;">
      <div class="campus-toggle-wrapper" style="justify-content:flex-start; margin:0;">
        <button class="route-campus-btn ${appState.selectedCampus === 'main' ? 'active' : ''}" data-campus="main">
          <i class="lucide-graduation-cap"></i> Main Campus
        </button>
        <button class="route-campus-btn ${appState.selectedCampus === 'ksk' ? 'active' : ''}" data-campus="ksk">
          <i class="lucide-building-2"></i> KSK Campus
        </button>
      </div>
    </div>
  `;

  if (routeSearchQuery && displayRoutes.length === 0) {
    html += `
      <div class="info-card no-result-box">
        <div class="no-result-icon"><i class="lucide-search-x"></i></div>
        <h3>No result found</h3>
        <p>No bus stop matching your search was found.</p>
      </div>
    `;
    container.innerHTML = html;
    return;
  }

  displayRoutes.forEach(route => {
    const isFav = appState.favorites.includes(route.id);
    const exactMatchIndex = route.stops.findIndex(stop => normalizeStopSearchText(stop.name) === routeSearchQuery);
    const fallbackMatchIndex = routeSearchQuery
      ? route.stops.findIndex(stop => normalizeStopSearchText(stop.name).includes(routeSearchQuery))
      : -1;
    const matchedIndex = exactMatchIndex >= 0 ? exactMatchIndex : fallbackMatchIndex;

    html += `
      <div class="info-card" id="route-card-${route.id}" style="margin-bottom:1.75rem;">
        <div class="info-card-title" style="flex-wrap:wrap; gap:0.5rem;">
          <span class="route-badge">${route.routeNo}</span>
          <span style="font-size:1.15rem; font-weight:700; color:var(--primary);">${route.name}</span>
          <span class="campus-chip" style="margin-left:auto;">${route.campusId === 'ksk' ? 'KSK Campus' : 'Main Campus'}</span>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.25rem; background:#F8FAFC; padding:1rem; border-radius:var(--radius-md);">
          <div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Driver Name</div>
            <div style="font-weight:700; color:var(--primary);">${route.driverName}</div>
          </div>
          <div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Driver Mobile</div>
            <div style="font-weight:700;">${route.campusId === 'main' ? 'N/A' : `<a href="tel:${route.driverPhone}"><i class="lucide-phone" style="font-size:0.8rem;"></i> ${route.driverPhone}</a>`}</div>
          </div>
          <div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Bus Registration No.</div>
            <div style="font-weight:700;">${getDisplayVehicleNo(route)}</div>
          </div>
          <div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Morning Campus Arrival</div>
            <div style="font-weight:700; color:var(--success);">${route.arrivalTime}</div>
          </div>
        </div>

        <h4 style="font-size:0.95rem; color:var(--primary); margin-bottom:0.75rem;">
          <i class="lucide-list" style="font-size:0.9rem;"></i> Morning Pickup Stops & Sequence
        </h4>

        <div class="data-table-wrapper" style="margin-bottom:1rem;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Stop #</th>
                <th>Stop Name</th>
                <th>Morning Pickup Time</th>
              </tr>
            </thead>
            <tbody>
              ${route.stops.map((s, idx) => {
                const isMatch = !!routeSearchQuery && idx === matchedIndex;
                return `
                  <tr class="${isMatch ? 'route-search-match' : ''}" ${isMatch ? 'data-stop-match="true"' : ''} ${idx === route.stops.length - 1 ? 'style="background:#EFF6FF; font-weight:700;"' : ''}>
                    <td>${idx + 1}</td>
                    <td>
                      ${s.name}
                      ${idx === route.stops.length - 1 ? '🏁 (Campus Destination)' : ''}
                      ${isMatch ? '<span class="route-match-badge">Matched Stop</span>' : ''}
                    </td>
                    <td><strong>${s.time}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        ${route.notes ? `
          <div style="font-size:0.85rem; color:var(--text-muted); background:var(--accent-soft); padding:0.75rem 1rem; border-radius:var(--radius-sm); border-left:3px solid var(--accent); margin-bottom:1rem;">
            <strong>Note:</strong> ${route.notes}
          </div>
        ` : ''}

        <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
          <button class="btn-secondary" onclick="printRouteSchedule('${route.id}')">
            <i class="lucide-printer"></i> Download Route PDF / Print
          </button>
          <button class="btn-secondary ${isFav ? 'active' : ''}" onclick="toggleFavorite('${route.id}', this)">
            <i class="lucide-bookmark"></i> ${isFav ? 'Saved' : 'Save Route'}
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  if (routeSearchQuery) {
    setTimeout(() => {
      const highlightedMatch = document.querySelector('.route-search-match');
      if (highlightedMatch) {
        highlightedMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }
}

function initLeafletMap(containerId, centerCoords, zoomLevel, points) {
  const container = document.getElementById(containerId);
  if (!container || typeof L === 'undefined') {
    return;
  }

  if (window.__uetMapInstance) {
    window.__uetMapInstance.remove();
  }

  const map = L.map(containerId).setView(centerCoords, zoomLevel);
  window.__uetMapInstance = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  points.forEach(point => {
    const marker = L.marker([point.lat, point.lng]).addTo(map);
    if (point.title) {
      marker.bindPopup(point.popup || point.title);
    }
  });
}

// View specific route detail (scroll or navigate)
function viewRouteDetail(routeId) {
  const route = UET_DATA.routes.find(r => r.id === routeId);
  if (!route) return;

  appState.selectedCampus = route.campusId;
  document.querySelectorAll('.campus-btn').forEach(b => {
    if (b.dataset.campus === route.campusId) b.classList.add('active');
    else b.classList.remove('active');
  });

  renderRoutesPage();
  navigateToPage('routes');

  setTimeout(() => {
    const el = document.getElementById(`route-card-${routeId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
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
      <div style="text-align:center; padding:4rem 1rem; background:white; border-radius:var(--radius-lg); border:1px solid var(--border-light);">
        <i class="lucide-bookmark" style="font-size:3rem; color:var(--text-light); margin-bottom:1rem;"></i>
        <h3>No Saved Routes Yet</h3>
        <p style="color:var(--text-muted); margin-bottom:1.5rem;">Bookmark your daily commuting routes for 1-click access anytime!</p>
        <button class="btn-find-bus" style="margin:0 auto;" onclick="navigateToPage('home')">
          Explore Routes
        </button>
      </div>
    `;
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
          <button class="btn-fav active" onclick="toggleFavorite('${route.id}', this)"><i class="lucide-trash-2"></i></button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
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
      <div style="border-bottom:2px solid var(--primary); padding-bottom:0.75rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="color:var(--primary); font-size:1.5rem;">UET BUS ${route.routeNo.toUpperCase()}</h2>
          <p style="color:var(--text-muted); font-size:0.85rem;">Official Transport Morning Schedule - ${route.name}</p>
        </div>
        <span class="route-badge" style="font-size:1.1rem; padding:0.5rem 1rem;">${route.campusId === 'ksk' ? 'KSK CAMPUS' : 'MAIN CAMPUS'}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; font-size:0.9rem; background:#F8FAFC; padding:0.85rem; border-radius:8px;">
        <div><strong>Driver:</strong> ${route.driverName}</div>
        <div><strong>Contact:</strong> ${getDisplayDriverPhone(route)}</div>
        <div><strong>Vehicle No:</strong> ${getDisplayVehicleNo(route)}</div>
        <div><strong>Morning Arrival:</strong> ${route.arrivalTime}</div>
      </div>

      <table class="data-table" style="margin-bottom:1.5rem;">
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

      <div style="font-size:0.75rem; color:var(--text-muted); text-align:center; border-top:1px dashed #ccc; padding-top:0.75rem;">
        Issued by Chairman Transport Committee UET | Contact: Mr. M. Mushtaq 0304-0165776
      </div>
    </div>

    <div style="margin-top:1.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
      <button class="btn-find-bus" onclick="window.print()"><i class="lucide-printer"></i> Print / Save as PDF</button>
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  modal.classList.add('active');
}

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
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
      .bindPopup(pt.popup);
  });
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
