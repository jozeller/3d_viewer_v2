// addLayersToLegend.js
// Legend UI only. It calls layerManager functions to modify Cesium layers.

import {
  setLayerActive,
  setExclusiveCategory,
  setLayerOpacity,
  applyLayerOrder
} from './layerManager.js';

const sanitize = (s) => s.replace(/[^a-zA-Z0-9-_]/g, '-');

// Categories treated as radio groups (only one active)
const radioGroups = ['Base Maps'];

// Category display order in the legend
const categoryOrder = ['Analysis', 'Hazard Maps', 'Base Maps', 'Background'];

// Translation mapping for categories
const categoryTranslations = {
  'Analysis': 'analysisLayers',
  'Hazard Maps': 'hazardMaps', 
  'Base Maps': 'baseMaps',
  'Background': 'background'
};

function getTranslatedCategoryName(category) {
  const key = categoryTranslations[category];
  return key && window.i18n ? window.i18n.getTranslation(key) : category;
}

export function addLayersToLegend(layerState, viewer) {
  const grouped = layerState.reduce((acc, layer) => {
    (acc[layer.category] ||= []).push(layer);
    return acc;
  }, {});

  const legend = document.getElementById('legend');
  if (!legend) return;
  legend.innerHTML = '';

  const categories = categoryOrder.filter(c => grouped[c]);
  for (const category of categories) {
    const categoryContainer = document.createElement('div');
    categoryContainer.className = 'legend-category';

    const h = document.createElement('h3');
    h.textContent = getTranslatedCategoryName(category);
    categoryContainer.appendChild(h);

    const isRadio = radioGroups.includes(category);
    const layers = grouped[category].sort((a, b) => a.order - b.order);

    // Separate visible and collapsible layers
    const visibleLayers = layers.filter(l => !l.collapsible);
    const collapsibleLayers = layers.filter(l => l.collapsible);

    // Add visible layers
    visibleLayers.forEach((layer) => {
      categoryContainer.appendChild(createLayerItem(layer, isRadio, layerState, viewer));
    });

    // Add collapsible box if there are hidden layers
    if (collapsibleLayers.length > 0) {
      const collapsibleBox = createCollapsibleBox(collapsibleLayers, isRadio, layerState, viewer);
      categoryContainer.appendChild(collapsibleBox);
    }

    legend.appendChild(categoryContainer);
  }
}

function createLayerItem(layer, isRadio, layerState, viewer) {
  const item = document.createElement('li');
  item.className = 'legend-item';

  const title = document.createElement('div');
  title.className = 'legend-item-title';

  const input = document.createElement('input');
  input.type = isRadio ? 'radio' : 'checkbox';
  input.name = isRadio ? `radio-${sanitize(layer.category)}` : '';
  input.id = `layer-input-${sanitize(layer.key)}`;
  input.checked = !!layer.active;

  const layerLabel = document.createElement('span');
  layerLabel.textContent = window.i18n ? window.i18n.getTranslation(layer.name) : layer.name;

  input.addEventListener('change', () => {
    if (isRadio) {
      setExclusiveCategory(layerState, viewer, layer.category, layer.key);
    } else {
      setLayerActive(layer, viewer, input.checked);
    }
    applyLayerOrder(layerState, viewer);
  });

  const menu = document.createElement('div');
  menu.className = 'legend-item-menu';

  const label = document.createElement('label');
  label.textContent = window.i18n ? window.i18n.getTranslation('opacity') : 'Opacity';

  const range = document.createElement('input');
  range.type = 'range';
  range.min = 0;
  range.max = 1;
  range.step = 0.1;
  range.value = layer.opacity ?? 1;

  range.addEventListener('input', () => {
    setLayerOpacity(layer, viewer, parseFloat(range.value));
  });

  menu.appendChild(label);
  menu.appendChild(range);

  title.addEventListener('click', (e) => {
    if (e.target === input) return;
    menu.classList.toggle('open');
  });

  title.appendChild(input);
  title.appendChild(layerLabel);
  item.appendChild(title);
  item.appendChild(menu);

  return item;
}

function createCollapsibleBox(layers, isRadio, layerState, viewer) {
  const container = document.createElement('div');
  container.className = 'legend-collapsible-container';

  const button = document.createElement('button');
  button.className = 'legend-collapsible-btn';
  button.type = 'button';
  const count = layers.length;
  const plural = count !== 1 ? 's' : '';
  const germanPlural = count !== 1 ? 'e' : '';
  const germanMore = count !== 1 ? 'r' : '';
  button.textContent = (window.i18n ? window.i18n.getTranslation('showMoreItems') : '+ Show {count} more item{plural}')
    .replace('{count}', count)
    .replace('{plural}', plural)
    .replace('{e}', germanPlural)
    .replace('{r}', germanMore);

  const hiddenLayers = document.createElement('div');
  hiddenLayers.className = 'legend-collapsible-items is-hidden';

  layers.forEach((layer) => {
    const item = createLayerItem(layer, isRadio, layerState, viewer);
    hiddenLayers.appendChild(item);
  });

  button.addEventListener('click', () => {
    const isHidden = hiddenLayers.classList.toggle('is-hidden');
    const count = layers.length;
    const plural = count !== 1 ? 's' : '';
    const germanPlural = count !== 1 ? 'e' : '';
    const germanMore = count !== 1 ? 'r' : '';
    button.textContent = isHidden 
      ? (window.i18n ? window.i18n.getTranslation('showMoreItems') : '+ Show {count} more item{plural}')
          .replace('{count}', count)
          .replace('{plural}', plural)
          .replace('{e}', germanPlural)
          .replace('{r}', germanMore)
      : (window.i18n ? window.i18n.getTranslation('hideItems') : '− Hide {count} item{plural}')
          .replace('{count}', count)
          .replace('{plural}', plural)
          .replace('{e}', germanPlural);
    button.classList.toggle('open', !isHidden);
  });

  container.appendChild(button);
  container.appendChild(hiddenLayers);

  return container;
}

// Sync checkbox/radio states with layer.active values
// Call this after programmatic layer changes (e.g., auto-switch on zoom)
export function syncLegendCheckboxes(layerState) {
  for (const layer of layerState) {
    const input = document.getElementById(`layer-input-${sanitize(layer.key)}`);
    if (input) {
      input.checked = !!layer.active;
    }
  }
}

// Make addLayersToLegend globally available for translations
window.addLayersToLegend = addLayersToLegend;
