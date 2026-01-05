import { layersConfig } from './layersConfig.js';
import { createViewer, initLayers, performInitialZoom } from './layerManager.js';
import { addLayersToLegend } from './addLayersToLegend.js';

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
