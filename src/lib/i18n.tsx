"use client";
import React from "react";

export type Lang = "en" | "de";

type Dict = Record<string, string>;
type Dictionaries = Record<Lang, Dict>;

const dictionaries: Dictionaries = {
  en: {
    customer: "Customer",
    somic: "Somic",
    // Header
    language: "Language",
    // Auth
    password_label: "Password for Somic:",
    login: "Login",
    checking: "Checking...",
    wrong_password: "Wrong password!",
    server_connection_failed_fallback: "Connection to server failed. Using fallback.",
    // Settings shell
    settings_open: "Settings",
    settings_close: "Close Settings",
    configuration: "Configuration",
    loading_config: "Loading configuration...",
    // File upload
    upload_format_list: "Upload format change list",
    select_file: "Select File",
    html_upload_success: "HTML-File uploaded successfully.",
    html_upload_error: "Error uploading HTML-File.",
    // Config form
    color: "Color",
    enable_opc_ua: "Enable OPC UA",
    enable_opcua_event_listener: "Enable OPC UA RFID",
    opcua_settings: "OPC UA PLC Settings",
    opcua_server_url: "OPC UA PLC URL",
    opcua_node_id: "OPC UA Node ID",
    opcua_event_listener_settings: "OPC UA RFID Settings",
    event_server_url: "RFID Antenna URL",
    event_type_nodeid: "Event Type NodeId",
    event_interval_ms: "Event Interval (ms)",
    max_events_buffer: "Max Events (Buffer)",
    save: "Save",
    saving: "Saving...",
    config_saved: "Configuration saved successfully.",
    config_failed: "Failed to save configuration.",
    // Customer page
    step_by_step: "Step-by-step instructions",
    show_guide: "Show guide",
    hide_guide: "Hide guide",
    loading_steps: "Loading steps…",
    steps_load_error: "Failed to load steps",
    no_steps_found: "No steps found.",
    format: "Format:",
    choose_placeholder: "-- choose --",
    reset: "Reset",
    reset_format_title: "Reset format",
    from: "From:",
    to: "To:",
    source_placeholder: "-- source --",
    target_placeholder: "-- target --",
    diff_mode_title: "Diff mode: Shows only differences from source to target (lines are always shown)",
    diff_mode_on: "Diff mode on",
    diff_mode_off: "Diff mode off",
    choose_different_formats: "Please choose different formats",
    loading_short: "loading…",
    unknown_error: "Unknown error",
    recognized_vs_assigned: "Recognized format parts",
    format_parts_recognized: "format parts recognized",
    recognized_tags_without_assignment: "Recognized tags from different formats",
    foreign_format_parts_detected: "foreign format parts detected",
    scaled: "Scaled",
    old_value_prefix: "old:",
    loading_image: "Loading image…",
    image: "Image",
    no_image_available: "No image available",
    close: "Close",
    preview: "Preview",
    back: "Back",
    next: "Next",
    step: "Step",
    external_html: "External HTML",
    upload_image: "Upload image",
    for: "for",
    choose_file: "Choose file",
    camera: "Camera",
    camera_running: "Camera running",
    take_photo: "Take photo",
    stop_camera: "Stop camera",
    // Customer runtime messages
    no_file_selected: "No file selected.",
    no_format_part_selected: "No format part selected.",
    uploading: "Uploading…",
    upload_success: "Upload successful:",
    upload_failed_prefix: "Upload failed",
    unexpected_server_response: "Unexpected server response",
    error_prefix: "Error:",
    camera_already_active: "Camera already active.",
    camera_requires_https: "Camera requires HTTPS or localhost. Please open the page via https://<ip>:<port>.",
    camera_api_unavailable: "Camera API not available.",
    camera_started: "Camera started.",
    camera_error: "Camera error",
    camera_not_active: "Camera not active.",
    no_canvas_available: "No canvas available.",
    canvas_context_missing: "Canvas context missing.",
    saving_photo: "Saving photo…",
    photo_saved: "Photo saved",
    // RFID titles
    no_rfid_assigned: "No RFID assigned",
    tag: "Tag",
    detected: "detected",
    not_detected: "not detected",
    key: "Key",
    norm: "Norm",
  },
  de: {
    customer: "Kunde",
    somic: "Somic",
    // Header
    language: "Sprache",
    // Auth
    password_label: "Passwort für Somic:",
    login: "Login",
    checking: "Prüfe...",
    wrong_password: "Falsches Passwort!",
    server_connection_failed_fallback: "Verbindung zum Server fehlgeschlagen. Fallback wird verwendet.",
    // Settings shell
    settings_open: "Einstellungen",
    settings_close: "Einstellungen schließen",
    configuration: "Konfiguration",
    loading_config: "Lade Konfiguration...",
    // File upload
    upload_format_list: "Formatumstellliste hochladen",
    select_file: "Datei auswählen",
    html_upload_success: "HTML-Datei erfolgreich hochgeladen.",
    html_upload_error: "Fehler beim Hochladen der HTML-Datei.",
    // Config form
    color: "Farbe",
    enable_opc_ua: "SPS OPC UA aktivieren",
    enable_opcua_event_listener: "RFID OPC UA aktivieren",
    opcua_settings: "SPS OPC UA Einstellungen",
    opcua_server_url: "SPS OPC UA URL",
    opcua_node_id: "SPS OPC UA Node ID",
    opcua_event_listener_settings: "RFID OPC UA Einstellungen",
    event_server_url: "RFID Antenne URL",
    event_type_nodeid: "Event Type NodeId",
    event_interval_ms: "Event Intervall (ms)",
    max_events_buffer: "Max Events (Puffer)",
    save: "Speichern",
    saving: "Speichern...",
    config_saved: "Konfiguration gespeichert.",
    config_failed: "Konfiguration speichern fehlgeschlagen.",
    // Customer page
    step_by_step: "Schritt-für-Schritt Anleitung",
    show_guide: "Anleitung anzeigen",
    hide_guide: "Anleitung verbergen",
    loading_steps: "Lade Schritte…",
    steps_load_error: "Fehler beim Laden der Schritt-Liste",
    no_steps_found: "Keine Schritte gefunden.",
    format: "Format:",
    choose_placeholder: "-- wählen --",
    reset: "Zurücksetzen",
    reset_format_title: "Format zurücksetzen",
    from: "Von:",
    to: "Nach:",
    source_placeholder: "-- Quelle --",
    target_placeholder: "-- Ziel --",
    diff_mode_title: "Wechsel-Modus: Zeigt nur Unterschiede von Quelle zu Ziel (alle Linien bleiben)",
    diff_mode_on: "Wechsel-Modus an",
    diff_mode_off: "Wechsel-Modus aus",
    choose_different_formats: "Bitte unterschiedliche Formate wählen",
    loading_short: "lädt…",
    unknown_error: "Unbekannter Fehler",
    recognized_vs_assigned: "Erkannte Formatteile",
    format_parts_recognized: "Formatteile erkannt",
    recognized_tags_without_assignment: "Erkannte Tags aus verschiedenen Formaten",
    foreign_format_parts_detected: "falsche Formatteile erkannt",
    scaled: "Skaliert",
    old_value_prefix: "alt:",
    loading_image: "Lade Bild…",
    image: "Bild",
    no_image_available: "Kein Bild vorhanden",
    close: "Schließen",
    preview: "Vorschau",
    back: "Zurück",
    next: "Weiter",
    step: "Schritt",
    external_html: "Externe HTML",
    upload_image: "Upload Bild",
    for: "für",
    choose_file: "Datei wählen",
    camera: "Kamera",
    camera_running: "Kamera läuft",
    take_photo: "Foto aufnehmen",
    stop_camera: "Kamera stoppen",
    // Customer runtime messages
    no_file_selected: "Keine Datei gewählt.",
    no_format_part_selected: "Kein Formatteil ausgewählt.",
    uploading: "Lade hoch…",
    upload_success: "Upload erfolgreich:",
    upload_failed_prefix: "Upload fehlgeschlagen",
    unexpected_server_response: "Unerwartete Antwort vom Server",
    error_prefix: "Fehler:",
    camera_already_active: "Kamera bereits aktiv.",
    camera_requires_https: "Kamera benötigt HTTPS oder localhost. Bitte die Seite über https://<ip>:3000 öffnen.",
    camera_api_unavailable: "Kamera API nicht verfügbar.",
    camera_started: "Kamera gestartet.",
    camera_error: "Kamera-Fehler",
    camera_not_active: "Kamera nicht aktiv.",
    no_canvas_available: "Kein Canvas verfügbar.",
    canvas_context_missing: "Canvas Kontext fehlt.",
    saving_photo: "Speichere Foto…",
    photo_saved: "Foto gespeichert",
    // RFID titles
    no_rfid_assigned: "Kein RFID zugeordnet",
    tag: "Tag",
    detected: "erkannt",
    not_detected: "nicht erkannt",
    key: "Key",
    norm: "Norm",
  },
};

type I18nContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
};

const I18nContext = React.createContext<I18nContextValue | undefined>(undefined);

function detectInitialLang(): Lang {
  try {
    // 1) URL ?lang=de|en
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const q = (p.get("lang") || "").toLowerCase();
      if (q === "de" || q === "en") return q;
    }
    // 2) localStorage
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("lang");
      if (stored === "de" || stored === "en") return stored;
    }
    // 3) Browser language
    const nav = typeof navigator !== "undefined" ? navigator.language : "en";
    if ((nav || "").toLowerCase().startsWith("de")) return "de";
  } catch {
    // ignore
  }
  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>(detectInitialLang());

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("lang", l);
      }
      if (typeof document !== "undefined") {
        document.documentElement.lang = l;
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    // ensure <html lang> reflects current
    try {
      document.documentElement.lang = lang;
    } catch {
      // ignore
    }
  }, [lang]);

  const t = React.useCallback((key: string, fallback?: string) => {
    const byLang = dictionaries[lang] || dictionaries.en;
    return byLang[key] ?? dictionaries.en[key] ?? fallback ?? key;
  }, [lang]);

  const value: I18nContextValue = React.useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
