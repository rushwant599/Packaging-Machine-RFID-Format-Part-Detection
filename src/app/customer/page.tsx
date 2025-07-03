"use client";
import Header from "@/components/Header";
import React, { useRef, useState, useEffect } from "react";

export default function CustomerPage() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [activeFormat, setActiveFormat] = useState<string | null>(null);
  const [formatLoading, setFormatLoading] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'error'>('connecting');
  const inputRef = useRef<HTMLInputElement>(null);

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
              console.log("OPC UA Wertänderung empfangen:", message.data);
              setActiveFormat(message.data.value?.toString() ?? "Unbekannter Wert");
              setConnectionStatus('connected');
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      // Datei an den Server senden
      const res = await fetch("/api/customer-html", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        // Nach erfolgreichem Upload neu laden
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        setFileUrl(URL.createObjectURL(blob));
      }
    }
  };

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
            <input
              id="html-upload"
              type="file"
              accept=".html"
              ref={inputRef}
              onChange={handleFileChange}
              style={{ color: "#666", paddingTop: 0, paddingBottom: 0 }}
            />
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