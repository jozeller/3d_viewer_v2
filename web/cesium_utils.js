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

export function ensureLayerAdded(layer, viewer) {
  if (!layer.provider) return;
  if (!layer.viewerLayer) {
    layer.viewerLayer = viewer.imageryLayers.addImageryProvider(layer.provider);
    layer.viewerLayer.alpha = layer.opacity ?? 1;
  }
}

export function applyLayerVisibility(layer) {
  if (layer.viewerLayer) layer.viewerLayer.show = !!layer.active;
}

export function applyLayerOrder(layersConfig, viewer) {
  const imageryLayers = viewer.imageryLayers;

  // Nur existierende Layers reordnen (keine removeAll)
  const existing = layersConfig
    .filter(l => l.viewerLayer)
    .sort((a, b) => a.order - b.order); // klein = oben (wie bisher)

  // Von unten nach oben aufbauen: zuerst alle nach oben raisen
  for (const l of existing) imageryLayers.raiseToTop(l.viewerLayer);

  // Basiskarten-Default (order 9999) wirklich zuunterst
  const baseDefault = layersConfig.find(l => l.order === 9999);
  if (baseDefault?.viewerLayer) imageryLayers.lowerToBottom(baseDefault.viewerLayer);
}

export function initializeLayers(layersConfig, viewer) {
  for (const layer of layersConfig) {
    if (layer.active) ensureLayerAdded(layer, viewer);
    applyLayerVisibility(layer);
  }
  applyLayerOrder(layersConfig, viewer);
}
