// regions/switzerland.js
// Switzerland region configuration

export const switzerland = {
  code: 'CH',
  name: 'Switzerland',
  flag: 'https://flagcdn.com/w40/ch.png',
  
  // Initial camera position (original zoom settings)
  initialView: {
    longitude: 8.627678,
    latitude: 46.350356,
    height: 60000,
    heading: 0,
    pitch: -50,
    roll: 0
  },
  
  // Bounding box for Switzerland
  bounds: {
    west: 5.9,
    south: 45.8,
    east: 10.5,
    north: 47.8
  },
  
  // Terrain provider configuration
  terrain: {
    type: 'url',
    url: '//3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1'
  },
  
  // Layer configuration for this region
  layers: [
    {
      key: 'pixelkarte_winter',
      name: 'swisstopo — Winter Map',
      category: 'Base Maps',
      order: 98,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo.pixelkarte-farbe-winter',
      parameters: { format: 'image/png', transparent: true },
      active: true,
      opacity: 1
    },
    {
      key: 'swissimage',
      name: 'swisstopo — Aerial Image',
      category: 'Base Maps',
      order: 99,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo.swissimage',
      parameters: { format: 'image/png', transparent: true },
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
      key: 'pixelkarte_farbe',
      name: 'swisstopo — National Maps (Color)',
      category: 'Base Maps',
      order: 100,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo.pixelkarte-farbe',
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 1
    },
    {
      key: 'hangneigung_30',
      name: 'swisstopo — Slope over 30°',
      category: 'Analysis',
      order: 9,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo.hangneigung-ueber_30',
      parameters: { format: 'image/png', transparent: true },
      active: true,
      opacity: 0.5,
      collapsible: false
    },
    {
      key: 'skitouren',
      name: 'swisstopo — Ski Tours',
      category: 'Analysis',
      order: 8,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo-karto.skitouren',
      parameters: { format: 'image/png', transparent: true },
      active: true,
      opacity: 1,
      collapsible: false
    },
    {
      key: 'schneeschuhrouten',
      name: 'swisstopo — Snowshoe Routes',
      category: 'Analysis',
      order: 7,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo-karto.schneeschuhrouten',
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 1,
      collapsible: true
    },
    {
      key: 'wanderwege',
      name: 'swisstopo — Hiking Trails',
      category: 'Analysis',
      order: 6,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.astra.wanderland',
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 1,
      collapsible: true
    },
    {
      key: 'ov_haltestellen',
      name: 'bav — Public Transport Stops',
      category: 'Analysis',
      order: 5,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.bav.haltestellen-oev',
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 1,
      collapsible: true
    },
    {
      key: 'sac_huetten',
      name: 'swisstopo — Winter Accommodations',
      category: 'Analysis',
      order: 4,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.swisstopo.unterkuenfte-winter',
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 1,
      collapsible: true
    },
    {
      key: 'wildtierschutzgebiete',
      name: 'bafu — Wildlife Protection Areas',
      category: 'Analysis',
      order: 2,
      type: 'wms',
      url: 'https://wms.geo.admin.ch/',
      layers: 'ch.bafu.wrz-jagdbanngebiete_select',
      parameters: { format: 'image/png', transparent: true },
      active: false,
      opacity: 0.6,
      collapsible: true
    }
  ]
};
