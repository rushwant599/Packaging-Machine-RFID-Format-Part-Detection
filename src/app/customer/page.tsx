"use client";
import Header from "@/components/Header";
import React, { useState, useEffect } from "react";

export default function CustomerPage() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [activeFormat, setActiveFormat] = useState<string | null>(null);
  const [formatLoading, setFormatLoading] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'error'>('connecting');
  // Nur die IDs des zuletzt empfangenen OPC Events
  const [liveEventIds, setLiveEventIds] = useState<string[]>([]);
  const HEX_EVENT_REGEX = /Ausgabe:([0-9A-Fa-f]+)/g;

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

  // Aktives Format von OPC UA - nur beim Laden + WebSocket für Änderungen
  useEffect(() => {
    let websocket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    
    // Initiale Ladung des aktuellen Werts
    const loadInitialValue = async () => {
      try {
        setFormatLoading(true);
        const response = await fetch("/api/opc-ua/value");
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.value !== undefined && data.data?.value !== null) {
            setActiveFormat(data.data.value.toString());
            setConnectionStatus('connected');
          } else {
            setActiveFormat("Kein Format aktiv");
            setConnectionStatus('error');
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          setActiveFormat(errorData.detail ?? "OPC-UA Server nicht erreichbar");
          setConnectionStatus('error');
        }
      } catch (error) {
        console.error("Fehler beim Laden des initialen Formats:", error);
        setActiveFormat("Verbindungsfehler");
        setConnectionStatus('error');
      } finally {
        setFormatLoading(false);
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(setupWebSocket, 5000);
    };

    // WebSocket für Echtzeit-Updates bei Wertänderungen
    const setupWebSocket = () => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8001";
      const wsUrl = backendUrl.replace(/^http/, 'ws') + '/ws/opc-ua';
      
      try {
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = () => {
          console.log("WebSocket-Verbindung für OPC UA Updates hergestellt");
          setConnectionStatus('connected');
        };
        
        websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'value_change' && message.data) {
              // Unterscheide zwischen echtem OPC UA Wert (mit value Feld) und anderen Broadcasts (opc_event, rfid_inventory ...)
              const hasValue = Object.prototype.hasOwnProperty.call(message.data, 'value') && message.data.value !== null && message.data.value !== undefined;
              if (hasValue) {
                setActiveFormat(String(message.data.value));
              }
              setConnectionStatus('connected');
              // Verarbeitung für OPC Event Payload -> Hex IDs (ändert activeFormat NICHT)
              if (message.data.type === 'opc_event' && typeof message.data.payload === 'string') {
                const payload: string = message.data.payload.replace(/<STX>|<ETX>/g, '');
                const ids: string[] = [];
                const seen = new Set<string>();
                let m: RegExpExecArray | null;
                while ((m = HEX_EVENT_REGEX.exec(payload)) !== null) {
                  const id = (m[1] || '').toUpperCase();
                  if (!id || seen.has(id)) continue;
                  seen.add(id);
                  ids.push(id);
                }
                setLiveEventIds(ids);
              }
            }
          } catch (parseError) {
            console.error("Fehler beim Parsen der WebSocket-Nachricht:", parseError);
          }
        };
        
        websocket.onerror = (error) => {
          console.error("WebSocket-Fehler:", error);
          setConnectionStatus('error');
        };
        
        websocket.onclose = () => {
          console.log("WebSocket-Verbindung geschlossen");
          setConnectionStatus('error');
          scheduleReconnect();
        };
        
      } catch (error) {
        console.error("WebSocket-Setup fehlgeschlagen:", error);
        setConnectionStatus('error');
      }
    };

    // Initiale Ladung und WebSocket-Setup
    loadInitialValue().then(() => {
      setupWebSocket();
    });
    
    return () => {
      if (websocket) {
        websocket.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-black" style={{ height: "100vh" }}>
      <Header profile="Customer" />
      <main
        className="flex-1 w-full p-0 m-0"
        style={{ background: "#fff", height: "100%" }}
      >
        <div
          className="p-4"
          style={{ paddingTop: "0.5rem", paddingBottom: "0.5rem" }}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1" style={{ minWidth: '200px' }}>
              <span style={{ fontSize: '0.70rem', letterSpacing: '0.05em', color: '#555', fontWeight: 600 }}>LIVE EVENT TAGS (Letztes Event)</span>
              <div style={{
                background: '#000',
                border: '1px solid #333',
                padding: '4px 6px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.7rem',
                maxWidth: '260px',
                maxHeight: '360px',
                overflowY: 'auto',
                lineHeight: '1.15'
              }} title={liveEventIds.length ? `${liveEventIds.length} IDs` : 'Keine IDs'}>
                {liveEventIds.length ? (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {liveEventIds.map(id => (
                      <li key={id} style={{ color: '#e0e0e0', padding: '1px 0', borderBottom: '1px solid #1d1d1d' }}>
                        {id}
                      </li>
                    ))}
                  </ul>
                ) : <span style={{ color: '#777' }}>—</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: "#666", fontWeight: "500" }}>
                Aktives Format:
              </span>
              {formatLoading ? (
                <span style={{ color: "#999" }}>Lädt...</span>
              ) : (
                <span 
                  style={{ 
                    color: activeFormat === "Kein Format aktiv" || 
                           activeFormat === "Fehler beim Laden" || 
                           activeFormat === "Verbindungsfehler" || 
                           activeFormat === "Datenformat-Fehler" ? "#ff6b6b" : "#28a745",
                    fontWeight: "600"
                  }}
                >
                  {activeFormat}
                </span>
              )}
              {/* Verbindungsindikator */}
              <div 
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: (() => {
                    switch (connectionStatus) {
                      case 'connected': return "#28a745";
                      case 'connecting': return "#ffc107";
                      case 'error': return "#ff6b6b";
                      default: return "#6c757d";
                    }
                  })(),
                  marginLeft: "4px"
                }}
                title={(() => {
                  switch (connectionStatus) {
                    case 'connected': return 'Verbunden';
                    case 'connecting': return 'Verbinde...';
                    case 'error': return 'Verbindungsfehler';
                    default: return 'Unbekannt';
                  }
                })()}
              />
            </div>
          </div>
        </div>
        {fileUrl && (
          <iframe
            src={fileUrl}
            title="Externe HTML"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "#fff",
              display: "block"
            }}
          />
        )}
      </main>
    </div>
  );
}