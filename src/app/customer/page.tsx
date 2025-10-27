"use client";
import Header from "@/components/Header";
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { apiClient, BACKEND_URL } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

// -------------------- Typdefinitionen --------------------
interface RowMeta {
  row_type: 'caption_line' | 'caption' | 'data';
  text?: string;
  html?: string;
  cells?: string[];
  classes?: string[];
}

interface FormatItem {
  value?: string;
  formatValue?: string;
  valueIndex?: string; // sichtbare Nummer
  formatPart?: string; // FTL.
  cart?: string;       // Wagen
  [k: string]: unknown;
}

interface FormatDetail {
  valueIndexMap?: Record<number, string>;
  formats?: Record<string, { data?: FormatItem[] } & Record<string, unknown>>;
  data?: { formats?: Record<string, { data?: FormatItem[] }> };
  success?: boolean;
}

interface AssignmentsMapEntry { rfid_tag_id?: string; rfidTagId?: string;[k: string]: unknown }
type AssignmentsMap = Record<string, AssignmentsMapEntry | string>;

interface RFIDStatus {
  seen: boolean;
  tagId: string | null;
  tagIdNorm: string | null;
  keyTried?: string;
  symbol: string; // ✔ / ✖ / –
}

interface StepBase {
  index: number;
  section: string;
  subSection?: string;
  headerCells?: string[];
  cells: string[];
  lineHtml?: string;
  kind: 'line' | 'data';
  lineContentHtml?: string;
}

interface Step extends StepBase {
  _injectedValue?: boolean;
  _prevValue?: string;
  _rfidStatus?: RFIDStatus;
  // Optional: bei Wechsel-Modus Quelle-Zellen behalten (vorherige Formatwerte)
  _fromCells?: string[];
}

// ---------- Responsive Utilities ----------
function useViewport() {
  const [width, setWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1920);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { width, isMobile: width < 640, isTablet: width >= 640 && width < 1024 };
}

// ---------- HTML parsing helpers (extracted to reduce cognitive complexity) ----------
const ICON_IMG_REGEX = /<img([^>]*class="[^"]*icon[^"]*"[^>]*)>/gi;
const GENERIC_IMG_REGEX = /<img(?![^>]*icon)([^>]*)>/gi;
const TD_CELL_REGEX_GLOBAL = /<td[^>]*>[\s\S]*?<\/td>/gi;
const TD_CELL_REGEX_SINGLE = /<td[^>]*>([\s\S]*?)<\/td>/i;

function normalizeImagesBlock(html: string) {
  return html
    .replace(ICON_IMG_REGEX, (_, attrs) => {
      const cleaned = attrs.replace(/style="[^"]*"/gi, '');
      return `<img ${cleaned} style="height:18px;display:inline-block;vertical-align:middle;margin:0 4px 0 2px;" />`;
    })
    .replace(GENERIC_IMG_REGEX, (_, attrs) => {
      const cleaned = attrs.replace(/style="[^"]*"/gi, '');
      return `<img ${cleaned} style="height:18px;display:inline-block;vertical-align:middle;margin:0 4px 0 2px;" />`;
    });
}

function extractCells(rawTr: string): string[] {
  const matches = rawTr.match(TD_CELL_REGEX_GLOBAL) || [];
  return matches.map(td => {
    const m = TD_CELL_REGEX_SINGLE.exec(td);
    return m ? m[1].trim() : '';
  });
}

function buildLineRowHtml(raw: string | undefined, fontSize: string): string | undefined {
  if (!raw) return raw;
  const cells = extractCells(raw);
  if (cells.length < 2) return raw;
  const arrow = '→';
  let body = cells[1]
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  body = normalizeImagesBlock(body);
  return `<div style="display:flex;align-items:center;gap:10px;font-size:${fontSize};color:#111;line-height:1.3;font-weight:400;">`
    + `<span style="font-weight:600;min-width:18px;">${arrow}</span>`
    + `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:nowrap;">${body}</span>`
    + `</div>`;
}

function prepareSteps(rowsMeta: RowMeta[], fontSize: string): Step[] {
  const prepared: Step[] = [];
  let currentSection: string | null = null;
  let currentHeaderCells: string[] | undefined; // persistent header
  let currentSubSection: string | null = null;
  let currentLineHtml: string | undefined;
  rowsMeta.forEach((row: RowMeta, idx: number) => {
    const text = (row?.text || '').trim();
    if (!text) return;
    switch (row.row_type) {
      case 'caption_line':
        currentSection = text;
        currentSubSection = null;
        currentLineHtml = row.html || undefined;
        return;
      case 'caption': {
        if (row.cells && row.cells.length > 3) {
          const first = (row.cells[0] || '').toString().toLowerCase();
          const second = (row.cells[1] || '').toString().toLowerCase();
          const looksLikeHeader = (first.startsWith('nr') || first === 'nr.') && second.includes('umstell');
          if (looksLikeHeader) {
            currentHeaderCells = row.cells;
            return;
          }
        }
        currentHeaderCells = row.cells?.length ? row.cells : currentHeaderCells;
        currentSubSection = text;
        return;
      }
      case 'data': {
        if (Array.isArray(row.classes) && row.classes.includes('line') && !row.classes.includes('caption')) {
          const sectionName = currentSection || 'Allgemeine Vorbereitung';
          prepared.push({
            index: idx,
            section: sectionName,
            subSection: undefined,
            headerCells: undefined,
            cells: [],
            lineHtml: currentLineHtml,
            kind: 'line',
            lineContentHtml: buildLineRowHtml(row.html || undefined, fontSize),
          });
          return;
        }
        if (!currentSection) return;
        prepared.push({
          index: idx,
          section: currentSection,
          subSection: currentSubSection || undefined,
          headerCells: currentHeaderCells,
          cells: row.cells || [],
          lineHtml: currentLineHtml,
          kind: 'data'
        });
        return;
      }
      default:
        return;
    }
  });
  return prepared;
}

export default function CustomerPage() {
  const { t, lang } = useI18n();
  const { isMobile, isTablet, width } = useViewport();
  // Fetch color from config
  const [color, setColor] = React.useState<string>("#1976d2");
  React.useEffect(() => {
    const url = (typeof BACKEND_URL === 'string' && BACKEND_URL) ? `${BACKEND_URL}/api/config` : '/api/config';
    fetch(url)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data && typeof data.COLOR === "string") setColor(data.COLOR);
        else if (data && typeof data.THEME_COLOR === "string") setColor(data.THEME_COLOR);
      })
      .catch(() => { /* ignore errors silently */ });
  }, []);

  // Listen for color updates from settings (other tabs/pages)
  useEffect(() => {
    try {
      const bc = new BroadcastChannel('somic-config-updates');
      const onMsg = (ev: MessageEvent) => {
        const d = ev.data as { THEME_COLOR?: string } | null;
        if (d && typeof d.THEME_COLOR === 'string') setColor(d.THEME_COLOR);
      };
      bc.addEventListener('message', onMsg);
      return () => { bc.removeEventListener('message', onMsg); bc.close(); };
    } catch {
      // BroadcastChannel not supported; ignore
      return () => { };
    }
  }, []);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [footerHtml, setFooterHtml] = useState<string | null>(null);
  // Upload/Kamera State
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPartId] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  // Anleitung standardmäßig ausgeblendet
  const [showSteps, setShowSteps] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  // Format Auswahl
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const [formatNames, setFormatNames] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  // Neuer Wechsel / Diff Modus
  const [fromFormat, setFromFormat] = useState<string | null>(null);
  const [toFormat, setToFormat] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<boolean>(false); // Wenn aktiv: zeige nur Schritte mit Unterschieden zwischen zwei Formaten
  const [formatLoading, setFormatLoading] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  // Layout / Style Konstanten für den Step-Block (responsive)
  // Dynamische Schriftgröße anhand verfügbarer Breite (clamp Logik)
  const STEP_FONT_SIZE = React.useMemo(() => {
    if (width < 380) return '.58rem';
    if (width < 440) return '.62rem';
    if (width < 520) return '.68rem';
    if (width < 640) return '.72rem';
    if (width < 820) return '.8rem';
    if (width < 1100) return '.88rem';
    return '.95rem';
  }, [width]);
  // Tabellen-Skalierung (horizontale Anpassung): skaliert Tabelle proportional, wenn sie breiter ist als Container
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [tableScale, setTableScale] = useState(1);
  const compactTable = width < 560; // Kompakter Modus: volle Breite, Wrap statt horizontalem Scroll
  useLayoutEffect(() => {
    if (compactTable) { setTableScale(1); return; }
    const cont = tableContainerRef.current;
    const tbl = tableRef.current;
    if (!cont || !tbl) return;
    const available = cont.clientWidth;
    const natural = tbl.scrollWidth;
    if (natural === 0) return;
    const scale = available / natural;
    const clamped = scale < 1 ? Math.max(scale, 0.55) : 1;
    setTableScale(clamped);
  }, [width, isMobile, isTablet, STEP_FONT_SIZE, compactTable]);
  // Optionale feste Spaltenbreiten (Reihenfolge wie Header: Nr. | Umstellpunkt | Wert | FTL. | Wagen | Bemerkung)
  type ColWidths = (string | number)[];
  const COLUMN_WIDTHS_BY_COUNT: Record<number, ColWidths> = {
    // 6 Spalten: Nr. | Umstellpunkt | Wert | FTL. | Wagen | Bemerkung
    6: ['5%', '45%', '10%', '10%', '10%', '20%'],
    // 5 Spalten: Nr. | Umstellpunkt | Wert | FTL. | Bemerkung
    5: ['6%', '52%', '11%', '11%', '20%'],
  };
  // RFID Status-Spalte wird dynamisch angezeigt, kein Konstante nötig
  // Farb-Konfiguration könnte später über Settings kommen (derzeit direkt im JSX benutzt)

  // Beim Laden die aktuelle Datei vom Server holen
  useEffect(() => {
    fetch("/api/customer-html")
      .then((res) => (res.ok ? res.text() : null))
      .then((html) => {
        if (html) {
          // Inject a meta with backend origin so injected JS (somic-rfid.js) can resolve the correct host:port
          // This is critical when the page is served via a random mapped port.
          let injectedHtml = html;
          try {
            const safeOrigin = (typeof BACKEND_URL === 'string' && BACKEND_URL) ? BACKEND_URL : (typeof window !== 'undefined' ? window.location.origin : '');
            if (safeOrigin && /<head\b[^>]*>/i.test(injectedHtml)) {
              injectedHtml = injectedHtml.replace(/<head(\b[^>]*)>/i, `<head$1><meta name="somic-backend-origin" content="${safeOrigin}">`);
            } else if (safeOrigin) {
              // Fallback: prepend meta if no <head> tag present
              injectedHtml = `<meta name="somic-backend-origin" content="${safeOrigin}">` + injectedHtml;
            }
          } catch { /* ignore */ }
          // Erzeuge ein Blob-URL für das HTML
          const blob = new Blob([injectedHtml], { type: "text/html" });
          setFileUrl(URL.createObjectURL(blob));
          try {
            // Versuche Footer-Block aus dem HTML zu extrahieren (inkl. <footer>..</footer>)
            const m = /<footer\b[^>]*>[\s\S]*?<\/footer>/i.exec(injectedHtml);
            if (m && m[0]) setFooterHtml(m[0]);
            else setFooterHtml(null);
          } catch {
            setFooterHtml(null);
          }
        }
      });
  }, []);

  // Page Scroll komplett deaktivieren (nur interne Container / iframe dürfen scrollen)
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.height = '100%';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
      html.style.overscrollBehavior = '';
      body.style.overscrollBehavior = '';
    };
  }, []);

  // Lade geparste Tabellen-Zeilen aus Backend und bereite Steps auf
  useEffect(() => {
    const loadSteps = async () => {
      setStepsLoading(true);
      setStepsError(null);
      try {
        const data = await apiClient.getMainTableRows({ asHtml: true, withMeta: true, duplicateCaption: false }) as { rowsMeta?: RowMeta[] };
        const rowsMeta = data.rowsMeta;
        if (!rowsMeta) { setSteps([]); return; }
        setSteps(prepareSteps(rowsMeta, STEP_FONT_SIZE));
        setCurrentStep(0);
      } catch (e) {
        setStepsError(e instanceof Error ? e.message : t('steps_load_error'));
      } finally {
        setStepsLoading(false);
      }
    };
    loadSteps();
  }, [STEP_FONT_SIZE, t]);

  // Formate laden
  useEffect(() => {
    const loadFormats = async () => {
      setFormatLoading(true); setFormatError(null);
      try {
        // Verwende Backend API Client (verhindert 404 auf Next.js eigener /api Route)
        const json = await apiClient.getFormats() as { formats?: Record<string, unknown> };
        const fmts = json.formats || {};
        setFormats(fmts);
        setFormatNames(Object.keys(fmts));
      } catch (e) {
        setFormatError(e instanceof Error ? e.message : t('unknown_error'));
      } finally { setFormatLoading(false); }
    };
    loadFormats();
  }, [t]);

  // Format-Detaildaten (inkl. valueIndexMap) laden sobald ein Format gewählt ist
  const [formatDetail, setFormatDetail] = React.useState<FormatDetail | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    interface FormatDataApiResponse { success?: boolean; data?: FormatDetail }
    const loadDetail = async () => {
      if (!selectedFormat) { setFormatDetail(null); return; }
      try {
        const detail = await apiClient.getFormatData() as FormatDataApiResponse;
        if (!cancelled && detail?.success && detail.data) {
          setFormatDetail(detail.data);
        }
      } catch {
        if (!cancelled) setFormatDetail(null);
      }
    };
    loadDetail();
    return () => { cancelled = true; };
  }, [selectedFormat]);

  // Werte aus gewähltem Format in Steps projizieren (nutzt valueIndexMap + items)
  // Hilfsfunktion: injiziert Werte eines bestimmten Formats in eine Kopie der Steps und liefert Map index->cells
  const injectFormat = useCallback((formatName: string | null) => {
    if (!formatName || !formats[formatName]) return new Map<number, { cells: string[]; injected?: boolean }>();
    const fmt = formats[formatName];
    const allFormatsFromDetail = formatDetail?.formats || {};
    const detailFmt = allFormatsFromDetail[formatName] || fmt;
    const dataItems: FormatItem[] = Array.isArray((detailFmt as { data?: unknown })?.data)
      ? (detailFmt as { data?: FormatItem[] }).data || []
      : [];
    const valueIndexMap: Record<number, string> = (formatDetail?.valueIndexMap) || {};
    const numberToValue: Record<string, string> = {};
    const numberToFTL: Record<string, string> = {};
    const numberToCart: Record<string, string> = {};
    dataItems.forEach((it, idx) => {
      if (!it || typeof it !== 'object') return;
      const dataPos = idx;
      const visible = (it.valueIndex) || valueIndexMap[dataPos] || valueIndexMap[dataPos + 1] || '';
      const rawVal = it.value ?? it.formatValue ?? '';
      const val = (rawVal || '').toString().trim();
      const ftl = (it.formatPart || '').toString().trim();
      const cart = (it.cart || '').toString().trim();
      const isPlaceholder = val.toLowerCase() === 'wert' && (ftl.toLowerCase() === 'ftl.' || ftl.toLowerCase() === 'ftl') && cart.toLowerCase() === 'wagen';
      if (isPlaceholder) return;
      if (visible) {
        if (val && !numberToValue[visible]) numberToValue[visible] = val;
        if (ftl && !numberToFTL[visible]) numberToFTL[visible] = ftl;
        if (cart && !numberToCart[visible]) numberToCart[visible] = cart;
      }
    });
    const map = new Map<number, { cells: string[]; injected?: boolean }>();
    steps.forEach(s => {
      if (s.kind !== 'data' || !s.cells.length) return;
      const nr = (s.cells[0] || '').toString().trim();
      if (!nr) return;
      const val = numberToValue[nr];
      const ftl = numberToFTL[nr];
      const cart = numberToCart[nr];
      if (!val && !ftl && !cart) return; // Keine Änderungen
      const copy = [...s.cells];
      if (val) copy[2] = val;
      if (ftl) copy[3] = ftl;
      if (cart) copy[4] = cart;
      map.set(s.index, { cells: copy, injected: !!val });
    });
    return map;
  }, [steps, formats, formatDetail]);

  // Enriched Steps (Single Format) oder Unterschieds-Liste bei diffMode
  const enrichedSteps = React.useMemo(() => {
    // Wechselmodus aktiv? -> Filter nur veränderte data Steps behalten (plus alle line Steps)
    if (diffMode && fromFormat && toFormat && fromFormat !== toFormat) {
      const fromMap = injectFormat(fromFormat);
      const toMap = injectFormat(toFormat);
      const filtered: Step[] = [];
      steps.forEach(s => {
        if (s.kind === 'line') { // Linien immer behalten
          filtered.push(s);
          return;
        }
        if (s.kind === 'data') {
          const fromEntry = fromMap.get(s.index);
          const toEntry = toMap.get(s.index);
          // Falls Ziel ohne Änderung -> Schritt überspringen
          if (!toEntry && !fromEntry) return; // Keine Änderung in beiden
          // Entscheide ob relevante Spalten geändert wurden (2=Wert,3=FTL.,4=Wagen)
          const baseCells = [...s.cells];
          const fromCells = fromEntry ? fromEntry.cells : baseCells;
          const toCells = toEntry ? toEntry.cells : baseCells;
          const changed = [2, 3, 4].some(i => (fromCells[i] || '').toString().trim() !== (toCells[i] || '').toString().trim());
          if (!changed) return;
          const stepCells = [...toCells];
          const prevVal = s.cells[2];
          filtered.push({ ...s, cells: stepCells, _injectedValue: changed, _prevValue: prevVal, _fromCells: fromCells });
        }
      });
      return filtered;
    }
    // Normaler Einzel-Format Modus
    if (!selectedFormat || !formats[selectedFormat]) return steps;
    const singleMap = injectFormat(selectedFormat);
    return steps.map(s => {
      if (s.kind !== 'data') return s;
      const m = singleMap.get(s.index);
      if (!m) return s;
      const prevVal = s.cells[2];
      return { ...s, cells: m.cells, _injectedValue: m.injected, _prevValue: prevVal };
    });
  }, [steps, selectedFormat, formats, diffMode, fromFormat, toFormat, injectFormat]);

  // --- RFID Assignments + Live Sichtbarkeit ---
  const [assignments, setAssignments] = React.useState<AssignmentsMap>({}); // format_part -> { rfid_tag_id }
  const [liveEventTagIds, setLiveEventTagIds] = React.useState<Set<string>>(new Set());
  // Einheitliche Normalisierung für Tag-IDs (robust gegen Bindestriche/Leerzeichen etc.)
  const normalizeTagId = useCallback((t: unknown) => {
    return (t ?? '')
      .toString()
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }, []);
  // Assignments nur beim (erstmaligen) Laden und wenn Format gewechselt wird holen (statt Dauer-Polling)
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const json = await apiClient.getFormatAssignments() as { success?: boolean; assignments?: AssignmentsMap };
        if (!cancelled && json?.success && json.assignments) setAssignments(json.assignments);
      } catch { }
    };
    fetchOnce();
    return () => { cancelled = true; };
  }, [selectedFormat]);
  // WebSocket für Live-Event-IDs (aus /api/live-event-ids) + Assignments Updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    // Resolve a base HTTP URL once for both WS and initial snapshot
    let resolvedBaseHttp = '';
    try {
        let tmp = process.env.NEXT_PUBLIC_BACKEND_URL || '';
        if (!tmp) {
          try {
            // Prefer the full origin (protocol + host + port) so mapped ports like :4444 are preserved
            if (typeof window !== 'undefined' && window.location && window.location.origin) {
              tmp = window.location.origin;
            } else {
              const p = (process.env.NEXT_PUBLIC_BACKEND_PORT as string) || '8001';
              tmp = `http://localhost:${p}`;
            }
          } catch {
            const p = (process.env.NEXT_PUBLIC_BACKEND_PORT as string) || '8001';
            tmp = `http://localhost:${p}`;
          }
        }
      resolvedBaseHttp = tmp;
    } catch {
      // ignore
    }
    const connect = () => {
      try {
        const base = resolvedBaseHttp.replace(/^http/, 'ws');
        const url = `${base}/ws/opc-ua`;
        ws = new WebSocket(url);
        ws.onmessage = (ev: MessageEvent) => {
          try {
            const raw = JSON.parse(ev.data) as unknown;
            if (typeof raw !== 'object' || raw === null) return;
            const msg = raw as Record<string, unknown>;
            // Quelle für Live-Anzeige ist ausschließlich der WS-Stream "live_event_ids",
            // der semantisch den HTTP-Endpoint /api/live-event-ids widerspiegelt.
            if (msg.type === 'live_event_ids' && Array.isArray(msg.ids)) {
              const norm = (msg.ids as unknown[])
                .map(t => normalizeTagId(t))
                .filter((t: string) => t.length > 0);
              // Immer neue Set-Instanz erzeugen, damit React Referenzänderung erkennt
              setLiveEventTagIds(new Set(norm));
            } else if (msg.type === 'assignments_update' && msg.assignments) {
              setAssignments(msg.assignments as AssignmentsMap);
            }
          } catch { }
        };
        ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      } catch { }
    };
    connect();
    // Initial HTTP snapshot so UI shows immediately without manual refresh
    (async () => {
      try {
        const httpBase = resolvedBaseHttp || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '');
        const snap = await fetch(`${httpBase.replace(/\/$/, '')}/api/live-event-ids`).then(r => r.ok ? r.json() : null);
        if (snap && Array.isArray(snap.ids)) {
          const norm = (snap.ids as unknown[]).map(t => normalizeTagId(t)).filter((t: string) => t.length > 0);
          setLiveEventTagIds(new Set(norm));
        }
      } catch { }
    })();
    return () => { closed = true; if (ws) ws.close(); };
  }, [normalizeTagId]);

  // Hilfsfunktion: aus Datenzeile (Nr. + FTL.) einen FormatPart-Key ableiten wie in Assignments (combinedPerFormat nutzt "<valueIndex> <part>")
  const deriveFormatPartKey = (row: Step): string | null => {
    if (!row || row.kind !== 'data') return null;
    const nrRaw = (row.cells?.[0] || '').toString().trim();
    const ftlRaw = (row.cells?.[3] || '').toString().trim();
    if (!nrRaw || !ftlRaw) return null;
    // Primärschlüssel wie gespeichert: "<sichtbare Zahl> <formatPart>" (Original: valueIndex + part)
    // Falls Original evtl. ohne Normalisierung gespeichert wurde, erzeugen wir mehrere Varianten beim Lookup.
    return `${nrRaw} ${ftlRaw}`.trim();
  };

  // Steps um Status-Spalte erweitern
  const stepsWithStatus: Step[] = React.useMemo(() => {
    return enrichedSteps.map<Step>(s => {
      if (s.kind !== 'data' || !s.cells.length) return s;
      const key = deriveFormatPartKey(s);
      if (!key) return s;
      let assignment = assignments[key];
      if (!assignment) {
        const alt1 = key.replace(/\s+/g, ' ').trim();
        assignment = assignments[alt1];
      }
      if (!assignment) {
        const alt2 = key.replace(/\./g, '').replace(/\s+/g, ' ').trim();
        assignment = assignments[alt2];
      }
      // assignment kann string oder objekt sein
      const rawTagId = typeof assignment === 'string'
        ? assignment
        : (assignment?.rfid_tag_id ?? (assignment as AssignmentsMapEntry | undefined)?.rfidTagId);
      const tagId = rawTagId ? rawTagId.toString().trim() : null;
      const normTag = tagId ? normalizeTagId(tagId) : null;
      const seen = normTag ? liveEventTagIds.has(normTag) : false;
      let symbol: string;
      if (!tagId) symbol = '–';
      else if (seen) symbol = '✔';
      else symbol = '✖';
      return { ...s, _rfidStatus: { seen, tagId, tagIdNorm: normTag, keyTried: key, symbol } };
    });
  }, [enrichedSteps, assignments, liveEventTagIds, normalizeTagId]);

  // --- Upload & Kamera Helpers/Handlers (after dependencies) ---
  const sanitizePart = useCallback((s: string) => s.replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 100), []);
  const isSecureForCamera = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const { protocol, hostname } = window.location;
    return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  }, []);


  const stopCamera = useCallback(() => {
    if (mediaStream) {
      try { mediaStream.getTracks().forEach(t => t.stop()); } catch { }
    }
    if (videoRef.current) {
      try { (videoRef.current as HTMLVideoElement).srcObject = null; } catch { }
    }
    setMediaStream(null);
  }, [mediaStream]);

  const closeUpload = useCallback(() => {
    stopCamera();
    setUploadOpen(false);
    setUploadMsg("");
  }, [stopCamera]);

  // Hilfsfunktion: Ableitung des Picture-Part Keys (Anlehnung an vorhandene Dateien z.B. 1_01-01_...)
  const derivePicturePartKey = useCallback((row: Step | undefined): string | null => {
    if (!row || row.kind !== 'data') return null;
    // Erwartete Struktur: cells[0] = Nr., cells[3] = FTL. (Formatteil). Nur laden wenn beides sinnvoll befüllt ist.
    const nr = (row.cells?.[0] || '').toString().trim();
    const ftl = (row.cells?.[3] || '').toString().trim();
    if (!nr || !ftl) return null;
    // Ignore offensichtliche Platzhalter wie 'FTL.' oder 'FTL'
    const ftlLower = ftl.toLowerCase();
    if (ftlLower === 'ftl.' || ftlLower === 'ftl') return null;
    // Schlüssel-Konvention: <Nr>_<FTL>
    const raw = `${nr}_${ftl}`;
    const cleaned = raw.replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 100);
    return cleaned || null;
  }, []);

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const files = e.target.files;
      if (!files || files.length === 0) { setUploadMsg(t('no_file_selected')); return; }
      const file = files[0];
      if (!uploadPartId) { setUploadMsg(t('no_format_part_selected')); return; }
      const part = sanitizePart(uploadPartId);
      const form = new FormData();
      form.append('file', file);
      setUploadMsg(t('uploading'));
      const resp = await fetch(`${BACKEND_URL}/api/pictures/${encodeURIComponent(part)}`, { method: 'POST', body: form });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`${t('upload_failed_prefix')} (${resp.status}): ${txt || resp.statusText}`);
      }
      const json = await resp.json() as { success?: boolean; filename?: string };
      if (!json?.success || !json.filename) throw new Error(t('unexpected_server_response'));
      setUploadMsg(`${t('upload_success')} ${json.filename}`);
      // Bildliste aktualisieren (zeige neuestes Bild)
      picturesCacheRef.current.set(part, [json.filename]);
      // Wenn aktueller Step zum gleichen Part gehört, aktualisieren
      const curKey = derivePicturePartKey(stepsWithStatus[currentStep]);
      if (curKey && sanitizePart(curKey) === part) {
        setCurrentPictures([json.filename]);
      }
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadMsg(`${t('error_prefix')} ${msg}`);
    }
  }, [uploadPartId, currentStep, stepsWithStatus, sanitizePart, derivePicturePartKey, t]);

  const toggleCamera = useCallback(async () => {
    try {
      if (mediaStream) { setUploadMsg(t('camera_already_active')); return; }
      if (!isSecureForCamera()) {
        setUploadMsg(t('camera_requires_https'));
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setUploadMsg(t('camera_api_unavailable'));
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (videoRef.current) {
        (videoRef.current as HTMLVideoElement).srcObject = stream;
      }
      setMediaStream(stream);
      setUploadMsg(t('camera_started'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadMsg(`${t('camera_error')}: ${msg}`);
    }
  }, [mediaStream, isSecureForCamera, t]);

  const takeSnapshot = useCallback(async () => {
    try {
      if (!mediaStream || !videoRef.current) { setUploadMsg(t('camera_not_active')); return; }
      if (!uploadPartId) { setUploadMsg(t('no_format_part_selected')); return; }
      const video = videoRef.current as HTMLVideoElement;
      const canvas = canvasRef.current as HTMLCanvasElement | null;
      if (!canvas) { setUploadMsg(t('no_canvas_available')); return; }
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { setUploadMsg(t('canvas_context_missing')); return; }
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const part = sanitizePart(uploadPartId);
      const form = new FormData();
      form.append('image_base64', dataUrl);
      setUploadMsg(t('saving_photo'));
      const resp = await fetch(`${BACKEND_URL}/api/pictures/${encodeURIComponent(part)}`, { method: 'POST', body: form });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`${t('upload_failed_prefix')} (${resp.status}): ${txt || resp.statusText}`);
      }
      const json = await resp.json() as { success?: boolean; filename?: string };
      if (!json?.success || !json.filename) throw new Error(t('unexpected_server_response'));
      setUploadMsg(`${t('photo_saved')}: ${json.filename}`);
      // Update pictures
      picturesCacheRef.current.set(part, [json.filename]);
      const curKey = derivePicturePartKey(stepsWithStatus[currentStep]);
      if (curKey && sanitizePart(curKey) === part) {
        setCurrentPictures([json.filename]);
      }
      stopCamera();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadMsg(`${t('error_prefix')} ${msg}`);
    }
  }, [mediaStream, uploadPartId, currentStep, stepsWithStatus, sanitizePart, stopCamera, derivePicturePartKey, t]);

  // Separater Satz für Statistik: im diffMode immer komplette Ziel-Format-Injektion statt gefilterter Unterschiede
  const statsStepsWithStatus: Step[] = React.useMemo(() => {
    if (!(diffMode && toFormat && toFormat !== fromFormat)) {
      return stepsWithStatus; // normaler Modus nutzt sichtbare Steps
    }
    // Volle Kopie aller Steps mit Ziel-Format-Injektion
    const targetMap = injectFormat(toFormat);
    const fullInjected = steps.map<Step>(s => {
      if (s.kind !== 'data') return s;
      const m = targetMap.get(s.index);
      if (!m) return s;
      return { ...s, cells: m.cells };
    });
    // Status darauf berechnen (gleiche Logik wie oben, dupliziert für Klarheit)
    return fullInjected.map<Step>(s => {
      if (s.kind !== 'data' || !s.cells.length) return s;
      const key = deriveFormatPartKey(s);
      if (!key) return s;
      let assignment = assignments[key];
      if (!assignment) {
        const alt1 = key.replace(/\s+/g, ' ').trim();
        assignment = assignments[alt1];
      }
      if (!assignment) {
        const alt2 = key.replace(/\./g, '').replace(/\s+/g, ' ').trim();
        assignment = assignments[alt2];
      }
      const rawTagId = typeof assignment === 'string'
        ? assignment
        : (assignment?.rfid_tag_id ?? (assignment as AssignmentsMapEntry | undefined)?.rfidTagId);
      const tagId = rawTagId ? rawTagId.toString().trim() : null;
      const normTag = tagId ? normalizeTagId(tagId) : null;
      const seen = normTag ? liveEventTagIds.has(normTag) : false;
      let symbol: string;
      if (!tagId) symbol = '–'; else if (seen) symbol = '✔'; else symbol = '✖';
      return { ...s, _rfidStatus: { seen, tagId, tagIdNorm: normTag, keyTried: key, symbol } };
    });
  }, [diffMode, toFormat, fromFormat, stepsWithStatus, injectFormat, steps, assignments, liveEventTagIds, normalizeTagId]);

  const current = stepsWithStatus[currentStep];
  const totalSteps = stepsWithStatus.length;
  // Bild-Preview Overlay
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null);
  // Dynamische Max-Höhe für Inline-Bild (kein Scroll nötig)
  const inlineImageMaxHeight = React.useMemo(() => {
    if (width < 480) return '26vh';
    if (width < 680) return '30vh';
    if (width < 900) return '34vh';
    if (width < 1200) return '38vh';
    return '42vh';
  }, [width]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep iframe language in sync when toggled
  useEffect(() => {
    try {
      type IframeWin = Window & { setLanguage?: (l: string) => void };
      const win = htmlIframeRef.current?.contentWindow as IframeWin | null;
      if (win?.setLanguage) {
        win.setLanguage(lang);
      } else if (htmlIframeRef.current?.contentWindow) {
        htmlIframeRef.current.contentWindow.postMessage({ type: 'set-language', lang }, '*');
      }
    } catch { /* ignore */ }
  }, [lang]);

  // --- Bilder für aktuellen Schritt ---
  const [currentPictures, setCurrentPictures] = useState<string[]>([]);
  const [pictureLoading, setPictureLoading] = useState(false);
  const picturesCacheRef = useRef<Map<string, string[]>>(new Map());


  // Bilder laden wenn Schritt wechselt
  useEffect(() => {
    if (!showSteps) { setCurrentPictures([]); return; }
    const step = stepsWithStatus[currentStep];
    const key = derivePicturePartKey(step);
    if (!key) { setCurrentPictures([]); return; }
    if (picturesCacheRef.current.has(key)) {
      setCurrentPictures(picturesCacheRef.current.get(key)!);
      return;
    }
    setPictureLoading(true);
    apiClient.getPicturesByPart(key)
      .then(resp => {
        const list = Array.isArray(resp?.files) ? resp.files : [];
        // Backend liefert sortiert (lexikographisch). Neueste = letzte (Timestamp im Namen).
        const newest = list.length ? list[list.length - 1] : undefined;
        const single = newest ? [newest] : [];
        picturesCacheRef.current.set(key, single);
        setCurrentPictures(single);
      })
      .catch(() => { setCurrentPictures([]); })
      .finally(() => setPictureLoading(false));
  }, [currentStep, showSteps, stepsWithStatus, derivePicturePartKey]);

  // Statistiken zu Assignments & Erkennung
  const rfidStats = React.useMemo(() => {
    const basis = statsStepsWithStatus;
    const rowsWithTag = basis.filter(r => r._rfidStatus?.tagId);
    const assignedTotal = rowsWithTag.length;
    const recognizedAssigned = rowsWithTag.filter(r => r._rfidStatus?.seen).length;
    const assignedNormSet = new Set(
      rowsWithTag
        .map(r => normalizeTagId(r._rfidStatus?.tagId))
        .filter(Boolean) as string[]
    );
    let foreignCount = 0;
    liveEventTagIds.forEach(t => { if (!assignedNormSet.has(t)) foreignCount++; });
    return { assignedTotal, recognizedAssigned, foreignCount };
  }, [statsStepsWithStatus, liveEventTagIds, normalizeTagId]);

  const hasPrev = currentStep > 0;
  const hasNext = currentStep < totalSteps - 1;
  const goto = useCallback((delta: number) => {
    setCurrentStep(s => {
      const length = totalSteps;
      const next = s + delta;
      if (next < 0) return 0;
      if (next >= length) return Math.max(0, length - 1);
      return next;
    });
  }, [totalSteps]);
  // Falls sich die sichtbare Länge ändert (z.B. Wechsel-Modus), Index einklappen
  useEffect(() => {
    if (currentStep >= totalSteps) {
      setCurrentStep(Math.max(0, totalSteps - 1));
    }
  }, [totalSteps, currentStep]);
  return (
    <div className="flex flex-col bg-white dark:bg-black" style={{ height: '100dvh', overflow: 'hidden' }}>
      <Header profile="Customer" />
      <main className="flex-1 w-full p-0 m-0" style={{ background: '#fff', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Steuerleiste */}
        <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #e5e5e5', background: '#fafafa', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: '.9rem', fontWeight: 600, margin: 0, letterSpacing: '.03em', color: '#222' }}>{t('step_by_step')}</h2>
            <button onClick={() => setShowSteps(s => !s)} style={{ fontSize: '.65rem', padding: '4px 8px', border: '1px solid #bbb', background: '#fff', borderRadius: 4, cursor: 'pointer', color: '#000' }}>
              {showSteps ? t('hide_guide') : t('show_guide')}
            </button>
          </div>
          {showSteps && stepsLoading && <div style={{ fontSize: '.75rem', color: '#555', marginTop: 4 }}>{t('loading_steps')}</div>}
          {showSteps && stepsError && <div style={{ fontSize: '.75rem', color: '#b00000', marginTop: 4 }}>{stepsError}</div>}
          {showSteps && !stepsLoading && !stepsError && steps.length === 0 && <div style={{ fontSize: '.75rem', color: '#555', marginTop: 4 }}>{t('no_steps_found')}</div>}
        </div>
        {/* Content Bereich der restliche Höhe füllt */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: showSteps ? '8px 10px' : 0, gap: showSteps ? 8 : 0, overflow: 'hidden' }}>
          {showSteps && current && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #e1e1e1', borderRadius: 6, padding: isMobile ? '6px 8px' : '8px 10px', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, position: 'relative', flexShrink: 0, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                {!diffMode && (
                  <>
                    <label htmlFor="formatSelect" style={{ fontSize: '.7rem', fontWeight: 600, color: '#222' }}>{t('format')}</label>
                    <select id="formatSelect"
                      value={selectedFormat || ''}
                      onChange={e => { setSelectedFormat(e.target.value || null); setCurrentStep(0); }}
                      style={{ fontSize: '.75rem', padding: '4px 6px', border: '1px solid #bbb', borderRadius: 4, background: '#fff', color: '#111', fontWeight: 500 }}
                    >
                      <option value=''>{t('choose_placeholder')}</option>
                      {formatNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {selectedFormat && <button title={t('reset_format_title')} onClick={() => { setSelectedFormat(null); setCurrentStep(0); }} style={{ fontSize: '.65rem', padding: '4px 6px', background: '#f4f4f4', color: '#222', border: '1px solid #bbb', borderRadius: 4, cursor: 'pointer' }}>{t('reset')}</button>}
                  </>
                )}
                {diffMode && (
                  <>
                    <label htmlFor="fromFormat" style={{ fontSize: '.7rem', fontWeight: 600, color: '#222' }}>{t('from')}</label>
                    <select id="fromFormat" value={fromFormat || ''} onChange={e => { setFromFormat(e.target.value || null); setCurrentStep(0); }} style={{ fontSize: '.75rem', padding: '4px 6px', border: '1px solid #bbb', borderRadius: 4, background: '#fff', color: '#111', fontWeight: 500 }}>
                      <option value=''>{t('source_placeholder')}</option>
                      {formatNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <label htmlFor="toFormat" style={{ fontSize: '.7rem', fontWeight: 600, color: '#222' }}>{t('to')}</label>
                    <select id="toFormat" value={toFormat || ''} onChange={e => { setToFormat(e.target.value || null); setCurrentStep(0); }} style={{ fontSize: '.75rem', padding: '4px 6px', border: '1px solid #bbb', borderRadius: 4, background: '#fff', color: '#111', fontWeight: 500 }}>
                      <option value=''>{t('target_placeholder')}</option>
                      {formatNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </>
                )}
                <button
                  title={t('diff_mode_title')}
                  onClick={() => { setDiffMode(m => !m); setCurrentStep(0); }}
                  style={{ fontSize: '.65rem', padding: '4px 6px', background: diffMode ? '#222' : '#f4f4f4', color: diffMode ? '#fff' : '#222', border: '1px solid #bbb', borderRadius: 4, cursor: 'pointer' }}>
                  {diffMode ? t('diff_mode_on') : t('diff_mode_off')}
                </button>
                {diffMode && fromFormat && toFormat && fromFormat === toFormat && (
                  <span style={{ fontSize: '.6rem', color: '#b00' }}>{t('choose_different_formats')}</span>
                )}
                {formatLoading && <span style={{ fontSize: '.65rem', color: '#444' }}>{t('loading_short')}</span>}
                {formatError && <span style={{ fontSize: '.65rem', color: '#b00' }}>{formatError}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: '.65rem', fontWeight: 600, color: '#222', flexWrap: 'wrap' }}>
                  <span title={t('recognized_vs_assigned')}>{rfidStats.recognizedAssigned}/{rfidStats.assignedTotal} {t('format_parts_recognized')}</span>
                  <span title={t('recognized_tags_without_assignment')} style={{ color: rfidStats.foreignCount ? '#b30000' : '#228822' }}>{rfidStats.foreignCount} {t('foreign_format_parts_detected')}</span>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Zentrier-Wrapper: zentriert vertikal bei freiem Platz, sonst normal top-aligned */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto', marginBottom: 'auto', alignSelf: 'stretch' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {current.kind === 'data' && (
                      <div style={{ fontSize: STEP_FONT_SIZE, fontWeight: 700, color: '#111', letterSpacing: '.06em', textTransform: 'uppercase' }}>{current.section}</div>
                    )}
                    {current.kind === 'data' && current.subSection && (
                      <div style={{ fontSize: STEP_FONT_SIZE, fontWeight: 600, color: '#222', letterSpacing: '.04em', textTransform: 'uppercase' }}>{current.subSection}</div>
                    )}
                    {current.kind === 'line' && current.lineContentHtml && (
                      <div style={{ fontSize: STEP_FONT_SIZE }} dangerouslySetInnerHTML={{ __html: current.lineContentHtml }} />
                    )}
                  </div>
                  {current.kind === 'data' && current.headerCells && (
                    <div ref={tableContainerRef} style={{ width: '100%', position: 'relative' }}>
                      <div
                        style={compactTable ? { width: '100%' } : { transform: `scale(${tableScale})`, transformOrigin: 'left top', width: tableScale < 1 ? `${100 / tableScale}%` : '100%', transition: 'transform .15s ease-out' }}>
                        <table ref={tableRef} style={{ borderCollapse: 'collapse', width: '100%', fontSize: STEP_FONT_SIZE, color: '#111', tableLayout: compactTable ? 'auto' : 'fixed', minWidth: compactTable ? 'auto' : 650 }}>
                          {!compactTable && COLUMN_WIDTHS_BY_COUNT[current.headerCells.length] && (
                            <colgroup>
                              {COLUMN_WIDTHS_BY_COUNT[current.headerCells.length].map((w, i) => {
                                const colKey = `col_${current.headerCells?.[i] || i}`;
                                return <col key={colKey} style={{ width: typeof w === 'number' ? `${w}px` : w }} />;
                              })}
                              {current._rfidStatus && <col style={{ width: '6%' }} />}
                            </colgroup>
                          )}
                          <thead>
                            <tr>
                              {current.headerCells.map((h: string) => {
                                const key = 'h_' + (h || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
                                const totalCols = current.headerCells!.length + (current._rfidStatus ? 1 : 0);
                                const hasFixed = !compactTable && !!COLUMN_WIDTHS_BY_COUNT[current.headerCells!.length];
                                const widthAuto = hasFixed ? undefined : `${100 / Math.max(totalCols, 1)}%`;
                                return <th key={key} style={{ border: '1px solid #b7b7b7', padding: '6px 6px', background: '#e9ecef', textAlign: 'left', fontWeight: 600, overflow: compactTable ? 'visible' : 'hidden', textOverflow: compactTable ? 'clip' : 'ellipsis', whiteSpace: compactTable ? 'normal' : 'nowrap', width: widthAuto, color: '#222', fontSize: STEP_FONT_SIZE, lineHeight: 1.15 }}>{h}</th>;
                              })}
                              {current._rfidStatus && (() => {
                                const totalCols = current.headerCells!.length + 1;
                                const hasFixed = !compactTable && !!COLUMN_WIDTHS_BY_COUNT[current.headerCells!.length];
                                const widthAuto = hasFixed ? undefined : `${100 / Math.max(totalCols, 1)}%`;
                                return (
                                  <th style={{ border: '1px solid #b7b7b7', padding: '6px 8px', background: '#e9ecef', textAlign: 'left', fontWeight: 600, fontSize: STEP_FONT_SIZE, width: widthAuto }}>RFID</th>
                                );
                              })()}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {current.cells.map((c: string, i: number) => {
                                const key = 'c_' + (c || '').toString().trim().toLowerCase().replace(/\s+/g, '_') + '_' + i;
                                const injected = current._injectedValue && [2, 3, 4].includes(i);
                                const fromVal = diffMode && current._fromCells ? current._fromCells[i] : undefined;
                                const changed = diffMode && fromVal !== undefined && fromVal !== c && [2, 3, 4].includes(i);
                                let cellStyle: React.CSSProperties = {
                                  border: '1px solid #c5c5c5',
                                  padding: '6px 6px',
                                  background: changed ? '#ffe8e6' : (injected ? '#fff9e6' : '#fff'),
                                  fontSize: STEP_FONT_SIZE,
                                  overflow: compactTable ? 'visible' : 'hidden',
                                  textOverflow: compactTable ? 'clip' : 'ellipsis',
                                  whiteSpace: compactTable ? 'normal' : 'nowrap',
                                  wordBreak: compactTable ? 'break-word' : 'normal',
                                  fontWeight: changed ? 700 : (injected ? 600 : 400),
                                  color: '#111',
                                  lineHeight: 1.25,
                                  verticalAlign: 'top'
                                };
                                // Apply color to FTL. column
                                // Todo: Improve logic to detect FTL./Nr. column 
                                if (current.headerCells && current.headerCells[i] && current.headerCells[i].toLowerCase().replace(/\./g, "") === "nr") {
                                  cellStyle = { ...cellStyle, background: color, color: '#fff', fontWeight: 600 };
                                }
                                return <td key={key} style={cellStyle}>
                                  {changed ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <span>{c}</span>
                                      {fromVal && <span style={{ fontSize: '0.55rem', color: '#b00', fontWeight: 500 }}>{t('old_value_prefix')} {fromVal}</span>}
                                    </div>
                                  ) : c}
                                </td>;
                              })}
                              {current._rfidStatus && (() => {
                                const rs = current._rfidStatus;
                                let rfidColor = '#666';
                                if (rs.tagId) rfidColor = rs.seen ? '#0a7a15' : '#b30000';
                                // Background color by symbol/state
                                let bg = '#fff';
                                if (rs.tagId) {
                                  bg = rs.seen ? '#99e47cff' : '#ec7e7eff';
                                }
                                let titleText: string;
                                if (!rs.tagId) titleText = `${t('no_rfid_assigned')} | ${t('key')}=${rs.keyTried}`;
                                else if (rs.seen) titleText = `${t('tag')} ${rs.tagId} ${t('detected')} | ${t('key')}=${rs.keyTried} | ${t('norm')}=${rs.tagIdNorm}`;
                                else titleText = `${t('tag')} ${rs.tagId} ${t('not_detected')} | ${t('key')}=${rs.keyTried} | ${t('norm')}=${rs.tagIdNorm}`;
                                return (
                                  <td
                                    style={{
                                      border: '1px solid #c5c5c5',
                                      padding: '6px 8px',
                                      background: bg,
                                      fontSize: STEP_FONT_SIZE,
                                      fontWeight: 700,
                                      color: rfidColor,
                                      textAlign: 'center',
                                      verticalAlign: 'middle',
                                    }}
                                    title={titleText}
                                  >
                                    {rs.symbol}
                                  </td>
                                );
                              })()}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {!compactTable && tableScale < 1 && (
                        <div style={{ position: 'absolute', right: 4, bottom: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: '.55rem', letterSpacing: '.05em' }}>{t('scaled')} {Math.round(tableScale * 100)}%</div>
                      )}
                    </div>
                  )}
                  {/* Bilder Bereich */}
                  {/* Bilder nur anzeigen, wenn es sich um einen echten Formatteil handelt UND mindestens 1 Bild vorhanden oder gerade lädt */}
                  {current.kind === 'data' && (() => {
                    const key = derivePicturePartKey(current);
                    if (!key) return null; // kein echtes Formatteil
                    return (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {/*
                      {/* Upload/Aktionen 
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <button
                          type="button"
                          onClick={() => { setUploadPartId(key); setUploadOpen(true); setUploadMsg(""); }}
                          style={{ fontSize: '.7rem', padding:'4px 8px', background:'#f4f4f4', color:'#000', border:'1px solid #bbb', borderRadius:4, cursor:'pointer' }}
                        >Upload</button>
                        {uploadOpen && uploadPartId === key && (
                          <span style={{ fontSize:'.65rem', color:'#000' }}>{uploadMsg}</span>
                        )}
                      </div>
                      */}
                        {pictureLoading && <div style={{ fontSize: STEP_FONT_SIZE, color: '#555' }}>{t('loading_image')}</div>}
                        {!pictureLoading && currentPictures.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: STEP_FONT_SIZE, fontWeight: 600, color: '#222' }}>{t('image')}</div>
                            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-start' }}>
                              {currentPictures.map(fn => {
                                const src = `${BACKEND_URL}/pictures/${encodeURIComponent(fn)}`;
                                return (
                                  <div key={fn} style={{ position: 'relative', maxWidth: '100%', flex: '0 1 auto', border: '1px solid #ddd', borderRadius: 6, padding: 4, background: '#fafafa' }}>
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => setPreviewImage(src)}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewImage(src); } }}
                                      style={{ outline: 'none', cursor: 'pointer', maxWidth: '100%' }}
                                    >
                                      <img
                                        src={src}
                                        alt={fn}
                                        style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: inlineImageMaxHeight, objectFit: 'contain', borderRadius: 4 }}
                                        loading="lazy"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!pictureLoading && currentPictures.length === 0 && (
                          <div style={{ fontSize: '.55rem', color: '#777' }}>{t('no_image_available')}</div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {/* Footer aus dem gecachten customer HTML anzeigen, falls vorhanden (innerhalb des scrollbaren Bereichs) */}
                {footerHtml && (
                  <div style={{ marginTop: 6, borderTop: '1px solid #e6e6e6', paddingTop: 8, color: '#333', fontSize: '.78rem' }} dangerouslySetInnerHTML={{ __html: footerHtml }} />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexShrink: 0 }}>
                <button onClick={() => goto(-1)} disabled={!hasPrev} style={{ padding: '6px 12px', fontSize: STEP_FONT_SIZE, background: hasPrev ? '#222' : '#999', color: '#fff', border: 'none', borderRadius: 4, cursor: hasPrev ? 'pointer' : 'not-allowed' }}>{t('back')}</button>
                <button onClick={() => goto(1)} disabled={!hasNext} style={{ padding: '6px 12px', fontSize: STEP_FONT_SIZE, background: hasNext ? '#0069d9' : '#999', color: '#fff', border: 'none', borderRadius: 4, cursor: hasNext ? 'pointer' : 'not-allowed' }}>{t('next')}</button>
                <div style={{ fontSize: STEP_FONT_SIZE, color: '#111', marginLeft: 'auto', fontWeight: 500 }}>{t('step')} {currentStep + 1} / {totalSteps}</div>
              </div>
              <input type="range" min={0} max={Math.max(totalSteps - 1, 0)} value={currentStep} onChange={e => setCurrentStep(Number(e.target.value))} style={{ width: '100%', marginTop: 6 }} />
            </div>
          )}
          {!showSteps && fileUrl && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <iframe
                src={fileUrl}
                title={t('external_html')}
                style={{ width: '100%', flex: 1, border: 'none', background: '#fff', display: 'block', overflow: 'auto' }}
                ref={htmlIframeRef}
                onLoad={() => {
                  try {
                    type IframeWin = Window & { setLanguage?: (l: string) => void };
                    const win = htmlIframeRef.current?.contentWindow as IframeWin | null;
                    if (win?.setLanguage) {
                      win.setLanguage(lang);
                    } else if (htmlIframeRef.current?.contentWindow) {
                      htmlIframeRef.current.contentWindow.postMessage({ type: 'set-language', lang }, '*');
                    }
                  } catch { /* ignore */ }
                }}
              />
            </div>
          )}
        </div>
      </main>
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '4vw' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ position: 'relative', maxWidth: '94vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: 4, fontSize: '.7rem', cursor: 'pointer' }}
            >{t('close')} ✕</button>
            <img
              src={previewImage}
              alt={t('preview')}
              style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 6, boxShadow: '0 4px 18px rgba(0,0,0,0.4)' }}
            />
          </div>
        </div>
      )}
      {/* Upload Modal */}
      {uploadOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => closeUpload()}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 16, minWidth: 280, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#000' }}>{t('upload_image')}{uploadPartId ? ` ${t('for')} ${uploadPartId}` : ''}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileSelected} />
              <button type="button" onClick={() => fileInputRef.current?.click()} style={{ padding: '6px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#f4f4f4', cursor: 'pointer', color: '#000' }}>{t('choose_file')}</button>
              <button type="button" onClick={toggleCamera} style={{ padding: '6px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#f4f4f4', cursor: 'pointer', color: '#000' }}>{mediaStream ? t('camera_running') : t('camera')}</button>
              <button type="button" onClick={() => closeUpload()} style={{ padding: '6px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#f4f4f4', cursor: 'pointer', color: '#000' }}>{t('close')}</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <video ref={videoRef} autoPlay playsInline style={{ display: mediaStream ? 'block' : 'none', maxWidth: '80vw', maxHeight: '40vh', border: '1px solid #ddd', borderRadius: 4 }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {mediaStream && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={takeSnapshot} style={{ padding: '6px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#f4f4f4', cursor: 'pointer', color: '#000' }}>{t('take_photo')}</button>
                  <button type="button" onClick={stopCamera} style={{ padding: '6px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#f4f4f4', cursor: 'pointer', color: '#000' }}>{t('stop_camera')}</button>
                </div>
              )}
            </div>
            <div style={{ minHeight: 18, fontSize: '.8rem', color: '#000' }}>{uploadMsg}</div>
          </div>
        </div>
      )}
    </div>
  );
}