export const layersConfig = [
  {
    key: 'default',
    name: 'Standard Cesium Imagery',
    category: 'Basiskarten',
    order: 9999,
    type: 'cesium_default',
    active: false,
    opacity: 1
  },
  {
    key: 'swissimage',
    name: 'swisstopo Luftbild',
    category: 'Basiskarten',
    order: 99,
    type: 'wms',
    url: 'https://wms.geo.admin.ch/',
    layers: 'ch.swisstopo.swissimage',
    parameters: { format: 'image/png', transparent: true },
    active: false,
    opacity: 1
  },
  {
    key: 'pixelkarte_winter',
    name: 'swisstopo Landeskarte Winter',
    category: 'Basiskarten',
    order: 98,
    type: 'wms',
    url: 'https://wms.geo.admin.ch/',
    layers: 'ch.swisstopo.pixelkarte-farbe-winter',
    parameters: { format: 'image/png', transparent: true },
    active: true,
    opacity: 1
  },
  {
    key: 'slope_30',
    name: 'Hangneigung über 30°',
    category: 'Analyse',
    order: 3,
    type: 'wms',
    url: 'https://wms.geo.admin.ch/',
    layers: 'ch.swisstopo.hangneigung-ueber_30',
    parameters: { format: 'image/png', transparent: true },
    active: true,
    opacity: 0.5
  },
  {
    key: 'skitouren',
    name: 'swisstopo Skitouren',
    category: 'Analyse',
    order: 2,
    type: 'wms',
    url: 'https://wms.geo.admin.ch/',
    layers: 'ch.swisstopo-karto.skitouren',
    parameters: { format: 'image/png', transparent: true },
    active: true,
    opacity: 1
  }
];
