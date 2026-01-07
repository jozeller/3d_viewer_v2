// layerManager.js
// Central place for Cesium viewer + imagery layer lifecycle.
// Keeps layers, toggles visibility without removing, and enforces deterministic ordering.

let currentViewer = null;

export async function createViewer(containerId, creditsContainerId, terrainConfig) {
  // Set Cesium Ion token (required for Bing Maps and World Terrain)
  const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (cesiumToken) {
    Cesium.Ion.defaultAccessToken = cesiumToken;
  } else {
    console.warn('No VITE_CESIUM_ION_TOKEN set - Bing Maps will not load');
  }

  // Create Bing Maps base layer via Ion
  let baseLayer;
  try {
    const bingImagery = await Cesium.IonImageryProvider.fromAssetId(2); // Bing Maps Aerial
    baseLayer = new Cesium.ImageryLayer(bingImagery);
    console.log('Bing Maps loaded successfully');
  } catch (e) {
    console.error('Failed to load Bing Maps from Ion:', e);
    // Fallback to OpenStreetMap
    baseLayer = new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/'
      })
    );
  }

  const viewer = new Cesium.Viewer(containerId, {
    baseLayerPicker: false,
    infoBox: false,
    animation: false,
    timeline: false,
    selectionIndicator: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    fullscreenButton: false,
    homeButton: false, // Home-Button komplett deaktivieren
    geocoder: true, // Cesium Search-Widget (Such-Icon) aktivieren
    creditContainer: document.getElementById(creditsContainerId),
    baseLayer: baseLayer
  });

  // Set terrain asynchronously
  await applyTerrain(viewer, terrainConfig);

  currentViewer = viewer;
  return viewer;
}

// Helper to apply terrain (async)
async function applyTerrain(viewer, terrainConfig) {
  let terrainProvider;
  if (terrainConfig?.type === 'cesium-world') {
    terrainProvider = await Cesium.createWorldTerrainAsync();
  } else if (terrainConfig?.type === 'url' && terrainConfig?.url) {
    terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(terrainConfig.url);
  } else {
    // Default: Cesium World Terrain
    terrainProvider = await Cesium.createWorldTerrainAsync();
  }
  viewer.terrainProvider = terrainProvider;
}

// Update terrain provider for region switch
export async function updateTerrain(viewer, terrainConfig) {
  await applyTerrain(viewer, terrainConfig);
}

// Switch to global Cesium World Terrain (for areas outside regional terrain)
export async function useGlobalTerrain(viewer) {
  viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
}

export function flyToRegion(viewer, initialView) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      initialView.longitude,
      initialView.latitude,
      initialView.height
    ),
    orientation: {
      heading: Cesium.Math.toRadians(initialView.heading || 0),
      pitch: Cesium.Math.toRadians(initialView.pitch || -50),
      roll: initialView.roll || 0
    },
    duration: 2
  });
}

export function performInitialZoom(viewer) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(8.627678, 46.350356, 60000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-50),
      roll: 0
    },
    duration: 2
  });
}

function makeProvider(layerDef, viewer) {
  if (layerDef.type === 'wms') {
    return new Cesium.WebMapServiceImageryProvider({
      url: layerDef.url,
      layers: layerDef.layers,
      parameters: layerDef.parameters ?? { format: 'image/png', transparent: true },
      // Performance: enable tile caching
      enablePickFeatures: false,
      // Use PNG8 where possible for smaller tiles
      tileWidth: 256,
      tileHeight: 256
    });
  }

  if (layerDef.type === 'xyz') {
    return new Cesium.UrlTemplateImageryProvider({
      url: layerDef.url,
      minimumLevel: layerDef.minimumLevel ?? 0,
      maximumLevel: layerDef.maximumLevel ?? 18,
      // Performance: disable feature picking for overlay tiles
      enablePickFeatures: false
    });
  }

  throw new Error(`Unsupported layer type: ${layerDef.type}`);
}

function ensureAdded(layer, viewer) {
  if (layer.viewerLayer) return;

  const imageryLayers = viewer.imageryLayers;
  layer.viewerLayer = imageryLayers.addImageryProvider(layer.provider);
  layer.viewerLayer.alpha = layer.opacity ?? 1;
  layer.viewerLayer.show = !!layer.active;
}

function applyVisibility(layer) {
  if (layer.viewerLayer) layer.viewerLayer.show = !!layer.active;
}

export function applyLayerOrder(layerState, viewer) {
  const imageryLayers = viewer.imageryLayers;

  // Determine target order based on 'order' (small => top).
  const existing = layerState
    .filter(l => l.viewerLayer)
    .sort((a, b) => a.order - b.order);

  // Cesium: index 0 = bottom. We want bottom..top.
  const bottomToTop = [...existing].reverse();

  // Deterministic ordering without removeAll:
  // Raise each layer to top in bottom..top order.
  for (const l of bottomToTop) {
    imageryLayers.raiseToTop(l.viewerLayer);
  }
}

export function setLayerOpacity(layer, viewer, opacity) {
  layer.opacity = opacity;
  if (!layer.viewerLayer) return;
  layer.viewerLayer.alpha = opacity;
}

export function setLayerActive(layer, viewer, active) {
  layer.active = active;
  if (active) ensureAdded(layer, viewer);
  applyVisibility(layer);
}

export function setExclusiveCategory(layerState, viewer, category, activeKey) {
  // Used for basemaps: only one layer active in this category.
  for (const l of layerState) {
    if (l.category !== category) continue;
    l.active = (l.key === activeKey);
    if (l.active) ensureAdded(l, viewer);
    applyVisibility(l);
  }
}

export function initLayers(viewer, layersConfig) {
  // Keep Bing Maps base layer at index 0 - don't remove it
  // All other layers will be added on top

  // Build runtime layer state
  const layerState = layersConfig.map(def => ({
    ...def,
    provider: null,
    viewerLayer: null
  }));

  // Create providers
  for (const l of layerState) {
    l.provider = makeProvider(l, viewer);
  }

  // Add only active layers once
  for (const l of layerState) {
    if (l.active) ensureAdded(l, viewer);
  }

  // Enforce order and visibility
  for (const l of layerState) applyVisibility(l);
  applyLayerOrder(layerState, viewer);

  return layerState;
}

// Remove all imagery layers except base layer (used when switching regions)
export function clearAllLayers(viewer) {
  // Keep the first layer (Bing Maps base) and remove all others
  while (viewer.imageryLayers.length > 1) {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(1));
  }
}
