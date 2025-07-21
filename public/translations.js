// Placeholder for future i18n
const translations = {
  de: {
    title: "RFID-Überwachung",
    activeFormat: "Aktives Format",
    partsStatus: "Teile-Status",
    detectedTags: "Erkannte RFID-Tags",
    language: "Sprache"
  },
  cz: {
    title: "RFID Monitorování",
    activeFormat: "Aktuální formát",
    partsStatus: "Stav součástek",
    detectedTags: "Detekované RFID tagy",
    language: "Jazyk"
  },

  es: {
    title: "Supervisión de RFID",
    activeFormat: "Formato activo",
    partsStatus: "Estado de las piezas",
    detectedTags: "Etiquetas RFID detectadas",
    language: "Idioma"
  },
  fr: {
    title: "Surveillance RFID",
    activeFormat: "Format actif",
    partsStatus: "Statut des pièces",
    detectedTags: "Tags RFID détectés",
    language: "Langue"
  },
  it: {
    title: "Monitoraggio RFID",
    activeFormat: "Formato attivo",
    partsStatus: "Stato dei componenti",
    detectedTags: "Tag RFID rilevati",
    language: "Lingua"
  },
  en: {
    title: "RFID Monitoring",
    activeFormat: "Active Format",
    partsStatus: "Parts Status",
    detectedTags: "Detected RFID Tags",
    language: "Language"
  }
};

function setLanguage(lang) {
  const t = translations[lang] || translations.en;
  document.getElementById('app-title').textContent = t.title;
  document.getElementById('active-format-label').textContent = t.activeFormat;
  document.getElementById('parts-status-label').textContent = t.partsStatus;
  document.getElementById('detected-tags-label').textContent = t.detectedTags;
  document.getElementById('lang-label').textContent = t.language;
}
