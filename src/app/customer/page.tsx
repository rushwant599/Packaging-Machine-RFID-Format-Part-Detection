"use client";
import Header from "@/components/Header";
import React, { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

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

interface AssignmentsMapEntry { rfid_tag_id?: string; rfidTagId?: string; [k: string]: unknown }
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
}

export default function CustomerPage() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [showSteps, setShowSteps] = useState(true);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  // Format Auswahl
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const [formatNames, setFormatNames] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [formatLoading, setFormatLoading] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  // Layout / Style Konstanten für den Step-Block
  const STEP_PANEL_HEIGHT = 220; // px feste Höhe für den gesamten Schrittbereich (Inhalt + Navigation)
  const STEP_FONT_SIZE = '.95rem'; // etwas größer für bessere Lesbarkeit
  // Optionale feste Spaltenbreiten (Reihenfolge wie Header: Nr. | Umstellpunkt | Wert | FTL. | Wagen | Bemerkung)
  // Prozent oder px möglich. Auf null setzen um automatische Verteilung zu erhalten.
  const COLUMN_WIDTHS: (string | number)[] | null = ['5%','45%','10%','10%','10%','20%'];
  // RFID Status-Spalte wird dynamisch angezeigt, kein Konstante nötig
  // Farb-Konfiguration könnte später über Settings kommen (derzeit direkt im JSX benutzt)

  // Beim Laden die aktuelle Datei vom Server holen
  useEffect(() => {
    fetch("/api/customer-html")
      .then((res) => (res.ok ? res.text() : null))
      .then((html) => {
        if (html) {
          // Erzeuge ein Blob-URL für das HTML
          const blob = new Blob([html], { type: "text/html" });
          setFileUrl(URL.createObjectURL(blob));
        }
      });
  }, []);

  // Lade geparste Tabellen-Zeilen aus Backend und bereite Steps auf
  useEffect(() => {
    const loadSteps = async () => {
      setStepsLoading(true);
      setStepsError(null);
      try {
  // asHtml true damit wir die originalen <tr class="line"> Zeilen (inkl. Bilder) rendern können
  // duplicateCaption=false: verhindert doppelte Überschrift/Caption-Ausgabe
  const data = await apiClient.getMainTableRows({ asHtml: true, withMeta: true, duplicateCaption: false }) as { rowsMeta?: RowMeta[] };
  const rowsMeta = data.rowsMeta;
        if (!rowsMeta) { setSteps([]); return; }
        const prepared: Step[] = [];
  let currentSection: string | null = null;             // aus caption_line
  let currentHeaderCells: string[] | undefined = undefined; // Kopfzeilen aus caption
  let currentSubSection: string | null = null;           // Text aus caption
  let currentLineHtml: string | undefined = undefined;   // letzte caption_line HTML (inkl. Bilder)

        // Helper: extrahiere aus einer <tr class=" line"> Zeile nur Pfeil + Text (2. Zelle) und forme sie zu einer flachen flex-Zeile
        const normalizeImages = (html: string) => html
          .replace(/<img([^>]*class="[^"]*icon[^"]*"[^>]*)>/gi, (_, attrs) => {
            const cleaned = attrs.replace(/style="[^"]*"/gi, '');
            return `<img ${cleaned} style="height:18px;display:inline-block;vertical-align:middle;margin:0 4px 0 2px;" />`;
          })
          .replace(/<img(?![^>]*icon)([^>]*)>/gi, (_, attrs) => {
            const cleaned = attrs.replace(/style="[^"]*"/gi, '');
            return `<img ${cleaned} style="height:18px;display:inline-block;vertical-align:middle;margin:0 4px 0 2px;" />`;
          });

        const extractCells = (rawTr: string): string[] => {
          const matches = rawTr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
            return matches.map(td => {
              const m = td.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
              return m ? m[1].trim() : '';
            });
        };

        const buildLineRowHtml = (raw: string | undefined): string | undefined => {
          if (!raw) return raw;
          const cells = extractCells(raw);
          if (cells.length < 2) return raw;
          const arrow = '→';
          let body = cells[1]
            .replace(/<br\s*\/?>(\s)*/gi, ' · ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          body = normalizeImages(body);
          return `<div style="display:flex;align-items:center;gap:10px;font-size:${STEP_FONT_SIZE};color:#111;line-height:1.3;font-weight:400;">`
            + `<span style="font-weight:600;min-width:18px;">${arrow}</span>`
            + `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:nowrap;">${body}</span>`
            + `</div>`;
        };

  rowsMeta.forEach((row: RowMeta, idx: number) => {
          const text = (row?.text || '').trim();
          if (!text) return;
          switch (row.row_type) {
            case 'caption_line':
              // Sektion (Hauptgruppe) setzen aber Tabellen-Header (currentHeaderCells) NICHT löschen
              // damit die Kopfzeile "Nr. Umstellpunkt ..." erhalten bleibt
              currentSection = text;
              currentSubSection = null;
              currentLineHtml = row.html || undefined;
              return;
            case 'caption':
              // Unterscheide Spalten-Header (Nr./Umstellpunkt/...) von echten Unter-Abschnittstiteln
              if (row.cells && row.cells.length > 3) {
                const first = (row.cells[0] || '').toString().toLowerCase();
                const second = (row.cells[1] || '').toString().toLowerCase();
                const looksLikeHeader = (first.startsWith('nr') || first === 'nr.') && second.includes('umstell');
                if (looksLikeHeader) {
                  currentHeaderCells = row.cells;
                  // nicht als subSection anzeigen -> nur Tabellenkopf
                  return;
                }
              }
              // normale caption (z.B. Untergruppe) -> nicht Header, daher als subSection zeigen, keine headerCells Änderung falls keine Zellen
              currentHeaderCells = row.cells?.length ? row.cells : currentHeaderCells;
              currentSubSection = text;
              return;
            case 'data':
              // Zuerst prüfen ob es eine reine line Zeile ist (auch wenn noch keine Sektion existiert)
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
          lineContentHtml: buildLineRowHtml(row.html || undefined),
                });
                return;
              }
              if (!currentSection) return; // ohne gesetzte Hauptgruppe (caption_line) keine Datenzeilen erfassen
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
            default:
              return;
          }
        });
        setSteps(prepared);
        setCurrentStep(0);
      } catch (e) {
        setStepsError(e instanceof Error ? e.message : 'Fehler beim Laden der Schritt-Liste');
      } finally {
        setStepsLoading(false);
      }
    };
    loadSteps();
  }, []);

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
        setFormatError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      } finally { setFormatLoading(false); }
    };
    loadFormats();
  }, []);

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
  const enrichedSteps = React.useMemo(() => {
  if (!selectedFormat || !formats[selectedFormat]) return steps;
  const fmt = formats[selectedFormat];
    const allFormatsFromDetail = formatDetail?.formats || {};
    const detailFmt = allFormatsFromDetail[selectedFormat] || fmt; // Fallback auf einfache Formats-Struktur
  const dataItems: FormatItem[] = Array.isArray((detailFmt as { data?: unknown })?.data)
    ? (detailFmt as { data?: FormatItem[] }).data || []
    : [];
    const valueIndexMap: Record<number, string> = (formatDetail?.valueIndexMap) || {};

    // Map sichtbare Nummer -> Wert (value), FTL. (formatPart) und Wagen (cart)
    const numberToValue: Record<string, string> = {};
    const numberToFTL:   Record<string, string> = {};
    const numberToCart:  Record<string, string> = {};
    dataItems.forEach((it, idx) => {
      if (!it || typeof it !== 'object') return;
      // idx entspricht Position im data Array; valueIndexMap keys sind 1-basiert laut Parser
      const dataPos = idx; // 0-basiert
      const visible = (it.valueIndex) || valueIndexMap[dataPos] || valueIndexMap[dataPos + 1] || ''; // Versuch verschiedene Offsets
      const rawVal = it.value ?? it.formatValue ?? '';
      const val = (rawVal || '').toString().trim();
      const ftl = (it.formatPart || '').toString().trim();
      const cart = (it.cart || '').toString().trim();
  // Ersten Dummy/Platzhalter-Datensatz (Header repliziert im Daten-Array) ignorieren:
  const isPlaceholder = val.toLowerCase() === 'wert' && (ftl.toLowerCase() === 'ftl.' || ftl.toLowerCase() === 'ftl') && cart.toLowerCase() === 'wagen';
  if (isPlaceholder) return;
      if (visible) {
        if (val && !numberToValue[visible]) numberToValue[visible] = val;
        if (ftl && !numberToFTL[visible]) numberToFTL[visible] = ftl;
        if (cart && !numberToCart[visible]) numberToCart[visible] = cart;
      }
    });

    const base = steps.map<Step>(s => {
      if (s.kind !== 'data' || !s.cells.length) return s;
      const nr = (s.cells[0] || '').toString().trim();
      if (!nr) return s;
      const val = numberToValue[nr];
      const ftl = numberToFTL[nr];
      const cart = numberToCart[nr];
      if (!val && !ftl && !cart) return s; // nichts zu tun
      const cellsCopy = [...s.cells];
      const prevVal = cellsCopy[2];
      if (val) cellsCopy[2] = val; // Wert
      if (ftl) cellsCopy[3] = ftl; // FTL.
      if (cart) cellsCopy[4] = cart; // Wagen
      return { ...s, cells: cellsCopy, _injectedValue: !!val, _prevValue: prevVal };
    });
    return base;
  }, [steps, selectedFormat, formats, formatDetail]);

  // --- RFID Assignments + Live Sichtbarkeit ---
  const [assignments, setAssignments] = React.useState<AssignmentsMap>({}); // format_part -> { rfid_tag_id }
  const [liveEventTagIds, setLiveEventTagIds] = React.useState<Set<string>>(new Set());
  // Assignments nur beim (erstmaligen) Laden und wenn Format gewechselt wird holen (statt Dauer-Polling)
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
  const json = await apiClient.getFormatAssignments() as { success?: boolean; assignments?: AssignmentsMap };
  if (!cancelled && json?.success && json.assignments) setAssignments(json.assignments);
      } catch {}
    };
    fetchOnce();
    return () => { cancelled = true; };
  }, [selectedFormat]);
  // WebSocket für Live-Event-IDs + Assignments Updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      try {
        const baseHttp = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001';
        const base = baseHttp.replace(/^http/, 'ws');
        const url = `${base}/ws/opc-ua`;
        ws = new WebSocket(url);
        ws.onmessage = (ev: MessageEvent) => {
          try {
            const raw = JSON.parse(ev.data) as unknown;
            if (typeof raw !== 'object' || raw === null) return;
            const msg = raw as Record<string, unknown>;
            if (msg.type === 'live_event_ids' && Array.isArray(msg.ids)) {
              const norm = (msg.ids as unknown[]).map(t => (t ?? '').toString().trim().toUpperCase()).filter((t: string) => t.length > 0);
              setLiveEventTagIds(new Set(norm));
            } else if (msg.type === 'assignments_update' && msg.assignments) {
              setAssignments(msg.assignments as AssignmentsMap);
            } else if (msg.type === 'rfid_inventory' && Array.isArray(msg.tags)) {
              // Fallback falls Backend (ältere Version) noch rfid_inventory sendet
              const norm = (msg.tags as unknown[]).map(t => (t ?? '').toString().trim().toUpperCase()).filter((t: string) => t.length > 0);
              setLiveEventTagIds(new Set(norm));
            }
          } catch {}
        };
        ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      } catch {}
    };
    connect();
    return () => { closed = true; if (ws) ws.close(); };
  }, []);

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
        const alt1 = key.replace(/\s+/g,' ').trim();
        assignment = assignments[alt1];
      }
      if (!assignment) {
        const alt2 = key.replace(/\./g,'').replace(/\s+/g,' ').trim();
        assignment = assignments[alt2];
      }
      // assignment kann string oder objekt sein
      const rawTagId = typeof assignment === 'string'
        ? assignment
        : (assignment?.rfid_tag_id ?? (assignment as AssignmentsMapEntry | undefined)?.rfidTagId);
      const tagId = rawTagId ? rawTagId.toString().trim() : null;
      const normTag = tagId ? tagId.toUpperCase() : null;
      const seen = normTag ? liveEventTagIds.has(normTag) : false;
      const symbol = tagId ? (seen ? '✔' : '✖') : '–';
      return { ...s, _rfidStatus: { seen, tagId, tagIdNorm: normTag, keyTried: key, symbol } };
    });
  }, [enrichedSteps, assignments, liveEventTagIds]);

  const current = stepsWithStatus[currentStep];
  const totalSteps = stepsWithStatus.length;

  // Statistiken zu Assignments & Erkennung
  const rfidStats = React.useMemo(() => {
    // Alle data-rows mit zugewiesenem Tag
  const rowsWithTag = stepsWithStatus.filter(r => r._rfidStatus && r._rfidStatus.tagId);
    const assignedTotal = rowsWithTag.length;
  const recognizedAssigned = rowsWithTag.filter(r => r._rfidStatus?.seen).length;
    // Menge aller zugewiesenen normierten Tags
  const assignedNormSet = new Set(rowsWithTag.map(r => r._rfidStatus?.tagIdNorm).filter(Boolean));
    // Fremde erkannte Tags = liveEventTagIds ohne zugewiesene
    let foreignCount = 0;
    liveEventTagIds.forEach(t => { if (!assignedNormSet.has(t)) foreignCount++; });
    return { assignedTotal, recognizedAssigned, foreignCount };
  }, [stepsWithStatus, liveEventTagIds]);

  const hasPrev = currentStep > 0;
  const hasNext = currentStep < totalSteps - 1;
  const goto = useCallback((delta: number) => {
    setCurrentStep(s => {
      const next = s + delta;
      if (next < 0) return 0;
      if (next >= steps.length) return steps.length - 1;
      return next;
    });
  }, [steps.length]);
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-black" style={{ height: '100vh' }}>
      <Header profile="Customer" />
      <main className="flex-1 w-full p-0 m-0" style={{ background: '#fff', height: '100%', display:'flex', flexDirection:'column' }}>
        <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <h2 style={{ fontSize: '.9rem', fontWeight: 600, margin: 0, letterSpacing: '.03em', color: '#222' }}>Schritt-für-Schritt Anleitung</h2>
            <button onClick={()=>setShowSteps(s=>!s)} style={{ fontSize:'.65rem', padding:'4px 8px', border:'1px solid #bbb', background:'#fff', borderRadius:4, cursor:'pointer' }}>
              {showSteps ? 'Ausblenden' : 'Anzeigen'}
            </button>
            {showSteps && (
              <span style={{ marginLeft:'auto', fontSize:'.6rem', color:'#555' }}>
                {rfidStats.recognizedAssigned}/{rfidStats.assignedTotal} erkannt · {rfidStats.foreignCount} fremd
              </span>
            )}
          </div>
          {showSteps && stepsLoading && <div style={{ fontSize: '.75rem', color: '#555', marginTop: 4 }}>Lade Schritte…</div>}
          {showSteps && stepsError && <div style={{ fontSize: '.75rem', color: '#b00000', marginTop: 4 }}>{stepsError}</div>}
          {showSteps && !stepsLoading && !stepsError && steps.length === 0 && <div style={{ fontSize: '.75rem', color: '#555', marginTop: 4 }}>Keine Schritte gefunden.</div>}
          {showSteps && current && (
            <div style={{ marginTop: 8, height: STEP_PANEL_HEIGHT, display: 'flex', flexDirection: 'column', border: '1px solid #e1e1e1', borderRadius: 6, padding: '8px 10px', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4, position:'relative' }}>
                <label style={{ fontSize: '.7rem', fontWeight:600, color:'#222' }}>Format:</label>
                <select
                  value={selectedFormat || ''}
                  onChange={e => { setSelectedFormat(e.target.value || null); setCurrentStep(0); }}
                  style={{ fontSize: '.75rem', padding:'4px 6px', border:'1px solid #bbb', borderRadius:4, background:'#fff', color:'#111', fontWeight:500 }}
                >
                  <option value=''>-- wählen --</option>
                  {formatNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                {formatLoading && <span style={{ fontSize: '.65rem', color:'#444' }}>lädt…</span>}
                {formatError && <span style={{ fontSize: '.65rem', color:'#b00' }}>{formatError}</span>}
                {selectedFormat && <button title="Format zurücksetzen" onClick={()=>setSelectedFormat(null)} style={{ fontSize: '.65rem', padding:'4px 6px', background:'#f4f4f4', color:'#222', border:'1px solid #bbb', borderRadius:4, cursor:'pointer' }}>Reset</button>}
                <div style={{ marginLeft:'auto', display:'flex', gap:14, alignItems:'center', fontSize:'.65rem', fontWeight:600, color:'#222', flexWrap:'wrap' }}>
                  <span title="Erkannte vs. zugeordnete Formatteile">{rfidStats.recognizedAssigned}/{rfidStats.assignedTotal} Formatteile erkannt</span>
                  <span title="Erkannte Tags ohne Zuweisung" style={{ color: rfidStats.foreignCount ? '#b30000' : '#228822' }}>{rfidStats.foreignCount} falsche Formatteile erkannt</span>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: STEP_FONT_SIZE, color: '#111', tableLayout: 'fixed' }}>
                    {COLUMN_WIDTHS && COLUMN_WIDTHS.length === current.headerCells.length && (
                      <colgroup>
                        {COLUMN_WIDTHS.map((w, i) => (
                          <col key={i} style={{ width: typeof w === 'number' ? `${w}px` : w }} />
                        ))}
                        {/* zusätzliche dynamische Status-Spalte falls nötig */}
                        {current._rfidStatus && <col style={{ width: '6%' }} />}
                      </colgroup>
                    )}
                    <thead>
                      <tr>
                        {current.headerCells.map((h: string) => {
                          const key = 'h_' + (h || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
                          const width = COLUMN_WIDTHS && COLUMN_WIDTHS.length === current.headerCells!.length ? undefined : `${100 / current.headerCells!.length}%`;
                          return <th key={key} style={{ border: '1px solid #b7b7b7', padding: '6px 8px', background: '#e9ecef', textAlign: 'left', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width, color:'#222', fontSize: STEP_FONT_SIZE }}>{h}</th>;
                        })}
                        {current._rfidStatus && <th style={{ border: '1px solid #b7b7b7', padding:'6px 8px', background:'#e9ecef', textAlign:'left', fontWeight:600, fontSize: STEP_FONT_SIZE }}>RFID</th>}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {current.cells.map((c: string, i: number) => {
                          const key = 'c_' + (c || '').toString().trim().toLowerCase().replace(/\s+/g, '_') + '_' + i;
                          const injected = current._injectedValue && i === 2; // Wert-Spalte
                          return <td key={key} style={{ border: '1px solid #c5c5c5', padding: '6px 8px', background: injected ? '#fff9e6' : '#fff', fontSize: STEP_FONT_SIZE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: injected ? 600 : 400, color: '#111' }}>{c}</td>;
                        })}
                        {current._rfidStatus && (
                          <td style={{ border:'1px solid #c5c5c5', padding:'6px 8px', background:'#fff', fontSize: STEP_FONT_SIZE, fontWeight:700,
                                       color: current._rfidStatus.tagId ? (current._rfidStatus.seen ? '#0a7a15' : '#b30000') : '#666' }}
                              title={!current._rfidStatus.tagId
                                ? `Kein RFID zugeordnet | Key=${current._rfidStatus.keyTried}`
                                : (current._rfidStatus.seen
                                  ? `Tag ${current._rfidStatus.tagId} erkannt | Key=${current._rfidStatus.keyTried} | Norm=${current._rfidStatus.tagIdNorm}`
                                  : `Tag ${current._rfidStatus.tagId} nicht erkannt | Key=${current._rfidStatus.keyTried} | Norm=${current._rfidStatus.tagIdNorm}`)}>
                            {current._rfidStatus.symbol}
                          </td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <button onClick={() => goto(-1)} disabled={!hasPrev} style={{ padding: '6px 12px', fontSize: STEP_FONT_SIZE, background: hasPrev ? '#222' : '#999', color: '#fff', border: 'none', borderRadius: 4, cursor: hasPrev ? 'pointer' : 'not-allowed' }}>Zurück</button>
                <button onClick={() => goto(1)} disabled={!hasNext} style={{ padding: '6px 12px', fontSize: STEP_FONT_SIZE, background: hasNext ? '#0069d9' : '#999', color: '#fff', border: 'none', borderRadius: 4, cursor: hasNext ? 'pointer' : 'not-allowed' }}>Weiter</button>
                <div style={{ fontSize: STEP_FONT_SIZE, color: '#111', marginLeft: 'auto', fontWeight: 500 }}>Schritt {currentStep + 1} / {totalSteps}</div>
              </div>
              <input type="range" min={0} max={Math.max(totalSteps - 1, 0)} value={currentStep} onChange={e => setCurrentStep(Number(e.target.value))} style={{ width: '100%', marginTop: 6 }} />
            </div>
          )}
        </div>
  {fileUrl && <iframe src={fileUrl} title="Externe HTML" style={{ width: '100%', flex:1, border: 'none', background: '#fff', display: 'block', marginTop: showSteps ? 0 : 8 }} />}
      </main>
    </div>
  );
}