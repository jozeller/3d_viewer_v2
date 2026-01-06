// regions/japan.js
// Japan region configuration

export const japan = {
  code: 'JP',
  name: 'Japan',
  flag: 'https://flagcdn.com/w40/jp.png',
  
  // Initial camera position (centered on Hokkaido, looking north)
  initialView: {
    longitude: 143.0,
    latitude: 40.5,
    height: 450000,
    heading: 0,
    pitch: -50,
    roll: 0
  },
  
  // Bounding box for Niseko area, Hokkaido (used for home button, etc.)
  bounds: {
    west: 140.4,
    south: 42.65,
    east: 141.0,
    north: 43.05
  },
  
  // Terrain provider configuration
  terrain: {
    type: 'cesium-world', // Uses Cesium World Terrain (requires Ion token)
  },
  
  // Layer configuration for this region
  layers: [
    // === Base Maps ===
    {
      key: 'gsi_std',
      name: 'GSI — Standard Map (日本語)',
      category: 'Base Maps',
      order: 98,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
      active: true,
      opacity: 1
    },
    {
      key: 'osm_english',
      name: 'OpenStreetMap (English)',
      category: 'Base Maps',
      order: 96,
      type: 'xyz',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      active: false,
      opacity: 1
    },
    {
      key: 'world_satellite',
      name: 'Global Satellite',
      category: 'Background',
      order: 200,
      type: 'xyz',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      active: false,
      opacity: 1,
      isGlobalFallback: true
    },
    {
      key: 'gsi_pale',
      name: 'GSI — Pale Map',
      category: 'Base Maps',
      order: 99,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
      active: false,
      opacity: 1
    },
    {
      key: 'gsi_photo',
      name: 'GSI — Aerial Photo',
      category: 'Base Maps',
      order: 100,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
      active: false,
      opacity: 1
    },
    
    // === Analysis Layers ===
    {
      key: 'gsi_slope',
      name: 'GSI — Slope Gradient',
      category: 'Analysis',
      order: 9,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.5,
      collapsible: false
    },
    {
      key: 'gsi_hillshade',
      name: 'GSI — Hillshade',
      category: 'Analysis',
      order: 8,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.6,
      collapsible: true
    },
    {
      key: 'gsi_lcm',
      name: 'GSI — Land Condition',
      category: 'Analysis',
      order: 7,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/lcm25k/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.7,
      collapsible: true
    },
    
    // === Hazard Maps ===
    {
      key: 'gsi_flood',
      name: 'GSI — Flood Hazard',
      category: 'Hazard Maps',
      order: 5,
      type: 'xyz',
      url: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.6,
      collapsible: true
    },
    {
      key: 'gsi_landslide',
      name: 'GSI — Landslide Risk',
      category: 'Hazard Maps',
      order: 4,
      type: 'xyz',
      url: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.6,
      collapsible: true
    },
    {
      key: 'gsi_tsunami',
      name: 'GSI — Tsunami Hazard',
      category: 'Hazard Maps',
      order: 3,
      type: 'xyz',
      url: 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.6,
      collapsible: true
    }
  ]
};
