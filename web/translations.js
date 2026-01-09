// Translation system
let currentLanguage = 'de'; // Default to German
let translations = {};

async function loadTranslations() {
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'translations.json');
    translations = await response.json();
  } catch (error) {
    console.error('Failed to load translations:', error);
  }
}

function setLanguage(lang) {
  if (!translations[lang]) {
    console.warn(`Language ${lang} not found, falling back to 'de'`);
    lang = 'de';
  }
  currentLanguage = lang;
  localStorage.setItem('language', lang);
  updateTexts();
  
  // Update region dropdown texts when language changes (without rebuilding the list)
  if (window.updateRegionDropdownTexts) {
    window.updateRegionDropdownTexts();
  }

  // Update legend texts when language changes (without rebuilding the legend)
  if (window.updateLegendTexts && window.layerState) {
    window.updateLegendTexts(window.layerState);
  }
}

function getTranslation(key) {
  return translations[currentLanguage]?.[key] || key;
}

function updateTexts() {
  // Update elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const translation = getTranslation(key);
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      element.placeholder = translation;
    } else if (element.tagName === 'OPTION') {
      element.textContent = translation;
    } else if (element.querySelector('svg')) {
      // Skip elements that contain SVG (icons) - don't replace with text
      return;
    } else {
      element.textContent = translation;
    }
  });

  // Update aria-labels with data-i18n-aria
  document.querySelectorAll('[data-i18n-aria]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria');
    const translation = getTranslation(key);
    element.setAttribute('aria-label', translation);
  });

  // Update titles with data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const translation = getTranslation(key);
    element.setAttribute('title', translation);
  });

  // Update aria-labels (legacy support)
  document.querySelectorAll('[aria-label]').forEach(element => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && translations[currentLanguage][ariaLabel.toLowerCase().replace(/\s+/g, '')]) {
      element.setAttribute('aria-label', getTranslation(ariaLabel.toLowerCase().replace(/\s+/g, '')));
    }
  });

  // Update title attributes (legacy support)
  document.querySelectorAll('[title]').forEach(element => {
    const title = element.getAttribute('title');
    if (title && translations[currentLanguage][title.toLowerCase().replace(/\s+/g, '')]) {
      element.setAttribute('title', getTranslation(title.toLowerCase().replace(/\s+/g, '')));
    }
  });
}

// Initialize translations
async function initTranslations() {
  await loadTranslations();

  // Load saved language or detect from browser
  let initialLang = localStorage.getItem('language');
  if (!initialLang) {
    const browserLang = navigator.language || navigator.userLanguage;
    initialLang = browserLang && browserLang.startsWith('de') ? 'de' : 'en';
  }
  setLanguage(initialLang);

  // Rebuild legend after translations are loaded
  if (window.layerState && window.addLayersToLegend && window.viewer) {
    const legendEl = document.getElementById('legend');
    if (legendEl) {
      legendEl.innerHTML = '';
      window.addLayersToLegend(window.layerState, window.viewer);
    }
  }

  // Update texts again after a short delay to ensure all elements are ready
  setTimeout(() => updateTexts(), 100);

  // Set up language toggle button
  const languageToggleBtn = document.getElementById('languageToggleBtn');
  if (languageToggleBtn) {
    function updateButtonText() {
      languageToggleBtn.textContent = currentLanguage.toUpperCase();
    }
    updateButtonText();
    languageToggleBtn.addEventListener('click', () => {
      const newLang = currentLanguage === 'de' ? 'en' : 'de';
      setLanguage(newLang);
      updateButtonText();
    });
  }
}

// Export for use in other modules
export const i18n = {
  setLanguage,
  getTranslation,
  updateTexts,
  initTranslations
};

// For backward compatibility, also set on window
window.i18n = i18n;