// regions/index.js
// Central registry for all supported regions/countries
// Add new regions here to make them available in the app

import { switzerland } from './switzerland.js';
import { japan } from './japan.js';

// Registry of all available regions
export const regions = {
  CH: switzerland,
  JP: japan,
};

// Default region on app start
export const defaultRegion = 'CH';

// Helper to get region config
export function getRegion(regionCode) {
  return regions[regionCode] || regions[defaultRegion];
}

// Get list of regions for UI
export function getRegionList() {
  return Object.entries(regions).map(([code, region]) => ({
    code,
    name: region.name,
    flag: region.flag,
  }));
}

// Detect which region a coordinate belongs to
export function detectRegionByCoordinates(longitude, latitude) {
  for (const [code, region] of Object.entries(regions)) {
    if (region.bounds) {
      const { west, south, east, north } = region.bounds;
      if (longitude >= west && longitude <= east && latitude >= south && latitude <= north) {
        return code;
      }
    }
  }
  return null; // No matching region
}
