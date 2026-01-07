// performanceConfig.js
// Performance optimization settings for Cesium viewer
// Detects device capabilities and applies appropriate settings

/**
 * Detect if running on a mobile device
 */
export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

/**
 * Detect if device has low performance capabilities
 * Checks: GPU renderer, device memory, hardware concurrency
 */
export function isLowPerformanceDevice() {
  // Check hardware concurrency (CPU cores)
  const cores = navigator.hardwareConcurrency || 2;
  if (cores <= 2) return true;
  
  // Check device memory (if available)
  if (navigator.deviceMemory && navigator.deviceMemory < 4) return true;
  
  // Check connection type for adaptive loading
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection) {
    const slowConnections = ['slow-2g', '2g', '3g'];
    if (slowConnections.includes(connection.effectiveType)) return true;
    if (connection.saveData) return true;
  }
  
  return false;
}

/**
 * Get WebGL capabilities to detect GPU power
 */
export function getGPUInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { tier: 'low', renderer: 'unknown' };
    
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo 
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) 
      : 'unknown';
    
    // Detect low-end GPUs
    const lowEndGPUs = [
      'Intel HD Graphics',
      'Intel UHD Graphics',
      'Mali-',
      'Adreno 3',
      'Adreno 4',
      'PowerVR',
      'SwiftShader',
      'llvmpipe'
    ];
    
    const isLowEnd = lowEndGPUs.some(gpu => renderer.includes(gpu));
    
    return {
      tier: isLowEnd ? 'low' : 'high',
      renderer: renderer
    };
  } catch (e) {
    return { tier: 'low', renderer: 'unknown' };
  }
}

/**
 * Determine performance tier: 'high', 'medium', 'low'
 */
export function getPerformanceTier() {
  const mobile = isMobileDevice();
  const lowPerf = isLowPerformanceDevice();
  const gpu = getGPUInfo();
  
  if (lowPerf || gpu.tier === 'low') return 'low';
  if (mobile) return 'medium';
  return 'high';
}

/**
 * Get Cesium scene settings based on performance tier
 */
export function getSceneSettings(tier) {
  const settings = {
    high: {
      // Full quality
      resolutionScale: 1.0,
      maximumScreenSpaceError: 2,
      tileCacheSize: 1000,
      fxaa: true,
      msaa: 4,
      shadows: false, // Still expensive
      fog: true,
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
      terrainExaggeration: 1.0,
      targetFrameRate: 60,
      useBrowserRecommendedResolution: true,
      preloadAncestors: true,
      preloadSiblings: true,
      maximumSimultaneousTileLoads: 20
    },
    medium: {
      // Balanced for tablets/older laptops
      resolutionScale: 1.0,
      maximumScreenSpaceError: 4,
      tileCacheSize: 500,
      fxaa: true,
      msaa: 2,
      shadows: false,
      fog: true,
      requestRenderMode: true, // Only render when needed
      maximumRenderTimeChange: 0.5,
      terrainExaggeration: 1.0,
      targetFrameRate: 30,
      useBrowserRecommendedResolution: true,
      preloadAncestors: true,
      preloadSiblings: false,
      maximumSimultaneousTileLoads: 10
    },
    low: {
      // Maximum performance for old devices
      resolutionScale: 0.75, // Render at lower resolution
      maximumScreenSpaceError: 8, // Less detailed terrain
      tileCacheSize: 200,
      fxaa: false,
      msaa: 1,
      shadows: false,
      fog: false,
      requestRenderMode: true, // Critical: only render on changes
      maximumRenderTimeChange: 1.0,
      terrainExaggeration: 1.0,
      targetFrameRate: 30,
      useBrowserRecommendedResolution: false,
      preloadAncestors: false,
      preloadSiblings: false,
      maximumSimultaneousTileLoads: 5
    }
  };
  
  return settings[tier] || settings.medium;
}

/**
 * Get imagery layer settings based on performance tier
 */
export function getImagerySettings(tier) {
  return {
    high: {
      maximumLevel: 18,
      minimumTerrainLevel: 0,
      enablePickFeatures: true
    },
    medium: {
      maximumLevel: 16,
      minimumTerrainLevel: 0,
      enablePickFeatures: false
    },
    low: {
      maximumLevel: 14, // Limit max zoom for better performance
      minimumTerrainLevel: 2, // Skip lowest detail levels
      enablePickFeatures: false
    }
  }[tier] || { maximumLevel: 16, minimumTerrainLevel: 0, enablePickFeatures: false };
}

/**
 * Apply performance settings to Cesium viewer
 */
export function applyPerformanceSettings(viewer, tier = null) {
  if (!tier) tier = getPerformanceTier();
  const settings = getSceneSettings(tier);
  const scene = viewer.scene;
  
  console.log(`Applying performance tier: ${tier}`, settings);
  
  // Resolution scaling
  viewer.resolutionScale = settings.resolutionScale;
  viewer.useBrowserRecommendedResolution = settings.useBrowserRecommendedResolution;
  
  // Anti-aliasing
  scene.postProcessStages.fxaa.enabled = settings.fxaa;
  if (scene.msaaSamples !== undefined) {
    scene.msaaSamples = settings.msaa;
  }
  
  // Rendering mode - critical for performance
  scene.requestRenderMode = settings.requestRenderMode;
  scene.maximumRenderTimeChange = settings.maximumRenderTimeChange;
  
  // Atmosphere and effects
  scene.fog.enabled = settings.fog;
  scene.globe.enableLighting = false;
  scene.shadowMap.enabled = settings.shadows;
  
  // Terrain settings
  scene.globe.maximumScreenSpaceError = settings.maximumScreenSpaceError;
  scene.globe.tileCacheSize = settings.tileCacheSize;
  scene.globe.preloadAncestors = settings.preloadAncestors;
  scene.globe.preloadSiblings = settings.preloadSiblings;
  
  // Memory management
  scene.globe.terrainExaggeration = settings.terrainExaggeration;
  
  // Frame rate
  if (viewer.targetFrameRate !== undefined) {
    viewer.targetFrameRate = settings.targetFrameRate;
  }
  
  // Tile loading limits
  if (scene.globe.maximumSimultaneousTileLoads !== undefined) {
    // This is read-only in some versions, wrap in try-catch
    try {
      scene.globe._surface._tileLoadQueueHigh.maximumLength = settings.maximumSimultaneousTileLoads;
      scene.globe._surface._tileLoadQueueMedium.maximumLength = settings.maximumSimultaneousTileLoads;
      scene.globe._surface._tileLoadQueueLow.maximumLength = settings.maximumSimultaneousTileLoads;
    } catch (e) {
      // Ignore if internal API changed
    }
  }
  
  // Disable unnecessary features
  scene.skyBox.show = tier !== 'low';
  scene.sun.show = tier !== 'low';
  scene.moon.show = false;
  scene.skyAtmosphere.show = tier !== 'low';
  
  // Force a render after settings change
  scene.requestRender();
  
  return tier;
}

/**
 * Create a throttled camera move handler
 * Reduces render calls during camera movement
 */
export function createThrottledCameraHandler(viewer, callback, delay = 100) {
  let timeout = null;
  let lastCall = 0;
  
  return function(...args) {
    const now = Date.now();
    
    if (now - lastCall >= delay) {
      lastCall = now;
      callback.apply(this, args);
    } else {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        lastCall = Date.now();
        callback.apply(this, args);
      }, delay - (now - lastCall));
    }
    
    // Always request render during interaction
    if (viewer.scene.requestRenderMode) {
      viewer.scene.requestRender();
    }
  };
}

/**
 * Setup visibility-based rendering pause
 * Stops rendering when tab is not visible
 */
export function setupVisibilityHandler(viewer) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Pause rendering when tab is hidden
      viewer.useDefaultRenderLoop = false;
    } else {
      // Resume rendering when tab is visible
      viewer.useDefaultRenderLoop = true;
      viewer.scene.requestRender();
    }
  });
}

/**
 * Setup render-on-demand triggers
 * Only re-render when something changes
 */
export function setupRenderOnDemand(viewer) {
  const scene = viewer.scene;
  
  // Request render on camera change
  viewer.camera.changed.addEventListener(() => {
    scene.requestRender();
  });
  
  // Request render on layer changes
  viewer.imageryLayers.layerAdded.addEventListener(() => {
    scene.requestRender();
  });
  
  viewer.imageryLayers.layerRemoved.addEventListener(() => {
    scene.requestRender();
  });
  
  viewer.imageryLayers.layerMoved.addEventListener(() => {
    scene.requestRender();
  });
  
  // Request render on entity changes
  viewer.entities.collectionChanged.addEventListener(() => {
    scene.requestRender();
  });
  
  // Request render periodically to catch missed updates (low frequency)
  setInterval(() => {
    if (!document.hidden) {
      scene.requestRender();
    }
  }, 5000);
}

/**
 * Apply all performance optimizations
 */
export function initPerformanceOptimizations(viewer, forceTier = null) {
  const tier = applyPerformanceSettings(viewer, forceTier);
  
  if (tier === 'low' || tier === 'medium') {
    setupRenderOnDemand(viewer);
  }
  
  setupVisibilityHandler(viewer);
  
  return tier;
}

/**
 * Performance settings UI control
 */
export function createPerformanceControl() {
  return {
    currentTier: getPerformanceTier(),
    tiers: ['low', 'medium', 'high'],
    labels: {
      low: 'Performance Mode',
      medium: 'Balanced',
      high: 'High Quality'
    }
  };
}
