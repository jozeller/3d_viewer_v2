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
const radioGroups = ['Basiskarten'];

// Category display order in the legend
const categoryOrder = ['Analyse', 'Gefahrenkarten', 'Basiskarten'];

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
    h.textContent = category;
    categoryContainer.appendChild(h);

    const isRadio = radioGroups.includes(category);

    grouped[category]
      .sort((a, b) => a.order - b.order)
      .forEach((layer) => {
        const item = document.createElement('li');
        item.className = 'legend-item';

        const title = document.createElement('div');
        title.className = 'legend-item-title';
        title.textContent = layer.name;

        const input = document.createElement('input');
        input.type = isRadio ? 'radio' : 'checkbox';
        input.name = isRadio ? `radio-${sanitize(category)}` : '';
        input.checked = !!layer.active;

        input.addEventListener('change', () => {
          if (isRadio) {
            // Only one layer active in this category
            setExclusiveCategory(layerState, viewer, category, layer.key);
          } else {
            setLayerActive(layer, viewer, input.checked);
          }

          // Enforce deterministic ordering (no remove/re-add)
          applyLayerOrder(layerState, viewer);
        });

        const menu = document.createElement('div');
        menu.className = 'legend-item-menu';

        // Opacity control (changes alpha only)
        const label = document.createElement('label');
        label.textContent = 'Transparenz:';

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

        // Toggle menu on title click, but do not interfere with checkbox/radio
        title.addEventListener('click', (e) => {
          if (e.target === input) return;
          menu.classList.toggle('open');
        });

        title.prepend(input);
        item.appendChild(title);
        item.appendChild(menu);
        categoryContainer.appendChild(item);
      });

    legend.appendChild(categoryContainer);
  }
}
