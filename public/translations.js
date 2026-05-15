// Simple i18n for public pages (somic.html)
const translations = {
  de: {
    assignedParts: "Zugeordnete Teile",
    allPartsAssigned: "Alle Teile zugeordnet",
    allFormatParts: "Alle Formatteile",
    readTags: "RFID-Tags lesen",
    refreshParts: "Teile aktualisieren",
    unassigned: "(Nicht zugeordnet)",
    assigned_label: "(zugeordnet)",
    assigned_to: "(zugeordnet an %s)",
    no_format_parts: "Keine Formatteile verfügbar. Bitte HTML-Datei hochladen.",
    no_parts_to_assign: "Keine Teile zum Zuweisen.",
    assign: "Zuweisen",
    show_picture: "Bild anzeigen",
    upload: "Hochladen",
    upload_image: "Upload Bild für %s",
    choose_file: "Datei wählen",
    camera: "Kamera",
    camera_running: "Kamera läuft",
    flip: "Flip",
    close: "Schließen",
    take_photo: "Foto aufnehmen",
    stop_camera: "Kamera stoppen",
    uploading: "Lade hoch...",
    upload_success: "Upload erfolgreich",
    upload_failed: "Fehler beim Upload",
    upload_error_prefix: "Fehler beim Upload:",
    photo_saved: "Foto gespeichert",
    camera_requires_https: "Kamera benötigt HTTPS oder localhost. Bitte App über https://<deine-ip>:3000 öffnen.",
    camera_api_unavailable: "Kamera-API nicht verfügbar. Bitte HTTPS verwenden oder Datei-Upload nutzen.",
    camera_error: "Kamera Fehler",
  },
  en: {
    assignedParts: "Assigned Parts",
    allPartsAssigned: "All parts assigned",
    allFormatParts: "All Format Parts",
    readTags: "Read RFID Tags",
    refreshParts: "Refresh Parts",
    unassigned: "(unassigned)",
    assigned_label: "(assigned)",
    assigned_to: "(assigned to %s)",
    no_format_parts: "No format parts available. Please upload an HTML file first.",
    no_parts_to_assign: "No parts to assign.",
    assign: "Assign",
    show_picture: "Show picture",
    upload: "Upload",
    upload_image: "Upload image for %s",
    choose_file: "Choose file",
    camera: "Camera",
    camera_running: "Camera running",
    flip: "Flip",
    close: "Close",
    take_photo: "Take photo",
    stop_camera: "Stop camera",
    uploading: "Uploading...",
    upload_success: "Upload successful",
    upload_failed: "Upload failed",
    upload_error_prefix: "Upload error:",
    photo_saved: "Photo saved",
    camera_requires_https: "Camera requires HTTPS or localhost. Please open the app via https://<your-ip>:3000.",
    camera_api_unavailable: "Camera API not available. Please use HTTPS or file upload.",
    camera_error: "Camera error",
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

// Expose helper to retrieve translations from other scripts
window.getTranslation = function (key, lang) {
  try {
    const l = (lang || document.documentElement.lang || '').toLowerCase();
    const use = (l === 'de' || l === 'en') ? l : 'en';
    const byLang = translations[use] || translations.en;
    return byLang[key] ?? translations.en[key] ?? key;
  } catch {
    return key;
  }
};

// Helper to format a translation with %s placeholders
window.formatTranslation = function (tpl, ...args) {
  if (!tpl) return '';
  let out = String(tpl);
  args.forEach(a => { out = out.replace('%s', String(a)); });
  return out;
};

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
