"use client";
import Header from "@/components/Header";
import React, { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

export default function CustomerPage() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  // (Ehemalige OPC-UA / Live Event States entfernt für vereinfachte Kundenansicht)
  // Step-by-step state
  type Step = {
    index: number;
    section: string;
    subSection?: string;
    headerCells?: string[];
    cells: string[];
    lineHtml?: string; // for caption_line (context) or last seen
    kind: 'line' | 'data';
    lineContentHtml?: string; // for pure <tr class="line"> steps
  };
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
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
  const data = await apiClient.getMainTableRows({ asHtml: true, withMeta: true, duplicateCaption: false });
        const rowsMeta = (data as any).rowsMeta as any[] | undefined;
        if (!rowsMeta) { setSteps([]); return; }
        const prepared: Step[] = [];
  let currentSection: string | null = null;             // aus caption_line
  let currentHeaderCells: string[] | undefined = undefined; // Kopfzeilen aus caption
  let currentSubSection: string | null = null;           // Text aus caption
  let currentLineHtml: string | undefined = undefined;   // letzte caption_line HTML (inkl. Bilder)

        rowsMeta.forEach((row: any, idx: number) => {
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
                  lineContentHtml: row.html || undefined,
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
      } catch (e: any) {
        setStepsError(e?.message || 'Fehler beim Laden der Schritt-Liste');
      } finally {
        setStepsLoading(false);
      }
    };
    loadSteps();
  }, []);

  const current = steps[currentStep];
  const hasPrev = currentStep > 0;
  const hasNext = currentStep < steps.length - 1;
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
      <main className="flex-1 w-full p-0 m-0" style={{ background: '#fff', height: '100%' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
          <h2 style={{ fontSize: '.9rem', fontWeight: 600, margin: 0, letterSpacing: '.03em', color: '#222' }}>Schritt-für-Schritt Anleitung</h2>
          {stepsLoading && <div style={{ fontSize: '.75rem', color: '#555', marginTop: 4 }}>Lade Schritte…</div>}
          {stepsError && <div style={{ fontSize: '.75rem', color: '#b00000', marginTop: 4 }}>{stepsError}</div>}
          {!stepsLoading && !stepsError && steps.length === 0 && <div style={{ fontSize: '.75rem', color: '#555', marginTop: 4 }}>Keine Schritte gefunden.</div>}
          {current && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, color: '#111', opacity: 0.9 }}>{current.section}</div>
                {current.kind === 'data' && current.subSection && (
                  <div style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, color: '#222' }}>{current.subSection}</div>
                )}
                {current.kind === 'line' && current.lineContentHtml && (
                  <div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: current.lineContentHtml }} />
                )}
              </div>
              {current.kind === 'data' && (
                (() => {
                  const columnWidths: string[] | null = null; // Beispiel: ['6%','34%','10%','8%','10%','32%']
                  return (
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.75rem', color: '#111', tableLayout: 'fixed' }}>
                      {current.headerCells && current.headerCells.length > 0 && (
                        <thead>
                          <tr>
                            {current.headerCells.map((h: string, i: number) => {
                              const key = 'h_' + (h || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
                              const colCount = current.headerCells?.length || 1;
                              const width = columnWidths ? columnWidths[i] : `${100 / colCount}%`;
                              return <th key={key} style={{ border: '1px solid #bbb', padding: '4px 6px', background: '#f0f0f0', textAlign: 'left', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width }}>{h}</th>;
                            })}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        <tr>
                          {current.cells.map((c: string, i: number) => {
                            const key = 'c_' + (c || '').toString().trim().toLowerCase().replace(/\s+/g, '_') + '_' + i;
                            const colCount = current.headerCells?.length || current.cells.length || 1;
                            const width = columnWidths ? columnWidths[i] : `${100 / colCount}%`;
                            return <td key={key} style={{ border: '1px solid #ccc', padding: '4px 6px', background: '#fff', fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width }}>{c}</td>;
                          })}
                        </tr>
                      </tbody>
                    </table>
                  );
                })()
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => goto(-1)} disabled={!hasPrev} style={{ padding: '4px 10px', fontSize: '.75rem', background: hasPrev ? '#222' : '#999', color: '#fff', border: 'none', borderRadius: 4, cursor: hasPrev ? 'pointer' : 'not-allowed' }}>Zurück</button>
                <button onClick={() => goto(1)} disabled={!hasNext} style={{ padding: '4px 10px', fontSize: '.75rem', background: hasNext ? '#0069d9' : '#999', color: '#fff', border: 'none', borderRadius: 4, cursor: hasNext ? 'pointer' : 'not-allowed' }}>Weiter</button>
                <div style={{ fontSize: '.65rem', color: '#111', marginLeft: 'auto' }}>Schritt {currentStep + 1} / {steps.length}</div>
              </div>
              <input type="range" min={0} max={Math.max(steps.length - 1, 0)} value={currentStep} onChange={e => setCurrentStep(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
          )}
        </div>
        {fileUrl && <iframe src={fileUrl} title="Externe HTML" style={{ width: '100%', height: '100%', border: 'none', background: '#fff', display: 'block' }} />}
      </main>
    </div>
  );
}