// layerManager.js
// Central place for Cesium viewer + imagery layer lifecycle.
// Keeps layers, toggles visibility without removing, and enforces deterministic ordering.

let currentViewer = null;

export function createViewer(containerId, creditsContainerId, terrainConfig) {
  // Set Cesium Ion token if available (required for geocoder/search)
  const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (cesiumToken) {
    Cesium.Ion.defaultAccessToken = cesiumToken;
  }

  // Create terrain provider based on config
  let terrainProvider;
  if (terrainConfig?.type === 'cesium-world') {
    terrainProvider = Cesium.createWorldTerrain();
  } else if (terrainConfig?.type === 'url' && terrainConfig?.url) {
    terrainProvider = new Cesium.CesiumTerrainProvider({
      url: terrainConfig.url
    });
  } else {
    // Default: Cesium World Terrain
    terrainProvider = Cesium.createWorldTerrain();
  }

  const viewer = new Cesium.Viewer(containerId, {
    terrainProvider,
    baseLayerPicker: false,
    infoBox: false,
    animation: false,
    timeline: false,
    selectionIndicator: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    creditContainer: document.getElementById(creditsContainerId)
  });

  currentViewer = viewer;
  return viewer;
}

// Update terrain provider for region switch
export function updateTerrain(viewer, terrainConfig) {
  let terrainProvider;
  if (terrainConfig?.type === 'cesium-world') {
    terrainProvider = Cesium.createWorldTerrain();
  } else if (terrainConfig?.type === 'url' && terrainConfig?.url) {
    terrainProvider = new Cesium.CesiumTerrainProvider({
      url: terrainConfig.url
    });
  } else {
    terrainProvider = Cesium.createWorldTerrain();
  }
  viewer.terrainProvider = terrainProvider;
}

// Switch to global Cesium World Terrain (for areas outside regional terrain)
export function useGlobalTerrain(viewer) {
  viewer.terrainProvider = Cesium.createWorldTerrain();
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

function makeProvider(layerDef, viewer, defaultImageryProvider) {
  // Note: default Cesium imagery provider is obtained from viewer at startup.
  if (layerDef.type === 'cesium_default') return defaultImageryProvider;

  if (layerDef.type === 'wms') {
    return new Cesium.WebMapServiceImageryProvider({
      url: layerDef.url,
      layers: layerDef.layers,
      parameters: layerDef.parameters ?? { format: 'image/png', transparent: true }
    });
  }

  if (layerDef.type === 'xyz') {
    return new Cesium.UrlTemplateImageryProvider({
      url: layerDef.url,
      minimumLevel: layerDef.minimumLevel ?? 0,
      maximumLevel: layerDef.maximumLevel ?? 18
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
  // Capture Cesium default imagery provider and remove it from layer stack,
  // so it can be managed like any other layer.
  const defaultProvider = viewer.imageryLayers.get(0)?.imageryProvider;
  if (viewer.imageryLayers.get(0)) {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(0));
  }

  // Build runtime layer state
  const layerState = layersConfig.map(def => ({
    ...def,
    provider: null,
    viewerLayer: null
  }));

  // Create providers
  for (const l of layerState) {
    l.provider = makeProvider(l, viewer, defaultProvider);
  }

  // Add only active layers once
  for (const l of layerState) {
    if (l.active) ensureAdded(l, viewer);
  }
  
  // Pre-add global fallback layer (but keep hidden) for faster switching
  const fallback = layerState.find(l => l.isGlobalFallback);
  if (fallback && !fallback.viewerLayer) {
    ensureAdded(fallback, viewer);
    fallback.viewerLayer.show = false;
  }

  // Enforce order and visibility
  for (const l of layerState) applyVisibility(l);
  applyLayerOrder(layerState, viewer);

  return layerState;
}

// Remove all imagery layers (used when switching regions)
export function clearAllLayers(viewer) {
  viewer.imageryLayers.removeAll();
}
