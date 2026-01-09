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
  
  // Bounding box for Japan (expanded to cover the entire country)
  bounds: {
    west: 122.0,
    south: 20.0,
    east: 154.0,
    north: 46.0
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
      name: 'layer_gsi_std',
      category: 'Base Maps',
      order: 98,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
      active: true,
      opacity: 1
    },
    {
      key: 'osm_english',
      name: 'layer_osm_english',
      category: 'Base Maps',
      order: 96,
      type: 'xyz',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      active: false,
      opacity: 1
    },
    {
      key: 'gsi_pale',
      name: 'layer_gsi_pale',
      category: 'Base Maps',
      order: 99,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
      active: false,
      opacity: 1
    },
    {
      key: 'gsi_photo',
      name: 'layer_gsi_photo',
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
      name: 'layer_gsi_slope',
      category: 'Analysis',
      order: 9,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.5,
      collapsible: false
    },
    {
      key: 'gsi_slopezone_avalanche',
      name: 'layer_gsi_slopezone_avalanche',
      category: 'Analysis',
      order: 6,
      type: 'xyz',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/slopezone1map/{z}/{x}/{y}.png',
      active: false,
      opacity: 0.4,
      collapsible: true,
      info: 'Hinweise zur Verwendung der nationalen Hangneigungsklassifizierungskarte (lawinenbezogen) [PDF 629 KB]'
    },
    {
      key: 'gsi_hillshade',
      name: 'layer_gsi_hillshade',
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
      name: 'layer_gsi_lcm',
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
      name: 'layer_gsi_flood',
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
      name: 'layer_gsi_landslide',
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
      name: 'layer_gsi_tsunami',
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
