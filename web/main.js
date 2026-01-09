import { regions, defaultRegion, getRegion, getRegionList, detectRegionByCoordinates } from './regions/index.js';
import { createViewer, initLayers, clearAllLayers, updateTerrain, useGlobalTerrain, flyToRegion } from './layerManager.js';
import { addLayersToLegend, syncLegendCheckboxes } from './addLayersToLegend.js';
import { initAuthUI } from './auth.js'
import { supabase } from './supabaseClient.js'
import { gpx as togeojsonGpx, kml as togeojsonKml } from '@tmcw/togeojson'
import { initPerformanceOptimizations, getPerformanceTier, applyPerformanceSettings, createThrottledCameraHandler } from './performanceConfig.js'
import './styles.css'

// =========================
// Region State Management
// =========================
// Priority: URL param > localStorage > default
function getInitialRegion() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlRegion = urlParams.get('region')?.toUpperCase();
  if (urlRegion && regions[urlRegion]) {
    return urlRegion;
  }
  return localStorage.getItem('selectedRegion') || defaultRegion;
}

let currentRegionCode = getInitialRegion();
let layerState = null;
let lastZoomState = null;
let userSelectedBasemap = null;

// =========================
// Custom Confirm/Alert Modal
// =========================
const confirmModal = document.getElementById('confirmModal');
const confirmModalBackdrop = document.querySelector('.confirmModalBackdrop');
const confirmModalIcon = document.getElementById('confirmModalIcon');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalCancel = document.getElementById('confirmModalCancel');
const confirmModalConfirm = document.getElementById('confirmModalConfirm');

let confirmResolve = null;

function showConfirm({ 
  title = 'Confirm', 
  message = 'Are you sure?', 
  icon = '⚠️',
  variant = 'warning', // 'warning', 'danger', 'success', 'info'
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmStyle = 'danger' // 'danger', 'primary'
}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    
    confirmModal.className = `confirmModal ${variant}`;
    confirmModalIcon.textContent = icon;
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    confirmModalConfirm.textContent = confirmText;
    confirmModalCancel.textContent = cancelText;
    
    // Style confirm button
    confirmModalConfirm.classList.remove('pillBtnDanger', 'pillBtnPrimary');
    if (confirmStyle === 'danger') {
      confirmModalConfirm.classList.add('pillBtnDanger');
    }
    
    confirmModal.classList.remove('is-hidden', 'alert-mode');
    confirmModalConfirm.focus();
  });
}

function showAlert({ 
  title = 'Notice', 
  message = '', 
  icon = 'ℹ️',
  variant = 'info', // 'warning', 'danger', 'success', 'info'
  buttonText = 'OK'
}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    
    confirmModal.className = `confirmModal ${variant} alert-mode`;
    confirmModalIcon.textContent = icon;
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    confirmModalConfirm.textContent = buttonText;
    
    confirmModalConfirm.classList.remove('pillBtnDanger');
    
    confirmModal.classList.remove('is-hidden');
    confirmModalConfirm.focus();
  });
}

function closeConfirmModal(result) {
  confirmModal.classList.add('is-hidden');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

confirmModalConfirm.addEventListener('click', () => closeConfirmModal(true));
confirmModalCancel.addEventListener('click', () => closeConfirmModal(false));
confirmModalBackdrop.addEventListener('click', () => closeConfirmModal(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmModal.classList.contains('is-hidden')) {
    closeConfirmModal(false);
  }
});

// helper: check if user is logged in and show/hide My Tours tab
async function updateAuthState() {
  const { data: { user } } = await supabase.auth.getUser();
  const navMyTours = document.getElementById('navMyTours');
  if (user) {
    navMyTours.classList.remove('is-hidden');
    // Fallback: Stelle sicher, dass der Button sichtbar ist (z.B. auf Mobile)
    navMyTours.style.display = '';
    if (window.getComputedStyle(navMyTours).display === 'none') {
      navMyTours.style.display = 'block';
    }
  } else {
    navMyTours.classList.add('is-hidden');
    navMyTours.style.display = '';
    // if My Tours is shown, switch back to Legend
    const viewMyTours = document.getElementById('viewMyTours');
    if (!viewMyTours.classList.contains('is-hidden')) {
      showLegend();
    }
  }
}

// listen to auth state changes
supabase.auth.onAuthStateChange((_event, _session) => {
  updateAuthState();
});

// Initialen Auth-Status erst prüfen, wenn die Drawer-Navigation im DOM ist
setTimeout(updateAuthState, 0);


// =========================
// Region Selector Setup
// =========================
const regionDropdown = document.getElementById('regionDropdown');
const regionToggle = document.getElementById('regionToggle');
const regionOptions = document.getElementById('regionOptions');
const regionFlagEl = document.getElementById('regionFlag');
const regionNameEl = document.getElementById('regionName');

// Helper: Extract first coordinate from GeoJSON and detect region
function detectRegionFromGeoJson(geoJson) {
  try {
    let coords = null;
    
    // Handle different GeoJSON structures
    if (geoJson.type === 'FeatureCollection' && geoJson.features?.length > 0) {
      const geom = geoJson.features[0].geometry;
      if (geom.type === 'LineString') coords = geom.coordinates[0];
      else if (geom.type === 'MultiLineString') coords = geom.coordinates[0][0];
      else if (geom.type === 'Point') coords = geom.coordinates;
    } else if (geoJson.type === 'Feature') {
      const geom = geoJson.geometry;
      if (geom.type === 'LineString') coords = geom.coordinates[0];
      else if (geom.type === 'MultiLineString') coords = geom.coordinates[0][0];
      else if (geom.type === 'Point') coords = geom.coordinates;
    } else if (geoJson.type === 'LineString') {
      coords = geoJson.coordinates[0];
    }
    
    if (coords && coords.length >= 2) {
      const [longitude, latitude] = coords;
      return detectRegionByCoordinates(longitude, latitude);
    }
  } catch (err) {
    console.warn('Could not detect region from GeoJSON:', err);
  }
  return null;
}

function populateRegionSelect() {
  const regionList = getRegionList();
  const currentRegion = getRegion(currentRegionCode);
  
  // Update toggle button
  regionFlagEl.innerHTML = `<img src="${currentRegion.flag}" alt="${currentRegion.code}" class="regionFlagImg">`;
  regionNameEl.textContent = window.i18n ? window.i18n.getTranslation(currentRegion.code.toLowerCase()) : currentRegion.name;
  
  // Populate options list
  regionOptions.innerHTML = regionList.map(r => 
    `<li class="regionOption ${r.code === currentRegionCode ? 'is-selected' : ''}" data-code="${r.code}">
      <span class="regionFlag"><img src="${r.flag}" alt="${r.code}" class="regionFlagImg"></span>
      <span class="regionNameText">${window.i18n ? window.i18n.getTranslation(r.code.toLowerCase()) : r.name}</span>
    </li>`
  ).join('');
  
  // Add click handlers to options
  regionOptions.querySelectorAll('.regionOption').forEach(opt => {
    opt.addEventListener('click', () => {
      const code = opt.dataset.code;
      regionOptions.classList.add('is-hidden');
      if (code !== currentRegionCode) {
        switchRegion(code);
        populateRegionSelect(); // Update UI
      }
    });
  });
}

// Make populateRegionSelect available globally for translations
window.populateRegionSelect = populateRegionSelect;

// Toggle dropdown open/close
regionToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  regionOptions.classList.toggle('is-hidden');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!regionDropdown.contains(e.target)) {
    regionOptions.classList.add('is-hidden');
  }
});

async function switchRegion(regionCode) {
  const region = getRegion(regionCode);
  if (!region) return;
  
  currentRegionCode = regionCode;
  localStorage.setItem('selectedRegion', regionCode);
  
  // Update URL without reload
  const url = new URL(window.location);
  url.searchParams.set('region', regionCode);
  window.history.replaceState({}, '', url);
  
  // Reset zoom state tracking for new region
  lastZoomState = null;
  userSelectedBasemap = null;
  
  // Clear existing layers
  clearAllLayers(viewer);
  
  // Update terrain
  await updateTerrain(viewer, region.terrain);
  
  // Re-init layers with new region config
  layerState = initLayers(viewer, region.layers);
  
  // Rebuild legend UI
  const legendEl = document.getElementById('legend');
  legendEl.innerHTML = '';
  addLayersToLegend(layerState, viewer);
  
  // Fly to new region
  flyToRegion(viewer, region.initialView);
}

// Init region selector
populateRegionSelect();

// Get initial region config
const initialRegion = getRegion(currentRegionCode);

// Create viewer (terrain, basic UI config) - async with top-level await
const viewer = await createViewer('cesiumContainer', 'invisibleCredits', initialRegion.terrain);

// Make viewer globally available for translations
window.viewer = viewer;

// Initial camera position from region config
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(
    initialRegion.initialView.longitude,
    initialRegion.initialView.latitude,
    initialRegion.initialView.height
  ),
  orientation: {
    heading: Cesium.Math.toRadians(initialRegion.initialView.heading || 0),
    pitch: Cesium.Math.toRadians(initialRegion.initialView.pitch || -90),
    roll: initialRegion.initialView.roll || 0
  }
});

// Init layers (adds only active layers, keeps references)
layerState = initLayers(viewer, initialRegion.layers);

// Make layerState globally available for translations
window.layerState = layerState;

// Legend UI binds to layerState operations
addLayersToLegend(layerState, viewer);

// =========================
// Performance Optimizations
// Auto-detects device capabilities and applies appropriate settings
// =========================
const performanceTier = initPerformanceOptimizations(viewer);
console.log('Performance tier applied:', performanceTier);

// Setup performance mode selector UI
const performanceModeSelect = document.getElementById('performanceMode');
const performanceTierLabel = document.getElementById('performanceTierLabel');

if (performanceModeSelect && performanceTierLabel) {
  // Show auto-detected tier
  const tierLabels = { low: 'Power Saver', medium: 'Balanced', high: 'High Quality' };
  performanceTierLabel.textContent = `(Detected: ${tierLabels[performanceTier] || performanceTier})`;
  
  // Store user preference
  const savedMode = localStorage.getItem('performanceMode');
  if (savedMode) {
    performanceModeSelect.value = savedMode;
    if (savedMode !== 'auto') {
      applyPerformanceSettings(viewer, savedMode);
    }
  }
  
  performanceModeSelect.addEventListener('change', (e) => {
    const mode = e.target.value;
    localStorage.setItem('performanceMode', mode);
    
    if (mode === 'auto') {
      // Re-apply auto-detected settings
      initPerformanceOptimizations(viewer);
      performanceTierLabel.textContent = `(Detected: ${tierLabels[performanceTier] || performanceTier})`;
    } else {
      // Apply user-selected mode
      applyPerformanceSettings(viewer, mode);
      performanceTierLabel.textContent = '';
    }
  });
}

// =========================
// Locator (Geolocation)
// Simple toggle: Click to start tracking + fly to position, click again to stop
// =========================
const locatorBtn = document.getElementById('locatorBtn');

let locatorState = {
  watchId: null,
  isTracking: false,
  hasCenteredOnce: false,
  lastPosition: null,
  userMarker: null,
  accuracyCircle: null
};

function updateLocatorMarker(longitude, latitude, accuracy) {
  const position = Cesium.Cartesian3.fromDegrees(longitude, latitude);
  
  // Update or create marker
  if (locatorState.userMarker) {
    locatorState.userMarker.position = position;
  } else {
    locatorState.userMarker = viewer.entities.add({
      position: position,
      point: {
        pixelSize: 16,
        color: Cesium.Color.fromCssColorString('#2a5af7'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });
  }
  
  // Update or create accuracy circle
  if (locatorState.accuracyCircle) {
    locatorState.accuracyCircle.position = position;
    locatorState.accuracyCircle.ellipse.semiMajorAxis = accuracy;
    locatorState.accuracyCircle.ellipse.semiMinorAxis = accuracy;
  } else {
    locatorState.accuracyCircle = viewer.entities.add({
      position: position,
      ellipse: {
        semiMajorAxis: accuracy,
        semiMinorAxis: accuracy,
        material: Cesium.Color.fromCssColorString('#2a5af7').withAlpha(0.35),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#2a5af7').withAlpha(0.7),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });
  }
}

function flyToPositionVertical(longitude, latitude) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 1500),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    },
    duration: 1.5
  });
}

function handlePositionUpdate(position) {
  const { longitude, latitude, accuracy } = position.coords;
  locatorState.lastPosition = { longitude, latitude, accuracy };
  
  // Update marker and accuracy circle
  updateLocatorMarker(longitude, latitude, accuracy);
  
  // First position received - fly to it
  if (!locatorState.hasCenteredOnce) {
    locatorState.hasCenteredOnce = true;
    flyToPositionVertical(longitude, latitude);
  }
  
  // Update button state
  locatorBtn.classList.remove('is-loading');
  locatorBtn.classList.add('is-active');
}

function handlePositionError(error) {
  console.warn('Geolocation error:', error.message);
  locatorBtn.classList.remove('is-loading', 'is-active');
  locatorState.isTracking = false;
}

function startTracking() {
  if (!navigator.geolocation) {
    console.warn('Geolocation not supported');
    return;
  }
  
  locatorBtn.classList.add('is-loading');
  locatorState.isTracking = true;
  locatorState.hasCenteredOnce = false;
  
  locatorState.watchId = navigator.geolocation.watchPosition(
    handlePositionUpdate,
    handlePositionError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 3000
    }
  );
}

function stopTracking() {
  if (locatorState.watchId !== null) {
    navigator.geolocation.clearWatch(locatorState.watchId);
    locatorState.watchId = null;
  }
  
  // Remove marker and accuracy circle
  if (locatorState.userMarker) {
    viewer.entities.remove(locatorState.userMarker);
    locatorState.userMarker = null;
  }
  if (locatorState.accuracyCircle) {
    viewer.entities.remove(locatorState.accuracyCircle);
    locatorState.accuracyCircle = null;
  }
  
  locatorState.isTracking = false;
  locatorState.hasCenteredOnce = false;
  locatorState.lastPosition = null;
  locatorBtn.classList.remove('is-active', 'is-loading');
}

locatorBtn.addEventListener('click', () => {
  if (!locatorState.isTracking) {
    startTracking();
  } else {
    stopTracking();
  }
});

// =========================
// Auto-switch terrain when outside region bounds
// Uses Cesium World Terrain globally, regional terrain when inside bounds
// =========================
let usingGlobalTerrain = false;

function isInsideRegionBounds(lon, lat, bounds) {
  if (!bounds) return true; // No bounds defined = always "inside"
  return lon >= bounds.west && lon <= bounds.east && 
         lat >= bounds.south && lat <= bounds.north;
}

// Use throttled handler for terrain switching to reduce CPU usage
const handleCameraChange = createThrottledCameraHandler(viewer, () => {
  const lon = Cesium.Math.toDegrees(viewer.camera.positionCartographic.longitude);
  const lat = Cesium.Math.toDegrees(viewer.camera.positionCartographic.latitude);
  
  // Auto-switch terrain based on whether camera is inside region bounds
  const currentRegion = getRegion(currentRegionCode);
  const insideBounds = isInsideRegionBounds(lon, lat, currentRegion?.bounds);
  
  if (!insideBounds && !usingGlobalTerrain) {
    // Moved outside region - switch to global terrain
    useGlobalTerrain(viewer); // fire-and-forget async
    usingGlobalTerrain = true;
  } else if (insideBounds && usingGlobalTerrain) {
    // Moved back inside region - restore regional terrain
    updateTerrain(viewer, currentRegion?.terrain); // fire-and-forget async
    usingGlobalTerrain = false;
  }
}, 200); // Throttle to max 5 updates per second

viewer.camera.changed.addEventListener(handleCameraChange);

// My Tours UI
const navLegend = document.getElementById('navLegend');
const navMyTours = document.getElementById('navMyTours');
const viewLegend = document.getElementById('viewLegend');
const viewMyTours = document.getElementById('viewMyTours');
const toursList = document.getElementById('toursList');
const newTourForm = document.getElementById('newTourForm');

function closeAllContextMenus() {
  document.querySelectorAll('.trackMenu, .tourMenu').forEach(m => m.classList.add('is-hidden'));
  document.querySelectorAll('.trackMenuBtn, .tourMenuBtn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

function showLegend() {
  viewLegend.classList.remove('is-hidden');
  viewMyTours.classList.add('is-hidden');
  navLegend.classList.add('is-active');
  navMyTours.classList.remove('is-active');
}

function showMyTours() {
  viewLegend.classList.add('is-hidden');
  viewMyTours.classList.remove('is-hidden');
  navLegend.classList.remove('is-active');
  navMyTours.classList.add('is-active');
  loadMyTours();
}

// generate slug for new tours (stored locally, not visible to user)
function generateTourSlug() {
  try {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  } catch (e) {
    return String(Date.now());
  }
}

// Create Tour button / form toggle
const createTourBtn = document.getElementById('createTourBtn');
const cancelTourBtn = document.getElementById('cancelTourBtn');
const newTourTitleInput = document.getElementById('newTourTitle');

function showCreateTourForm() {
  createTourBtn.classList.add('is-hidden');
  newTourForm.classList.remove('is-hidden');
  newTourTitleInput.value = '';
  newTourTitleInput.focus();
}

function hideCreateTourForm() {
  newTourForm.classList.add('is-hidden');
  createTourBtn.classList.remove('is-hidden');
  newTourTitleInput.value = '';
}

createTourBtn.addEventListener('click', showCreateTourForm);
cancelTourBtn.addEventListener('click', hideCreateTourForm);

// Navigation tabs - use both click and touchend for better mobile support
function handleNavLegend(e) {
  e.preventDefault();
  showLegend();
}
function handleNavMyTours(e) {
  e.preventDefault();
  showMyTours();
}

navLegend.addEventListener('click', handleNavLegend);
navMyTours.addEventListener('click', handleNavMyTours);

async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

async function loadMyTours() {
  toursList.innerHTML = window.i18n.getTranslation('loading');
  
  try {
    const user = await currentUser();
    console.log('loadMyTours: user =', user?.id || 'none');
    
    if (!user) { 
      toursList.innerHTML = window.i18n.getTranslation('pleaseLogin'); 
      return;
    }

    // owned tours
    console.log('loadMyTours: fetching owned tours...');
    const { data: owned, error: e1 } = await supabase
      .from('tours')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    
    console.log('loadMyTours: owned tours =', owned?.length || 0, 'error =', e1?.message || 'none');
    
    if (e1) {
      console.error('Error loading owned tours:', e1);
      toursList.innerHTML = `${window.i18n.getTranslation('errorLoadingTours')} ${e1.message}`;
      return;
    }

    // member tours
    console.log('loadMyTours: fetching memberships...');
    const { data: memberships, error: e2 } = await supabase
      .from('tour_members')
      .select('tour_id')
      .eq('user_id', user.id);
    
    console.log('loadMyTours: memberships =', memberships?.length || 0);
    
    if (e2) {
      console.error('Error loading memberships:', e2);
    }

    let memberTours = [];
    if (memberships && memberships.length) {
      const { data, error: e3 } = await supabase
        .from('tours')
        .select('*')
        .in('id', memberships.map(m => m.tour_id));
      if (e3) {
        console.error('Error loading member tours:', e3);
      }
      memberTours = data || [];
    }

    // Mark owned vs member tours
    const ownedWithFlag = (owned || []).map(t => ({ ...t, isOwner: true }));
    const memberWithFlag = memberTours.map(t => ({ ...t, isOwner: false }));
    
    const all = [...ownedWithFlag, ...memberWithFlag];
    console.log('loadMyTours: total tours =', all.length);
    
    if (!all.length) { 
      toursList.innerHTML = `<div>${window.i18n.getTranslation('noToursYet')}</div>`; 
      return;
    }

    // Get member counts for all tours (don't block on errors)
    const tourMemberCounts = {};
    await Promise.all(all.map(async (t) => {
      try {
        const { data: count, error } = await supabase.rpc('get_tour_member_count', { p_tour_id: t.id });
        tourMemberCounts[t.id] = error ? 0 : (count || 0);
      } catch (err) {
        console.warn('Could not get member count for tour', t.id);
        tourMemberCounts[t.id] = 0;
      }
    }));
    
    console.log('loadMyTours: rendering tours...');

  toursList.innerHTML = '';
  for (const t of all) {
    const el = document.createElement('div');
    el.className = 'tourItem';
    
    // new tours (just created, created within last 10s) should be auto-open
    const isNew = Date.now() - new Date(t.created_at).getTime() < 10000;
    const isHidden = !isNew; // old tours start hidden
    
    const memberCount = tourMemberCounts[t.id] || 0;
    const isShared = memberCount > 0;
    
    // For members (not owner), they always see the shared icon since the tour is shared with them
    const showSharedIcon = t.isOwner ? isShared : true;
    
    // Different menu options for owner vs member
    const menuItems = t.isOwner
      ? `<li class="tourMenuRename" data-tour="${t.id}" data-i18n="rename">Rename</li>
         <li class="tourMenuShare" data-tour="${t.id}" data-title="${t.title}" data-i18n="share">Share</li>
         <li class="tourMenuDelete" data-tour="${t.id}" data-is-owner="true" data-i18n="delete">Delete</li>`
      : `<li class="tourMenuLeave" data-tour="${t.id}" data-i18n="leaveTour">Leave tour</li>`;
    
    // Share icon - shown for owners if shared, always for members
    // Different tooltip text for owner vs member
    const shareIconTitle = t.isOwner 
      ? `Shared with ${memberCount} person${memberCount > 1 ? 's' : ''}`
      : `Shared with you`;
    
    const shareIcon = showSharedIcon 
      ? `<button class="iconBtn tourSharedBtn" data-tour="${t.id}" title="${shareIconTitle}">
           <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
             <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
           </svg>
         </button>`
      : '';

    el.innerHTML = `
      <div class="tourHeader" data-tour="${t.id}">
        <strong class="tourTitle" data-tour="${t.id}" data-editable="false">${t.title}</strong>
        <div class="tourHeaderActions">
          ${shareIcon}
          <div class="tourMenuWrap">
            <button class="iconBtn tourMenuBtn" data-tour="${t.id}" title="More options" aria-haspopup="true" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            <ul class="tourMenu is-hidden" data-tour="${t.id}">
              ${menuItems}
            </ul>
          </div>
        </div>
      </div>
      <!-- Shared members popup -->
      <div class="tourMembersPopup is-hidden" data-tour="${t.id}">
        <div class="tourMembersPopupHeader">${window.i18n ? window.i18n.getTranslation('sharedWith') : 'Shared with:'}</div>
        <div class="tourMembersPopupList" data-tour="${t.id}">${window.i18n ? window.i18n.getTranslation('loading') : 'Loading...'}</div>
      </div>
      <div class="tourContent ${isHidden ? 'is-hidden' : ''}" id="content-${t.id}">
        <div class="tracksList" id="tracks-${t.id}">${window.i18n ? window.i18n.getTranslation('loadingTracks') : 'Loading tracks...'}</div>
        <div class="tourActions">
          <label class="uploadLabel" title="${window.i18n ? window.i18n.getTranslation('uploadTrack') : 'Upload Track-File'}">
            <span class="uploadBtnText">${window.i18n ? window.i18n.getTranslation('uploadTrack') : 'Upload Track-File'}</span>
            <input type="file" accept=".gpx,.kml,.geojson,.json" class="uploadGpx srOnlyFile" data-tour="${t.id}" />
          </label>
          <span class="uploadStatus" data-tour="${t.id}"></span>
        </div>
      </div>
    `;
    toursList.appendChild(el);

    // Update translations for newly added elements
    if (window.i18n) window.i18n.updateTexts();

    // Shared button click - show members popup
    const sharedBtn = el.querySelector('.tourSharedBtn');
    const membersPopup = el.querySelector('.tourMembersPopup');
    if (sharedBtn && membersPopup) {
      sharedBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        // Toggle popup
        const wasHidden = membersPopup.classList.contains('is-hidden');
        
        // Close all other popups first
        document.querySelectorAll('.tourMembersPopup').forEach(p => p.classList.add('is-hidden'));
        
        if (wasHidden) {
          membersPopup.classList.remove('is-hidden');
          
          // Load members
          const membersList = membersPopup.querySelector('.tourMembersPopupList');
          membersList.innerHTML = 'Loading...';
          
          const { data: members, error } = await supabase.rpc('get_tour_members', { p_tour_id: t.id });
          
          if (error) {
            membersList.innerHTML = 'Error loading members';
          } else if (!members || members.length === 0) {
            membersList.innerHTML = 'No members';
          } else {
            membersList.innerHTML = members.map(m => `
              <div class="tourMemberItem">
                <span class="tourMemberEmail">${m.email}</span>
                <span class="tourMemberRole">${m.role === 'editor' ? 'Editor' : 'Viewer'}</span>
              </div>
            `).join('');
          }
        }
      });
      
      // Close popup when clicking outside
      document.addEventListener('click', (e) => {
        if (!membersPopup.contains(e.target) && !sharedBtn.contains(e.target)) {
          membersPopup.classList.add('is-hidden');
        }
      });
    }

    // header click toggles collapse/expand
    const header = el.querySelector('.tourHeader');
    const content = el.querySelector('.tourContent');
    header.style.cursor = 'pointer';
    header.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('tourDeleteBtn') || ev.target.classList.contains('tourColorPicker')) return;
      const willHide = !content.classList.contains('is-hidden');
      
      if (willHide) {
        // Closing this tour
        content.classList.add('is-hidden');
        hideTracksForTour(t.id);
      } else {
        // Opening this tour - close all other tours first
        closeAllToursExcept(t.id);
        content.classList.remove('is-hidden');
        autoShowAllTracks(t.id);
      }
    });

    // ...kein globaler Colorpicker mehr...

    // auto-upload on file selection
    const uploadInput = el.querySelector('.uploadGpx');
    const statusSpan = el.querySelector('.uploadStatus');
    uploadInput.addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      
      // open tour if it was closed
      content.classList.remove('is-hidden');
      
      statusSpan.textContent = window.i18n ? window.i18n.getTranslation('uploading') : 'Uploading...';
      statusSpan.style.color = 'blue';
      try {
        await handleFileUpload(file, t.id, t.isOwner);
        statusSpan.textContent = window.i18n ? '✓ ' + window.i18n.getTranslation('uploaded') : '✓ Uploaded';
        statusSpan.style.color = 'green';
        setTimeout(() => { statusSpan.textContent = ''; }, 3000);
      } catch (e) {
        statusSpan.textContent = window.i18n ? '✗ ' + window.i18n.getTranslation('uploadFailed') + ': ' + (e.message || window.i18n.getTranslation('unknownError')) : '✗ Failed: ' + (e.message || 'Unknown error');
        statusSpan.style.color = 'red';
      }
      uploadInput.value = '';
    });

    // Drei-Punkte-Menü für Tour-Header (global close + single open)
    const tourMenuBtn = el.querySelector('.tourMenuBtn');
    const tourMenu = el.querySelector('.tourMenu');
    tourMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = tourMenuBtn.getAttribute('aria-expanded') === 'true';
      closeAllContextMenus();
      if (!expanded) {
        tourMenu.classList.remove('is-hidden');
        tourMenuBtn.setAttribute('aria-expanded', 'true');
      }
    });
    document.addEventListener('click', (e) => {
      if (!el.contains(e.target)) {
        closeAllContextMenus();
      }
    });
    
    // Rename im Menü (nur für Owner)
    const renameMenuItem = tourMenu.querySelector('.tourMenuRename');
    const tourTitleEl = el.querySelector('.tourTitle');
    if (renameMenuItem && tourTitleEl) {
      renameMenuItem.addEventListener('click', async () => {
        tourMenu.classList.add('is-hidden');
        tourMenuBtn.setAttribute('aria-expanded', 'false');
        
        // Enter edit mode
        tourTitleEl.contentEditable = 'true';
        tourTitleEl.setAttribute('data-editable', 'true');
        tourTitleEl.focus();
        
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(tourTitleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        
        const saveRename = async () => {
          tourTitleEl.contentEditable = 'false';
          tourTitleEl.setAttribute('data-editable', 'false');
          const newName = tourTitleEl.textContent.trim();
          if (newName && newName !== t.title) {
            const { error } = await supabase.from('tours').update({ title: newName }).eq('id', t.id);
            if (error) {
              await showAlert({ title: window.i18n.getTranslation('renameFailed'), message: error.message, icon: '❌', variant: 'danger' });
              tourTitleEl.textContent = t.title; // Revert
              return;
            }
            t.title = newName;
            // Update share menu item data attribute
            const shareItem = tourMenu.querySelector('.tourMenuShare');
            if (shareItem) shareItem.dataset.title = newName;
          } else if (!newName) {
            tourTitleEl.textContent = t.title; // Revert if empty
          }
        };
        
        tourTitleEl.addEventListener('blur', saveRename, { once: true });
        tourTitleEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            tourTitleEl.blur();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            tourTitleEl.textContent = t.title;
            tourTitleEl.blur();
          }
        }, { once: true });
      });
    }
    
    // Löschen im Menü (nur für Owner)
    const deleteMenuItem = tourMenu.querySelector('.tourMenuDelete');
    if (deleteMenuItem) {
      deleteMenuItem.addEventListener('click', async () => {
        tourMenu.classList.add('is-hidden');
        tourMenuBtn.setAttribute('aria-expanded', 'false');
        
        // Get member count to warn owner
        const { data: memberCount } = await supabase.rpc('get_tour_member_count', { p_tour_id: t.id });
        
        let confirmMsg = window.i18n.getTranslation('deleteTourConfirm').replace('{title}', t.title);
        let confirmIcon = '🗑️';
        if (memberCount && memberCount > 0) {
          confirmMsg = window.i18n.getTranslation('deleteTourConfirmShared')
            .replace('{title}', t.title)
            .replace('{count}', memberCount)
            .replace('{plural}', memberCount > 1 ? (window.i18n.currentLanguage === 'de' ? 'en' : 's') : '');
          confirmIcon = '⚠️';
        }
        
        const confirmed = await showConfirm({
          title: window.i18n.getTranslation('deleteTour'),
          message: confirmMsg,
          icon: confirmIcon,
          variant: 'danger',
          confirmText: window.i18n.getTranslation('delete'),
          confirmStyle: 'danger'
        });
        if (!confirmed) return;
        const { error } = await supabase.from('tours').delete().eq('id', t.id);
        if (error) {
          statusSpan.textContent = window.i18n ? '✗ ' + window.i18n.getTranslation('deleteFailedStatus') + ': ' + error.message : '✗ Delete failed: ' + error.message;
          statusSpan.style.color = 'red';
          return;
        }
        loadMyTours();
      });
    }

    // Tour verlassen im Menü (nur für Members)
    const leaveMenuItem = tourMenu.querySelector('.tourMenuLeave');
    if (leaveMenuItem) {
      leaveMenuItem.addEventListener('click', async () => {
        tourMenu.classList.add('is-hidden');
        tourMenuBtn.setAttribute('aria-expanded', 'false');
        
        const confirmed = await showConfirm({
          title: window.i18n.getTranslation('leaveTourTitle'),
          message: window.i18n.getTranslation('leaveTourConfirm').replace('{title}', t.title),
          icon: '🚪',
          variant: 'warning',
          confirmText: window.i18n.getTranslation('leaveTour'),
          confirmStyle: 'danger'
        });
        if (!confirmed) return;
        
        try {
          const { error } = await supabase.rpc('leave_tour', { p_tour_id: t.id });
          if (error) {
            console.error('Leave tour error:', error);
            await showAlert({
              title: window.i18n.getTranslation('leaveFailed'),
              message: error.message,
              icon: '❌',
              variant: 'danger'
            });
            return;
          }
          loadMyTours();
        } catch (e) {
          console.error('Leave tour exception:', e);
          await showAlert({
            title: window.i18n.getTranslation('leaveFailed'),
            message: e.message || window.i18n.getTranslation('unknownError'),
            icon: '❌',
            variant: 'danger'
          });
        }
      });
    }

    // Teilen im Menü - öffnet Modal (nur für Owner)
    const shareMenuItem = tourMenu.querySelector('.tourMenuShare');
    if (shareMenuItem) {
      shareMenuItem.addEventListener('click', () => {
        tourMenu.classList.add('is-hidden');
        tourMenuBtn.setAttribute('aria-expanded', 'false');
        openShareModal(t.id, t.title);
      });
    }

    // load tracks for this tour, then auto-show if tour is open
    loadTracksForTour(t.id, t.isOwner).then(() => {
      // If this tour is open (new tour), close others and show its tracks
      if (!content.classList.contains('is-hidden')) {
        closeAllToursExcept(t.id);
        autoShowAllTracks(t.id);
      }
    });
  }
  } catch (err) {
    console.error('Error in loadMyTours:', err);
    toursList.innerHTML = `<div style="color: red;">${window.i18n.getTranslation('errorLoadingTours')} ${err.message || window.i18n.getTranslation('unknownError')}</div>`;
  }
}

async function loadTracksForTour(tourId, isTourOwner = false) {
  const container = document.getElementById(`tracks-${tourId}`);
  container.innerHTML = window.i18n ? window.i18n.getTranslation('loading') : 'Loading...';
  // get tracks for user and filter by tour
  const { data, error } = await supabase.rpc('get_tracks_for_user');
  if (error) { container.innerHTML = window.i18n ? window.i18n.getTranslation('errorLoadingTracks') : 'Error loading tracks'; return }
  const tracks = (data || []).filter(r => r.tour_id === tourId);
  if (!tracks.length) { container.innerHTML = `<div>${window.i18n ? window.i18n.getTranslation('noTracks') : 'No tracks'}</div>`; return }
  container.innerHTML = '';
  // Get current user ID to check track ownership
  const currentUserId = (await supabase.auth.getUser())?.data?.user?.id;
  for (const tr of tracks) {
    const row = document.createElement('div');
    row.className = 'trackRow';
    const trackName = tr.name || new Date(tr.created_at).toLocaleString();
    // Default color for track (use property or fallback to tour color)
    const defaultColor = tr.color || pickColorForTourHex(tr.id);
    // Permission: can delete if tour owner OR track creator
    const canDelete = isTourOwner || (tr.user_id === currentUserId);
    // Permission: can edit only if track creator
    const canEdit = (tr.user_id === currentUserId);
    row.innerHTML = `
      <div class="trackRowContent">
        <label><input type="checkbox" class="trackToggle" data-track="${tr.id}" /> <span class="trackName" data-track="${tr.id}" data-editable="false">${trackName}</span></label>
        <div class="trackRowIcons">
          <button class="iconBtn trackColorBtn" data-track="${tr.id}" title="Choose color">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.08-.1-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z" fill="${defaultColor}" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="7.5" cy="11.5" r="1.5" fill="#ef4444"/>
              <circle cx="11" cy="7.5" r="1.5" fill="#eab308"/>
              <circle cx="15" cy="8.5" r="1.5" fill="#22c55e"/>
              <circle cx="17" cy="12" r="1.5" fill="#3b82f6"/>
            </svg>
          </button>
          <input type="color" class="trackColorPicker srColorInput" data-track="${tr.id}" value="${defaultColor}" aria-label="Select track color" />
          <div class="trackMenuWrap">
            <button class="iconBtn trackMenuBtn" data-track="${tr.id}" title="${window.i18n ? window.i18n.getTranslation('moreOptions') : 'More options'}" aria-haspopup="true" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            <ul class="trackMenu is-hidden" data-track="${tr.id}">
              <li class="trackMenuDownload" data-track="${tr.id}" data-original="${tr.original_file_path || ''}" data-i18n="downloadGpx">Download GPX</li>
              ${canEdit ? `<li class="trackMenuEdit" data-track="${tr.id}" data-i18n="edit">Edit</li>` : ''}
              <li class="trackMenuCenter" data-track="${tr.id}" data-i18n="center">Center</li>
              ${canDelete ? `<li class="trackMenuDelete" data-track="${tr.id}" data-i18n="delete">Delete</li>` : ''}
            </ul>
          </div>
        </div>
      </div>
    `;
    container.appendChild(row);

    // track toggle handler
    const cb = row.querySelector('.trackToggle');
    const colorBtn = row.querySelector('.trackColorBtn');
    const colorInput = row.querySelector('.trackColorPicker');
    let currentColor = defaultColor;
    colorBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const rect = colorBtn.getBoundingClientRect();
      // Positioniere den unsichtbaren Input direkt unter dem Icon, damit der native Picker dort aufgeht
      colorInput.style.position = 'fixed';
      colorInput.style.left = `${rect.left}px`;
      colorInput.style.top = `${rect.bottom + 4}px`;
      colorInput.style.width = `${rect.width}px`;
      colorInput.style.height = `${rect.height}px`;
      colorInput.click();
    });
    colorInput.addEventListener('input', () => {
      currentColor = colorInput.value;
      // Update the palette background (the path element)
      colorBtn.querySelector('path').setAttribute('fill', currentColor);
      const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
      if (ds) {
        ds.entities.values.forEach(ent => {
          if (ent.polyline) {
            ent.polyline.material = Cesium.Color.fromCssColorString(currentColor).withAlpha(0.95);
          }
        });
      }
    });

    cb.addEventListener('change', async (e) => {
      if (e.target.checked) {
        // Check if already loaded (avoid duplicates)
        let ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
        if (!ds) {
          // add to cesium (2D draped)
          const geoJson = typeof tr.geo === 'string' ? JSON.parse(tr.geo) : tr.geo;
          
          // Auto-detect region from track coordinates and switch if needed
          // Skip if already handled at tour level (e.skipRegionSwitch)
          if (!e.skipRegionSwitch) {
            const trackRegion = detectRegionFromGeoJson(geoJson);
            if (trackRegion && trackRegion !== currentRegionCode) {
              switchRegion(trackRegion);
              populateRegionSelect(); // Update dropdown UI
            }
          }
          
          ds = await Cesium.GeoJsonDataSource.load(geoJson);
          ds.name = `track-${tr.id}`;
          viewer.dataSources.add(ds);
          // color by track
          const color = Cesium.Color.fromCssColorString(colorInput.value || currentColor).withAlpha(0.95);
          ds.entities.values.forEach(ent => {
            if (ent.polyline) {
              ent.polyline.material = color;
              ent.polyline.width = 6;
              ent.polyline.clampToGround = true;
              ent.properties = ent.properties || {};
              ent.properties.trackId = tr.id;
            }
          });
          // Only zoom if this is a single track toggle (not batch), check via custom flag
          if (!e.skipZoom) {
            zoomToTrack(ds, tr.id);
          }
        }
      } else {
        // remove dataSource by name
        const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
        if (ds) viewer.dataSources.remove(ds, true);
      }
    });

    // Drei-Punkte-Menü (trackMenuBtn) Logik (global close + single open)
    const menuBtn = row.querySelector('.trackMenuBtn');
    const menu = row.querySelector('.trackMenu');
    const nameSpan = row.querySelector('.trackName');
    // Toggle menu
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = menuBtn.getAttribute('aria-expanded') === 'true';
      closeAllContextMenus();
      if (!expanded) {
        menu.classList.remove('is-hidden');
        menuBtn.setAttribute('aria-expanded', 'true');
      }
    });
    // Close menu on click outside
    document.addEventListener('click', (e) => {
      if (!row.contains(e.target)) {
        closeAllContextMenus();
      }
    });
    // Download GPX
    menu.querySelector('.trackMenuDownload').addEventListener('click', async () => {
      menu.classList.add('is-hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      
      const originalPath = menu.querySelector('.trackMenuDownload').dataset.original;
      const trackName = tr.name || 'track';
      const fileName = `${trackName.replace(/[^a-zA-Z0-9_-]/g, '_')}.gpx`;
      
      try {
        let gpxContent;
        
        if (originalPath) {
          // Download original file from storage
          const { data, error } = await supabase.storage
            .from('tracks')
            .download(originalPath);
          
          if (error) throw error;
          gpxContent = await data.text();
        } else {
          // Generate GPX from stored geometry via RPC
          const { data, error } = await supabase.rpc('get_track_as_gpx', { p_track_id: tr.id });
          if (error) throw error;
          gpxContent = data;
        }
        
        // Trigger download
        const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('Download failed:', e);
        await showAlert({
          title: window.i18n.getTranslation('downloadFailed'),
          message: e.message || window.i18n.getTranslation('unknownError'),
          icon: '❌',
          variant: 'danger'
        });
      }
    });
    // Editieren (only if canEdit)
    const editMenuItem = menu.querySelector('.trackMenuEdit');
    if (editMenuItem) {
      editMenuItem.addEventListener('click', async () => {
        menu.classList.add('is-hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
        const isEditing = nameSpan.getAttribute('data-editable') === 'true';
        if (isEditing) {
          // save
          const newName = nameSpan.textContent.trim();
          if (newName) {
            const { error } = await supabase.from('tour_tracks').update({ name: newName }).eq('id', tr.id);
            if (error) {
              await showAlert({ title: window.i18n.getTranslation('saveFailed'), message: error.message, icon: '❌', variant: 'danger' });
              return;
            }
            tr.name = newName;
          }
          nameSpan.contentEditable = 'false';
          nameSpan.setAttribute('data-editable', 'false');
        } else {
          // enter edit mode
          nameSpan.contentEditable = 'true';
          nameSpan.setAttribute('data-editable', 'true');
          nameSpan.focus();
          // Save on blur or enter
          const saveEdit = async () => {
            nameSpan.contentEditable = 'false';
            nameSpan.setAttribute('data-editable', 'false');
            const newName = nameSpan.textContent.trim();
            if (newName && newName !== tr.name) {
              const { error } = await supabase.from('tour_tracks').update({ name: newName }).eq('id', tr.id);
              if (error) {
                await showAlert({ title: window.i18n.getTranslation('saveFailed'), message: error.message, icon: '❌', variant: 'danger' });
                return;
              }
              tr.name = newName;
            }
          };
          nameSpan.addEventListener('blur', saveEdit, { once: true });
          nameSpan.addEventListener('keydown', async (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              nameSpan.blur();
            }
          }, { once: true });
        }
      });
    }
    // Zentrieren
    menu.querySelector('.trackMenuCenter').addEventListener('click', () => {
      menu.classList.add('is-hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      // Center on track (smart zoom)
      const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
      if (ds) zoomToTrack(ds, tr.id);
    });
    // Löschen (only if canDelete)
    const deleteMenuItem = menu.querySelector('.trackMenuDelete');
    if (deleteMenuItem) {
      deleteMenuItem.addEventListener('click', async () => {
        menu.classList.add('is-hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
        
        const confirmed = await showConfirm({
          title: window.i18n.getTranslation('deleteTrack'),
          message: window.i18n.getTranslation('deleteTrackConfirm').replace('{name}', tr.name || 'Unnamed'),
          icon: '🗑️',
          variant: 'danger',
          confirmText: window.i18n.getTranslation('delete'),
          confirmStyle: 'danger'
        });
        if (!confirmed) return;
        
        // Delete original file from storage if it exists
        const originalPath = tr.original_file_path;
        if (originalPath) {
          const { error: storageError } = await supabase.storage
            .from('tracks')
            .remove([originalPath]);
          if (storageError) {
            console.warn('Could not delete original file from storage:', storageError);
            // Continue with DB deletion anyway
          }
        }
        
        const { error } = await supabase.from('tour_tracks').delete().eq('id', tr.id);
        if (error) {
          await showAlert({ title: window.i18n.getTranslation('deleteFailed'), message: error.message, icon: '❌', variant: 'danger' });
          return;
        }
        // remove from map
        const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
        if (ds) viewer.dataSources.remove(ds, true);
        // refresh list
        loadTracksForTour(tourId, isTourOwner);
      });
    }
  }

  // Update translations for newly added track elements
  if (window.i18n) window.i18n.updateTexts();
}

async function toggleShowAllTracksForTour(tourId) {
  // if any track is currently shown, remove them; otherwise show all
  const existing = viewer.dataSources._dataSources.filter(ds => ds.name && ds.name.startsWith('track-'));
  const anyForTour = existing.some(ds => {
    const id = ds.name.split('track-')[1];
    // we need to compare tourId from data source? We'll check if track entries for this tour exist in DB when showing.
    return false;
  });
  // Always fetch tracks and then decide: if none of these tracks are shown, show them; otherwise remove them
  const { data, error } = await supabase.rpc('get_tracks_for_user');
  if (error) {
    await showAlert({ title: window.i18n.getTranslation('loadFailed'), message: window.i18n.getTranslation('couldNotLoadTracks') + error.message, icon: '❌', variant: 'danger' });
    return;
  }
  const tracks = (data || []).filter(r => r.tour_id === tourId);
  if (!tracks.length) return;
  // check if at least one track for this tour is loaded
  const loaded = tracks.some(tr => viewer.dataSources.getByName(`track-${tr.id}`)[0]);
  if (loaded) {
    // remove all for tour
    for (const tr of tracks) {
      const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
      if (ds) viewer.dataSources.remove(ds, true);
      // uncheck checkbox if present
      const cb = document.querySelector(`.trackToggle[data-track='${tr.id}']`);
      if (cb) cb.checked = false;
    }
  } else {
    // add all
    for (const tr of tracks) {
      const geoJson = typeof tr.geo === 'string' ? JSON.parse(tr.geo) : tr.geo;
      const ds = await Cesium.GeoJsonDataSource.load(geoJson);
      ds.name = `track-${tr.id}`;
      viewer.dataSources.add(ds);
      const color = Cesium.Color.fromCssColorString(pickColorForTour(tourId)).withAlpha(1.0);
      ds.entities.values.forEach(ent => { if (ent.polyline) { ent.polyline.material = color; ent.polyline.width = 4; } });
      const cb = document.querySelector(`.trackToggle[data-track='${tr.id}']`);
      if (cb) cb.checked = true;
    }
  }
}

// Close all tours except the specified one and hide their tracks
function closeAllToursExcept(exceptTourId) {
  const allTourContents = document.querySelectorAll('.tourContent');
  allTourContents.forEach(content => {
    const tourId = content.id.replace('content-', '');
    if (tourId !== exceptTourId && !content.classList.contains('is-hidden')) {
      content.classList.add('is-hidden');
      hideTracksForTour(tourId);
    }
  });
}

// Hide all tracks from the map (used when switching tours)
function hideAllTracks() {
  const allDataSources = [...(viewer.dataSources._dataSources || [])];
  for (const ds of allDataSources) {
    if (ds.name && ds.name.startsWith('track-')) {
      viewer.dataSources.remove(ds, true);
    }
  }
  // Uncheck all track checkboxes
  document.querySelectorAll('.trackToggle').forEach(cb => {
    cb.checked = false;
  });
}

function pickColorForTour(tourId) {
  // deterministic color by id hash - bright, saturated colors that stand out from terrain
  let h = 0; for (let i=0;i<tourId.length;i++) h = (h<<5)-h + tourId.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 85%, 55%)`;
}

function hideTracksForTour(tourId) {
  const container = document.getElementById(`tracks-${tourId}`);
  if (!container) return;
  const checkboxes = container.querySelectorAll('.trackToggle');
  checkboxes.forEach(cb => {
    const trackId = cb.dataset.track;
    cb.checked = false;
    const ds = viewer.dataSources.getByName(`track-${trackId}`)[0];
    if (ds) viewer.dataSources.remove(ds, true);
  });
}

function pickColorForTourHex(tourId) {
  // Convert HSL to Hex for color picker
  const hslStr = pickColorForTour(tourId);
  const match = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return '#3563eb';
  const h = parseInt(match[1]) / 360;
  const s = parseInt(match[2]) / 100;
  const l = parseInt(match[3]) / 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  
  let r, g, b;
  if (h < 1/6) { r = c; g = x; b = 0; }
  else if (h < 2/6) { r = x; g = c; b = 0; }
  else if (h < 3/6) { r = 0; g = c; b = x; }
  else if (h < 4/6) { r = 0; g = x; b = c; }
  else if (h < 5/6) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  
  const toHex = (val) => {
    const hex = Math.round((val + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function updateTracksColor(tourId, hexColor) {
  // Update all visible tracks for this tour with new color - directly on the map
  try {
    // Get all dataSources that belong to this tour
    const allDataSources = viewer.dataSources._dataSources || [];
    
    for (const ds of allDataSources) {
      if (!ds.name || !ds.name.startsWith('track-')) continue;
      
      // Check if any entity in this datasource belongs to this tour
      const tourEntities = ds.entities.values.filter(e => 
        e.properties && e.properties.tourId === tourId && e.polyline
      );
      
      if (tourEntities.length > 0) {
        const color = Cesium.Color.fromCssColorString(hexColor).withAlpha(0.95);
        tourEntities.forEach(ent => {
          if (ent.polyline) {
            ent.polyline.material = color;
          }
        });
      }
    }
  } catch (e) {
    console.warn('Error updating track color:', e);
  }
}

async function autoShowAllTracks(tourId) {
  // Auto-check all tracks for this tour
  const container = document.getElementById(`tracks-${tourId}`);
  if (!container) return;
  
  const checkboxes = container.querySelectorAll('.trackToggle');
  let anyNewlyShown = false;
  
  // Before loading tracks, detect region from first track and switch if needed
  if (checkboxes.length > 0) {
    const firstTrackId = checkboxes[0].dataset.track;
    await detectAndSwitchRegionForTour(tourId, firstTrackId);
  }
  
  for (const cb of checkboxes) {
    if (!cb.checked) {
      cb.checked = true;
      // Create event with skipZoom flag to avoid zooming on each track
      const event = new Event('change');
      event.skipZoom = true;
      event.skipRegionSwitch = true; // Skip region detection since we already did it
      cb.dispatchEvent(event);
      anyNewlyShown = true;
    }
  }
  
  // If any tracks were newly shown, zoom to fit all visible tracks for this tour
  if (anyNewlyShown) {
    // Small delay to let all dataSources load
    await new Promise(r => setTimeout(r, 100));
    zoomToAllVisibleTracks(tourId);
  }
}

// Detect region from track data and switch if tour is in a different region
async function detectAndSwitchRegionForTour(tourId, trackId) {
  try {
    // Get track stats which include coordinates
    const { data: stats, error } = await supabase.rpc('get_track_view_stats', { p_track_id: trackId });
    if (error || !stats) return;
    
    // Detect region from center coordinates
    const detectedRegion = detectRegionByCoordinates(stats.center_lon, stats.center_lat);
    
    if (detectedRegion && detectedRegion !== currentRegionCode) {
      switchRegion(detectedRegion);
      populateRegionSelect(); // Update dropdown UI
    }
  } catch (err) {
    console.warn('Could not auto-detect region for tour:', err);
  }
}

// Intelligent zoom to track using PostGIS-computed statistics
async function zoomToTrackSmart(trackId) {
  try {
    const { data: stats, error } = await supabase.rpc('get_track_view_stats', { p_track_id: trackId });
    if (error || !stats) {
      console.warn('Could not get track stats, using fallback zoom');
      return false;
    }

    const bbox = stats.bbox;
    const azimuth = stats.azimuth_deg || 0;
    const lengthM = stats.length_m || 1000;
    
    // Calculate center point of track
    const centerLon = stats.center_lon;
    const centerLat = stats.center_lat;
    const centerEle = ((bbox.min_ele || 0) + (bbox.max_ele || 0)) / 2;
    
    // Detect region from center coordinates and switch if necessary
    const detectedRegion = detectRegionByCoordinates(centerLon, centerLat);
    if (detectedRegion && detectedRegion !== currentRegionCode) {
      await switchRegion(detectedRegion);
      populateRegionSelect(); // Update dropdown UI
    }
    
    // Create center position
    const centerPosition = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerEle);
    
    // Calculate camera distance (range) based on track length
    // Longer tracks need more distance to see the whole track
    const range = Math.max(lengthM * 0.8, 500);
    
    // Camera heading: Look ALONG the track direction
    // Cesium heading: 0 = North, positive = clockwise
    // PostGIS azimuth: 0 = North, positive = clockwise (same!)
    // We want to look FROM the side, so perpendicular to track (+90°)
    const heading = Cesium.Math.toRadians((azimuth + 90) % 360);
    
    // Camera pitch: Looking down at the track from above
    // -90° = straight down, 0 = horizontal
    // Use around -45° to -60° for a good 3D view
    const pitch = Cesium.Math.toRadians(-50);
    
    // Create bounding sphere around track center
    const boundingSphere = new Cesium.BoundingSphere(centerPosition, range * 0.5);
    
    // Fly to bounding sphere with heading/pitch/range offset
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 1.8,
      offset: new Cesium.HeadingPitchRange(heading, pitch, range)
    });
    
    return true;
  } catch (e) {
    console.warn('Smart zoom failed:', e);
    return false;
  }
}

function zoomToTrack(dataSource, trackId) {
  // Try smart zoom first if we have a trackId
  if (trackId) {
    zoomToTrackSmart(trackId).then(success => {
      if (!success) {
        zoomToTrackFallback(dataSource);
      }
    });
    return;
  }
  
  // Fallback to bounding box zoom
  zoomToTrackFallback(dataSource);
}

function zoomToTrackFallback(dataSource) {
  // Calculate bounding sphere for all polylines in datasource
  if (!dataSource || !dataSource.entities) return;
  
  const polylineEnts = dataSource.entities.values.filter(e => e.polyline);
  if (polylineEnts.length === 0) return;
  
  try {
    // Get all positions from polylines
    const positions = [];
    polylineEnts.forEach(ent => {
      if (ent.polyline && ent.polyline.positions) {
        const linePositions = ent.polyline.positions.getValue(Cesium.JulianDate.now());
        if (linePositions && Array.isArray(linePositions)) {
          positions.push(...linePositions);
        }
      }
    });
    
    if (positions.length === 0) {
      console.warn('No positions found in polylines');
      return;
    }
    // Try rectangle flyTo for better centering and less zoom
    try {
      const cartos = positions.map(p => Cesium.Cartographic.fromCartesian(p));
      const rect = Cesium.Rectangle.fromCartographicArray(cartos);
      if (rect) {
        const width = rect.east - rect.west;
        const height = rect.north - rect.south;
        const padLon = Math.max(width * 0.15, Cesium.Math.toRadians(0.002));
        const padLat = Math.max(height * 0.15, Cesium.Math.toRadians(0.002));
        const padded = new Cesium.Rectangle(
          rect.west - padLon,
          rect.south - padLat,
          rect.east + padLon,
          rect.north + padLat
        );
        viewer.scene.camera.flyTo({
          destination: padded,
          duration: 1.6,
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-50),
            roll: 0
          }
        });
        return;
      }
    } catch (err) {
      console.warn('Rectangle flyTo failed, fallback to sphere', err);
    }

    // Fallback: bounding sphere with gentler zoom and flat heading
    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
    if (boundingSphere) {
      const range = Math.max(boundingSphere.radius * 5.0, 800);
      viewer.scene.camera.flyToBoundingSphere(boundingSphere, {
        duration: 1.6,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-50),
          range
        )
      });
    }
  } catch (e) {
    console.warn('Zoom to track failed:', e);
  }
}

// Zoom to fit all visible tracks for a tour - uses same behavior as clicking the first (topmost) track
function zoomToAllVisibleTracks(tourId) {
  const container = document.getElementById(`tracks-${tourId}`);
  if (!container) return;
  
  const checkboxes = container.querySelectorAll('.trackToggle:checked');
  if (checkboxes.length === 0) return;
  
  // Use the first (topmost) visible track for zoom behavior
  const firstTrackId = checkboxes[0].dataset.track;
  const ds = viewer.dataSources.getByName(`track-${firstTrackId}`)[0];
  
  // Zoom to the first track - this gives the same behavior as clicking on that track
  if (ds) {
    zoomToTrack(ds, firstTrackId);
  } else {
    // Fallback: just use smart zoom with trackId
    zoomToTrackSmart(firstTrackId);
  }
}

// New tour form
newTourForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = newTourTitleInput.value.trim();
  if (!title) {
    await showAlert({ title: window.i18n.getTranslation('missingName'), message: window.i18n.getTranslation('pleaseProvideTourName'), icon: '✏️', variant: 'warning' });
    return;
  }
  const user = await currentUser();
  if (!user) {
    await showAlert({ title: window.i18n.getTranslation('loginRequired'), message: window.i18n.getTranslation('pleaseLoginToCreate'), icon: '🔒', variant: 'warning' });
    return;
  }
  const slug = generateTourSlug();
  const { data, error } = await supabase.from('tours').insert([{ title, slug, owner_id: user.id }]).select();
  if (error) {
    await showAlert({ title: window.i18n.getTranslation('createFailed'), message: error.message, icon: '❌', variant: 'danger' });
    return;
  }
  hideCreateTourForm();
  loadMyTours();
});

// parse file to GeoJSON (handles GPX, KML, GeoJSON) and extract valid LineString geometry
async function parseFileToGeoJSON(file) {
  const name = (file.name || '').toLowerCase();
  let geojson = null;
  
  try {
    const text = await file.text();
    
    if (name.endsWith('.gpx')) {
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'application/xml');
      geojson = togeojsonGpx(xml);
    } else if (name.endsWith('.kml')) {
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'application/xml');
      geojson = togeojsonKml(xml);
    } else if (name.endsWith('.geojson') || name.endsWith('.json')) {
      geojson = JSON.parse(text);
    } else {
      // fallback: try JSON first, then XML
      try {
        geojson = JSON.parse(text);
      } catch (e) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'application/xml');
        geojson = togeojsonKml(xml) || togeojsonGpx(xml);
      }
    }
    
    // ensure we have valid geojson
    if (!geojson || typeof geojson !== 'object') return null;
    
    // extract and collect all LineString/Polygon geometries
    let features = [];
    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      features = geojson.features;
    } else if (geojson.type === 'Feature') {
      features = [geojson];
    } else if (['LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(geojson.type)) {
      // raw geometry
      features = [{ type: 'Feature', properties: {}, geometry: geojson }];
    }
    
    // filter features: keep only those with valid LineString/Polygon geometries
    const validFeatures = features.filter(f => {
      if (f.type !== 'Feature' || !f.geometry) return false;
      const gtype = f.geometry.type;
      return ['LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(gtype);
    });
    
    if (validFeatures.length === 0) {
      console.error('No valid LineString/Polygon geometries found');
      return null;
    }
    
    // return as FeatureCollection with only valid geometries
    return {
      type: 'FeatureCollection',
      features: validFeatures
    };
  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

async function handleFileUpload(file, tourId, isTourOwner = false) {
  if (!file) throw new Error('No file provided');
  
  const geojson = await parseFileToGeoJSON(file);
  if (!geojson) throw new Error('Could not parse file. Supported: GPX, KML, GeoJSON');
  
  // track name defaults to file name without extension
  const trackName = file.name.replace(/\.[^/.]+$/, "");
  
  // Upload original file to storage (if it's GPX or KML, preserve it)
  let originalFilePath = null;
  const fileExt = file.name.split('.').pop().toLowerCase();
  if (['gpx', 'kml'].includes(fileExt)) {
    const user = await currentUser();
    const storagePath = `${user.id}/${tourId}/${Date.now()}_${file.name}`;
    
    const { error: uploadError } = await supabase.storage
      .from('tracks')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      });
    
    if (!uploadError) {
      originalFilePath = storagePath;
    } else {
      console.warn('Could not store original file:', uploadError.message);
      // Continue without original - GPX can be generated from geometry
    }
  }
  
  const { data, error } = await supabase.rpc('insert_tour_track', { 
    p_tour_id: tourId, 
    p_props: {}, 
    p_geojson: geojson, 
    p_track_name: trackName,
    p_original_file_path: originalFilePath
  });
  if (error) throw new Error('Upload failed: ' + error.message);
  
  const insertedId = (Array.isArray(data) && data[0]) ? data[0] : data;
  
  // fetch the inserted track using RPC to get GeoJSON
  const { data: tracks, error: e2 } = await supabase.rpc('get_tracks_for_user');
  if (e2 || !tracks) throw new Error('Could not fetch uploaded track');
  
  const trackData = tracks.find(t => t.id === insertedId);
  if (!trackData) throw new Error('Uploaded track not found in list');
  
  // refresh tracks list to show new track
  await loadTracksForTour(tourId, isTourOwner);
  
  // activate the new track's checkbox (this will add to Cesium and zoom)
  const newCb = document.querySelector(`.trackToggle[data-track="${trackData.id}"]`);
  if (newCb && !newCb.checked) {
    newCb.checked = true;
    newCb.dispatchEvent(new Event('change')); // This will zoom to the track
  }
}

// Initialize authentication UI
initAuthUI()

// Initial zoom after terrain finished
let initialZoomPerformed = false;
viewer.scene.globe.preloadSiblings = true;

viewer.scene.globe.tileLoadProgressEvent.addEventListener((current) => {
  if (!initialZoomPerformed && current === 0) {
    initialZoomPerformed = true;
    flyToRegion(viewer, getRegion(currentRegionCode).initialView);
  }
});


// =========================
// Share Modal Logic
// =========================
const shareModal = document.getElementById('shareModal');
const shareModalEmails = document.getElementById('shareModalEmails');
const shareModalResults = document.getElementById('shareModalResults');
const shareModalSubmit = document.getElementById('shareModalSubmit');
const shareModalCancel = document.getElementById('shareModalCancel');
const shareModalClose = document.querySelector('.shareModalClose');
const shareModalBackdrop = document.querySelector('.shareModalBackdrop');

let currentShareTourId = null;
let currentShareTourTitle = '';

function openShareModal(tourId, tourTitle) {
  currentShareTourId = tourId;
  currentShareTourTitle = tourTitle;
  shareModalEmails.value = '';
  shareModalResults.innerHTML = '';
  shareModal.classList.remove('is-hidden');
  shareModalEmails.focus();
}

function closeShareModal() {
  shareModal.classList.add('is-hidden');
  currentShareTourId = null;
  currentShareTourTitle = '';
}

// Parse emails from textarea (comma, semicolon, newline separated)
function parseEmails(text) {
  return text
    .split(/[\n,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0 && e.includes('@'));
}

// Send invitation email (mailto fallback)
function sendInvitationEmail(email, tourTitle) {
  const subject = encodeURIComponent(`Invitation: Tour "${tourTitle}" in 3D Viewer`);
  const body = encodeURIComponent(
    `Hello!\n\n` +
    `I would like to share the tour "${tourTitle}" with you.\n\n` +
    `Please register in the 3D Viewer and let me know so I can share the tour with your account.\n\n` +
    `Best regards`
  );
  window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
}

// Share with multiple emails
async function shareWithEmails() {
  const emails = parseEmails(shareModalEmails.value);
  
  if (emails.length === 0) {
    shareModalResults.innerHTML = `
      <div class="shareModalResult error">
        <span class="shareModalResultIcon">⚠️</span>
        <span class="shareModalResultText">Please enter at least one valid email address.</span>
      </div>
    `;
    return;
  }

  shareModalResults.innerHTML = '<div style="color: rgba(var(--color-text-rgb), 0.6); font-size: 13px;">Sharing tour...</div>';
  shareModalSubmit.disabled = true;

  const results = [];

  for (const email of emails) {
    const { error } = await supabase.rpc('share_tour_with_email', { 
      p_tour_id: currentShareTourId, 
      p_email: email 
    });

    if (error) {
      // Check if user not found
      const isUserNotFound = error.message.includes('not found') || error.message.includes('nicht gefunden');
      results.push({
        email,
        success: false,
        userNotFound: isUserNotFound,
        message: isUserNotFound 
          ? 'User not registered' 
          : error.message
      });
    } else {
      results.push({
        email,
        success: true,
        message: 'Shared successfully'
      });
    }
  }

  // Render results
  shareModalResults.innerHTML = results.map(r => {
    if (r.success) {
      return `
        <div class="shareModalResult success">
          <span class="shareModalResultIcon">✓</span>
          <span class="shareModalResultText"><strong>${r.email}</strong> – ${r.message}</span>
        </div>
      `;
    } else if (r.userNotFound) {
      return `
        <div class="shareModalResult invite">
          <span class="shareModalResultIcon">📧</span>
          <span class="shareModalResultText"><strong>${r.email}</strong> – ${r.message}</span>
          <button class="shareModalInviteBtn" data-email="${r.email}">Invite</button>
        </div>
      `;
    } else {
      return `
        <div class="shareModalResult error">
          <span class="shareModalResultIcon">✗</span>
          <span class="shareModalResultText"><strong>${r.email}</strong> – ${r.message}</span>
        </div>
      `;
    }
  }).join('');

  // Add event listeners for invite buttons
  shareModalResults.querySelectorAll('.shareModalInviteBtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const email = e.target.dataset.email;
      sendInvitationEmail(email, currentShareTourTitle);
      e.target.textContent = 'Mail opened';
      e.target.disabled = true;
    });
  });

  shareModalSubmit.disabled = false;

  // If at least one share was successful, close modal and refresh tours list
  const anySuccess = results.some(r => r.success);
  const allSuccess = results.every(r => r.success);
  
  if (allSuccess) {
    // All successful - close immediately and refresh
    shareModalEmails.value = '';
    closeShareModal();
    loadMyTours(); // Refresh to show shared icon
  } else if (anySuccess) {
    // Some successful - clear successful ones, keep modal open for failed ones
    shareModalEmails.value = results
      .filter(r => !r.success)
      .map(r => r.email)
      .join('\n');
    loadMyTours(); // Refresh to show shared icon
  }
}

// Event listeners for modal
shareModalSubmit.addEventListener('click', shareWithEmails);
shareModalCancel.addEventListener('click', closeShareModal);
shareModalClose.addEventListener('click', closeShareModal);
shareModalBackdrop.addEventListener('click', closeShareModal);

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !shareModal.classList.contains('is-hidden')) {
    closeShareModal();
  }
});

// Allow submitting with Enter (Ctrl+Enter for multiline)
shareModalEmails.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    shareWithEmails();
  }
});