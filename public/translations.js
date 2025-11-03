// Simple i18n for public pages (somic.html)
const translations = {
  de: {
    assignedParts: "Zugeordnete Teile",
    allPartsAssigned: "Alle Teile zugeordnet",
    allFormatParts: "Alle Formatteile",
    readTags: "RFID-Tags lesen",
    refreshParts: "Teile aktualisieren",
  },
  en: {
    assignedParts: "Assigned Parts",
    allPartsAssigned: "All parts assigned",
    allFormatParts: "All Format Parts",
    readTags: "Read RFID Tags",
    refreshParts: "Refresh Parts",
  }
};

// Function to set language on the page
function setLanguage(lang) {
  const t = translations[lang] || translations.en;
  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const el = byId(id);
    if (el) {
      el.textContent = value;
    }
  };
  setText('assigned-parts-title', t.assignedParts);
  setText('final-check-label', t.allPartsAssigned);
  setText('all-format-parts-title', t.allFormatParts);
  setText('btn-read-tags', t.readTags);
  setText('btn-refresh-parts', t.refreshParts);
}

// If used standalone, initialize from URL parameter
(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const lang = (params.get('lang') || '').toLowerCase();
    if (lang === 'de' || lang === 'en') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setLanguage(lang));
      } else {
        setLanguage(lang);
      }
      try { document.documentElement.lang = lang; } catch { }
    }
  } catch { }
})();

// Listen to parent window messages to update language dynamically without reload
window.addEventListener('message', (ev) => {
  try {
    const data = ev.data || {};
    if (data && data.type === 'set-language' && (data.lang === 'de' || data.lang === 'en')) {
      setLanguage(data.lang);
      try { document.documentElement.lang = data.lang; } catch { }
    }
  } catch { }
});
