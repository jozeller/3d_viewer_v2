import { layersConfig } from './layersConfig.js';
import { createViewer, initLayers, performInitialZoom } from './layerManager.js';
import { addLayersToLegend } from './addLayersToLegend.js';
import { initAuthUI } from './auth.js'
import { supabase } from './supabaseClient.js'
import { gpx as togeojsonGpx, kml as togeojsonKml } from '@tmcw/togeojson'
import './styles.css'

// helper: check if user is logged in and show/hide My Tours tab
async function updateAuthState() {
  const { data: { user } } = await supabase.auth.getUser();
  const navMyTours = document.getElementById('navMyTours');
  if (user) {
    navMyTours.classList.remove('is-hidden');
  } else {
    navMyTours.classList.add('is-hidden');
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

// check initial state on page load
document.addEventListener('DOMContentLoaded', updateAuthState);


// Create viewer (terrain, basic UI config)
const viewer = createViewer('cesiumContainer', 'invisibleCredits');

// Initial camera (Switzerland)
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(8.1355, 46.4754, 400000),
  orientation: {
    heading: Cesium.Math.toRadians(0),
    pitch: Cesium.Math.toRadians(-90),
    roll: 0
  }
});

// Init layers (adds only active layers, keeps references)
const layerState = initLayers(viewer, layersConfig);

// Legend UI binds to layerState operations
addLayersToLegend(layerState, viewer);

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

navLegend.addEventListener('click', showLegend);
navMyTours.addEventListener('click', showMyTours);

async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

async function loadMyTours() {
  toursList.innerHTML = 'Loading...';
  const user = await currentUser();
  if (!user) { toursList.innerHTML = 'Please login to see your tours.'; return }

  // owned tours
  const { data: owned, error: e1 } = await supabase
    .from('tours')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  // member tours
  const { data: memberships } = await supabase
    .from('tour_members')
    .select('tour_id')
    .eq('user_id', user.id);

  let memberTours = [];
  if (memberships && memberships.length) {
    const ids = memberships.map(m => m.tour_id).join(',');
    const { data } = await supabase.from('tours').select('*').in('id', memberships.map(m => m.tour_id));
    memberTours = data || [];
  }

  const all = [...(owned||[]), ...memberTours];
  if (!all.length) { toursList.innerHTML = '<div>No tours yet.</div>'; return }

  toursList.innerHTML = '';
  for (const t of all) {
    const el = document.createElement('div');
    el.className = 'tourItem';
    
    // new tours (just created, created within last 10s) should be auto-open
    const isNew = Date.now() - new Date(t.created_at).getTime() < 10000;
    const isHidden = !isNew; // old tours start hidden
    
    el.innerHTML = `
      <div class="tourHeader" data-tour="${t.id}">
        <strong>${t.title}</strong>
        <div class="tourMenuWrap">
          <button class="iconBtn tourMenuBtn" data-tour="${t.id}" title="More options" aria-haspopup="true" aria-expanded="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          <ul class="tourMenu is-hidden" data-tour="${t.id}">
            <li class="tourMenuDelete" data-tour="${t.id}">Delete</li>
          </ul>
        </div>
      </div>
      <div class="tourContent ${isHidden ? 'is-hidden' : ''}" id="content-${t.id}">
        <div class="tracksList" id="tracks-${t.id}">Loading tracks...</div>
        <div class="tourActions">
          <label class="uploadLabel" title="Upload Track-File">
            <span class="uploadBtnText">Upload Track-File</span>
            <input type="file" accept=".gpx,.kml,.geojson,.json" class="uploadGpx srOnlyFile" data-tour="${t.id}" />
          </label>
          <span class="uploadStatus" data-tour="${t.id}"></span>
        </div>
        <div class="tourFooter">
          <input type="text" placeholder="Share Tour by mail" class="shareEmail" data-tour="${t.id}" />
          <button class="shareBtn" data-tour="${t.id}">Share</button>
        </div>
      </div>
    `;
    toursList.appendChild(el);

    // header click toggles collapse/expand
    const header = el.querySelector('.tourHeader');
    const content = el.querySelector('.tourContent');
    header.style.cursor = 'pointer';
    header.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('tourDeleteBtn') || ev.target.classList.contains('tourColorPicker')) return;
      const willHide = !content.classList.contains('is-hidden');
      content.classList.toggle('is-hidden');
      if (willHide) {
        hideTracksForTour(t.id);
      } else {
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
      
      statusSpan.textContent = 'Uploading...';
      statusSpan.style.color = 'blue';
      try {
        await handleFileUpload(file, t.id);
        statusSpan.textContent = '✓ Uploaded';
        statusSpan.style.color = 'green';
        setTimeout(() => { statusSpan.textContent = ''; }, 3000);
      } catch (e) {
        statusSpan.textContent = '✗ Failed: ' + (e.message || 'Unknown error');
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
    // Löschen im Menü
    tourMenu.querySelector('.tourMenuDelete').addEventListener('click', async () => {
      tourMenu.classList.add('is-hidden');
      tourMenuBtn.setAttribute('aria-expanded', 'false');
      if (!confirm(`Delete tour "${t.title}"? This cannot be undone.`)) return;
      const { error } = await supabase.from('tours').delete().eq('id', t.id);
      if (error) {
        statusSpan.textContent = '✗ Delete failed: ' + error.message;
        statusSpan.style.color = 'red';
        return;
      }
      loadMyTours();
    });

    const shareBtn = el.querySelector('.shareBtn');
    shareBtn.addEventListener('click', async (ev) => {
      const email = el.querySelector('.shareEmail').value.trim();
      if (!email) { statusSpan.textContent = '✗ Provide email'; statusSpan.style.color = 'red'; return }
      const { error } = await supabase.rpc('share_tour_with_email', { p_tour_id: t.id, p_email: email });
      if (error) {
        statusSpan.textContent = '✗ Share failed: ' + error.message;
        statusSpan.style.color = 'red';
      } else {
        statusSpan.textContent = '✓ Shared';
        statusSpan.style.color = 'green';
        el.querySelector('.shareEmail').value = '';
        setTimeout(() => { statusSpan.textContent = ''; }, 2000);
      }
    });

    // load tracks for this tour
    loadTracksForTour(t.id);
  }
}

async function loadTracksForTour(tourId) {
  const container = document.getElementById(`tracks-${tourId}`);
  container.innerHTML = 'Loading...';
  // get tracks for user and filter by tour
  const { data, error } = await supabase.rpc('get_tracks_for_user');
  if (error) { container.innerHTML = 'Error loading tracks'; return }
  const tracks = (data || []).filter(r => r.tour_id === tourId);
  if (!tracks.length) { container.innerHTML = '<div>No tracks</div>'; return }
  container.innerHTML = '';
  for (const tr of tracks) {
    const row = document.createElement('div');
    row.className = 'trackRow';
    const trackName = tr.name || new Date(tr.created_at).toLocaleString();
    // Default color for track (use property or fallback to tour color)
    const defaultColor = tr.color || pickColorForTourHex(tr.id);
    row.innerHTML = `
      <div class="trackRowContent">
        <label><input type="checkbox" class="trackToggle" data-track="${tr.id}" /> <span class="trackName" data-track="${tr.id}" data-editable="false">${trackName}</span></label>
        <div class="trackRowIcons">
          <button class="iconBtn trackColorBtn" data-track="${tr.id}" title="Choose color">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="${defaultColor}"/>
              <path d="M7 16c.6-1.9 2.4-3.8 5-3.8s4.4 1.9 5 3.8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            </svg>
          </button>
          <input type="color" class="trackColorPicker srColorInput" data-track="${tr.id}" value="${defaultColor}" aria-label="Select track color" />
          <div class="trackMenuWrap">
            <button class="iconBtn trackMenuBtn" data-track="${tr.id}" title="More options" aria-haspopup="true" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            <ul class="trackMenu is-hidden" data-track="${tr.id}">
              <li class="trackMenuEdit" data-track="${tr.id}">Editieren</li>
              <li class="trackMenuCenter" data-track="${tr.id}">Zentrieren</li>
              <li class="trackMenuDelete" data-track="${tr.id}">Löschen</li>
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
      colorBtn.querySelector('circle').setAttribute('fill', currentColor);
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
        // add to cesium (2D draped)
        const geoJson = typeof tr.geo === 'string' ? JSON.parse(tr.geo) : tr.geo;
        const ds = await Cesium.GeoJsonDataSource.load(geoJson);
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
        // Zoom to track
        zoomToTrack(ds);
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
    // Editieren
    menu.querySelector('.trackMenuEdit').addEventListener('click', async () => {
      menu.classList.add('is-hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      const isEditing = nameSpan.getAttribute('data-editable') === 'true';
      if (isEditing) {
        // save
        const newName = nameSpan.textContent.trim();
        if (newName) {
          const { error } = await supabase.from('tour_tracks').update({ name: newName }).eq('id', tr.id);
          if (error) return alert('Save failed: ' + error.message);
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
            if (error) return alert('Save failed: ' + error.message);
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
    // Zentrieren
    menu.querySelector('.trackMenuCenter').addEventListener('click', () => {
      menu.classList.add('is-hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      // Center on track (zoom)
      const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
      if (ds) zoomToTrack(ds);
    });
    // Löschen
    menu.querySelector('.trackMenuDelete').addEventListener('click', async () => {
      menu.classList.add('is-hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      if (!confirm('Delete this track?')) return;
      const { error } = await supabase.from('tour_tracks').delete().eq('id', tr.id);
      if (error) return alert('Delete failed: ' + error.message);
      // remove from map
      const ds = viewer.dataSources.getByName(`track-${tr.id}`)[0];
      if (ds) viewer.dataSources.remove(ds, true);
      // refresh list
      loadTracksForTour(tourId);
    });
  }
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
  if (error) return alert('Could not load tracks: ' + error.message);
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
  for (const cb of checkboxes) {
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    }
  }
}

function zoomToTrack(dataSource) {
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

// New tour form
newTourForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('newTourTitle').value.trim();
  if (!title) return alert('Provide tour name');
  const user = await currentUser(); if (!user) return alert('Login required');
  const slug = generateTourSlug();
  const { data, error } = await supabase.from('tours').insert([{ title, slug, owner_id: user.id }]).select();
  if (error) return alert(error.message);
  document.getElementById('newTourTitle').value = '';
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

async function handleFileUpload(file, tourId) {
  if (!file) throw new Error('No file provided');
  
  const geojson = await parseFileToGeoJSON(file);
  if (!geojson) throw new Error('Could not parse file. Supported: GPX, KML, GeoJSON');
  
  // track name defaults to file name without extension
  const trackName = file.name.replace(/\.[^/.]+$/, "");
  const { data, error } = await supabase.rpc('insert_tour_track', { p_tour_id: tourId, p_props: {}, p_geojson: geojson, p_track_name: trackName });
  if (error) throw new Error('Upload failed: ' + error.message);
  
  const insertedId = (Array.isArray(data) && data[0]) ? data[0] : data;
  
  // fetch the inserted track using RPC to get GeoJSON
  const { data: tracks, error: e2 } = await supabase.rpc('get_tracks_for_user');
  if (e2 || !tracks) throw new Error('Could not fetch uploaded track');
  
  const trackData = tracks.find(t => t.id === insertedId);
  if (!trackData) throw new Error('Uploaded track not found in list');
  
  // load into Cesium and zoom (2D draped)
  // trackData.geo comes from ST_AsGeoJSON()::json which returns an object in Supabase
  const geoJson = typeof trackData.geo === 'string' ? JSON.parse(trackData.geo) : trackData.geo;
  const ds = await Cesium.GeoJsonDataSource.load(geoJson);
  ds.name = `track-${trackData.id}`;
  viewer.dataSources.add(ds);
  
  // color
  const color = Cesium.Color.fromCssColorString(pickColorForTour(tourId)).withAlpha(0.95);
  const tourColorPicker = document.querySelector(`.tourColorPicker[data-tour="${tourId}"]`);
  const customColor = tourColorPicker ? tourColorPicker.value : null;
  const finalColor = customColor ? Cesium.Color.fromCssColorString(customColor).withAlpha(0.95) : color;
  
  ds.entities.values.forEach(ent => { 
    if (ent.polyline) { 
      ent.polyline.material = finalColor; 
      ent.polyline.width = 6;
      ent.polyline.clampToGround = true; // 2D draped
      // Add properties for highlighting
      ent.properties = ent.properties || {};
      ent.properties.highlighted = false;
      ent.properties.tourId = tourId;
    } 
  });
  
  // Zoom to track
  zoomToTrack(ds);
  
  // refresh tracks list to show new track
  loadTracksForTour(tourId);
}

// Initialize authentication UI
initAuthUI()

// Initial zoom after terrain finished
let initialZoomPerformed = false;
viewer.scene.globe.preloadSiblings = true;

viewer.scene.globe.tileLoadProgressEvent.addEventListener((current) => {
  if (!initialZoomPerformed && current === 0) {
    initialZoomPerformed = true;
    performInitialZoom(viewer);
  }
});

// Override Home button
viewer.homeButton.viewModel.command.beforeExecute.addEventListener((event) => {
  event.cancel = true;
  performInitialZoom(viewer);
});

