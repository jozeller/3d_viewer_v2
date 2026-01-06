// regions/_template.js
// Template for adding a new region
// Copy this file and rename it to your region (e.g., austria.js)

export const yourRegion = {
  code: 'XX',        // ISO 3166-1 alpha-2 code
  name: 'Your Region',
  flag: '🏳️',        // Emoji flag
  
  // Initial camera position
  initialView: {
    longitude: 0.0,   // Center longitude
    latitude: 0.0,    // Center latitude
    height: 500000,   // Camera height in meters
    heading: 0,       // Camera heading (0 = North)
    pitch: -90,       // Camera pitch (-90 = looking straight down)
    roll: 0
  },
  
  // Terrain provider configuration
  // Options:
  // - { type: 'cesium-world' }  - Uses Cesium World Terrain (global, requires Ion token)
  // - { type: 'url', url: 'https://...' }  - Custom terrain server
  terrain: {
    type: 'cesium-world'
  },
  
  // Layer configuration
  // Supported types: 'wms', 'xyz'
  layers: [
    // === Base Maps (order 98-100) ===
    {
      key: 'basemap_1',           // Unique identifier
      name: 'Standard Map',       // Display name
      category: 'Base Maps',      // Category for grouping
      order: 98,                  // Layer order (lower = on top)
      type: 'xyz',                // 'xyz' or 'wms'
      url: 'https://example.com/tiles/{z}/{x}/{y}.png',
      active: true,               // Initially visible
      opacity: 1                  // 0-1
    },
    
    // === Analysis Layers (order 5-10) ===
    {
      key: 'analysis_1',
      name: 'Analysis Layer',
      category: 'Analysis',
      order: 9,
      type: 'wms',
      url: 'https://example.com/wms',
      layers: 'layer_name',       // WMS layer name (required for WMS)
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 0.7,
      collapsible: true           // Can be collapsed in legend
    },
    
    // === Hazard Maps (order 1-4) ===
    {
      key: 'hazard_1',
      name: 'Hazard Layer',
      category: 'Hazard Maps',
      order: 3,
      type: 'xyz',
      url: 'https://example.com/hazard/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.6,
      collapsible: true
    }
  ]
};

// Don't forget to:
// 1. Import this in regions/index.js
// 2. Add to the regions object in regions/index.js
