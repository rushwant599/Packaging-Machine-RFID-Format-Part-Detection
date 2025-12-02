"use client";
import { useEffect, useRef, useState, useCallback } from "react";

type LiveEventIdsMessage = {
  type: "live_event_ids";
  ids: string[];
  count?: number;
  timestamp?: number;
  payload?: string;
};

type ValueChangeMessage = {
  type: "value_change";
  data: {
    type?: string;
    payload?: string;
    timestamp?: string;
    [k: string]: unknown;
  };
  timestamp?: string;
};

type IntervalHandle = ReturnType<typeof setInterval>;
type WebSocketWithPing = WebSocket & { __pingInterval?: IntervalHandle };

// Type guard for snapshot validation
function isLiveEventIdsSnapshot(v: unknown): v is { ids: string[]; count?: number; timestamp?: number } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const idsOk = Array.isArray(o.ids) && (o.ids as unknown[]).every((x) => typeof x === "string");
  const countOk = o.count === undefined || typeof o.count === "number";
  const tsOk = o.timestamp === undefined || typeof o.timestamp === "number";
  return idsOk && countOk && tsOk;
}

// Main component
export default function TestLiveEventIdsPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [count, setCount] = useState<number | undefined>(undefined);
  const [timestamp, setTimestamp] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [idTimestamps, setIdTimestamps] = useState<Map<string, number>>(new Map());
  const [rssiInfo, setRssiInfo] = useState<Map<string, { avg?: number; antennas: number[] }>>(new Map());
  const [avgEma, setAvgEma] = useState<Map<string, number>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUserRef = useRef<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const [wsUrl, setWsUrl] = useState<string>("");
  useEffect(() => {
    try {
      const env = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (env && env.trim()) {
        const u = new URL(env);
        const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
        setWsUrl(`${wsProto}//${u.host}/ws/opc-ua`);
        return;
      }
      const { protocol, host } = window.location;
      const wsProto = protocol === "https:" ? "wss:" : "ws:";
      setWsUrl(`${wsProto}//${host}/ws/opc-ua`);
    } catch {
    }
  }, []);

  // Keepalive helper moved to component scope to avoid deep nesting
  const setupKeepAlive = (sock: WebSocketWithPing) => {
    try {
      sock.__pingInterval = setInterval(() => {
        try { sock.send("ping"); } catch { /* noop */ }
      }, 25000);
    } catch {
    }
  };

  // Parse OPC UA payload 
  const parseOpcuaPayload = (payload: string) => {
    try {
      const cleaned = payload
        .replace(/\\u003CSTX\\u003E/g, "")
        .replace(/\\u003CETX\\u003E/g, "")
        .replace(/<STX>/g, "")
        .replace(/<ETX>/g, "")
        .trim();
      const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
      const result = new Map<string, { avg?: number; antennas: number[] }>();
      for (const part of parts) {
        // match Ausgabe:<hexid> <avg> <a1> <a2> <a3> <a4>
        const m = part.match(/Ausgabe:([0-9A-Fa-f]+)\s+(.+)/);
        if (!m) continue;
        const id = m[1];
        const nums = m[2].trim().split(/\s+/).map(t => parseInt(t, 10)).filter(n => !Number.isNaN(n));
        if (nums.length >= 1) {
          const avg = nums[0];
          const antennas = nums.slice(1, 5);
          while (antennas.length < 4) antennas.push(0);
          result.set(id, { avg, antennas });
        }
      }
      return result;
    } catch {
      return new Map<string, { avg?: number; antennas: number[] }>();
    }
  };

  const rssiToColor = (rssi: number | undefined) => {
    if (rssi === undefined) return '#9CA3AF';
    if (rssi >= -60) return '#16a34a';
    if (rssi >= -75) return '#a3e635';
    if (rssi >= -90) return '#f59e0b';
    return '#ef4444';
  };

  const rssiToPct = (rssi: number) => {
    if (rssi <= -100) return 0;
    if (rssi >= -40) return 100;
    return Math.round(((rssi + 100) / 60) * 100);
  };

  // Connection helper moved to component scope to flatten nested callbacks
  const connect = useCallback((url: string) => {
    setStatus("connecting");
    try {
      const ws: WebSocketWithPing = new WebSocket(url) as WebSocketWithPing;
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("open");
        setupKeepAlive(ws);
      };

      ws.onmessage = (ev) => {
        try {
          if (typeof ev.data !== "string") return;
          let data: unknown = null;
          try {
            data = JSON.parse(ev.data) as unknown;
          } catch {
            data = null;
          }

          if (!data || typeof data !== 'object') return;

          const t = (data as { type?: string }).type;

          if (t === 'value_change') {
            const vc = data as ValueChangeMessage;
            const inner = vc.data;
            if (inner && inner.type === 'opc_event' && typeof inner.payload === 'string') {
              try {
                const parsed = parseOpcuaPayload(inner.payload);
                if (parsed.size) {
                  const now = Date.now();
                  setRssiInfo(prev => {
                    const newMap = new Map(prev);
                    parsed.forEach((v, k) => newMap.set(k, v));
                    return newMap;
                  });
                  setIdTimestamps(prev => {
                    const newMap = new Map(prev);
                    parsed.forEach((v, k) => {
                      if (!newMap.has(k)) newMap.set(k, now);
                    });
                    return newMap;
                  });
                  setAvgEma(prev => {
                    const newMap = new Map(prev);
                    const alpha = 0.25;
                    parsed.forEach((v, k) => {
                      if (typeof v.avg === 'number') {
                        const prevVal = newMap.get(k) ?? v.avg;
                        newMap.set(k, Math.round((alpha * v.avg) + ((1 - alpha) * prevVal)));
                      }
                    });
                    return newMap;
                  });
                  setIds(prevIds => {
                    const merged = new Set(prevIds);
                    parsed.forEach((_v, k) => merged.add(k));
                    return Array.from(merged);
                  });
                }
              } catch { /* noop */ }
            }
            return;
          }

          if (t === 'live_event_ids') {
            const msg = data as LiveEventIdsMessage;
            if (Array.isArray(msg.ids)) {
              const now = Date.now();
              setIds(msg.ids);
              setIdTimestamps(prev => {
                const newMap = new Map(prev);
                msg.ids.forEach(id => {
                  if (!newMap.has(id)) {
                    newMap.set(id, now);
                  }
                });
                const currentIds = new Set(msg.ids);
                Array.from(newMap.keys()).forEach(id => {
                  if (!currentIds.has(id)) {
                    newMap.delete(id);
                  }
                });
                return newMap;
              });
            }
            if (typeof msg.count === "number") setCount(msg.count);
            if (typeof msg.timestamp === "number") setTimestamp(msg.timestamp);
          }
        } catch {
          // noop
        }
      };

      ws.onerror = () => {
        setStatus("error");
      };

      ws.onclose = () => {
        setStatus("closed");
        if (ws.__pingInterval) {
          clearInterval(ws.__pingInterval);
          ws.__pingInterval = undefined;
        }
        if (!closedByUserRef.current) {
          reconnectTimerRef.current = setTimeout(() => connect(url), 2000);
        }
      };
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!wsUrl) return;
    closedByUserRef.current = false;
    connect(wsUrl);
    return () => {
      closedByUserRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current as WebSocketWithPing | null;
      if (ws) {
        if (ws.__pingInterval) {
          clearInterval(ws.__pingInterval);
          ws.__pingInterval = undefined;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          try { ws.close(); } catch { /* noop */ }
        }
      }
      wsRef.current = null;
    };
  }, [wsUrl, connect]);

  useEffect(() => {
    if (!wsUrl) return;
    try {
      const httpUrl = wsUrl.startsWith("wss:")
        ? wsUrl.replace(/^wss:/, "https:")
        : wsUrl.replace(/^ws:/, "http:");
      const base = httpUrl.replace(/\/ws\/opc-ua$/, "");
      fetch(`${base}/api/live-event-ids`)
        .then(r => (r.ok ? r.json() : null))
        .then((j: unknown) => {
          if (isLiveEventIdsSnapshot(j)) {
            const now = Date.now();
            setIds(j.ids);
            setIdTimestamps(prev => {
              const newMap = new Map(prev);
              j.ids.forEach(id => {
                if (!newMap.has(id)) {
                  newMap.set(id, now);
                }
              });
              return newMap;
            });
            if (typeof j.count === "number") setCount(j.count);
            if (typeof j.timestamp === "number") setTimestamp(j.timestamp);
          }
        })
        .catch(() => { });
    } catch {
    }
  }, [wsUrl]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Live Event IDs (WebSocket)</h1>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 14 }}>Status:</span>
        {(() => {
          let color = "#ca8a04";
          if (status === "open") color = "#16a34a";
          else if (status === "error") color = "#dc2626";
          else if (status === "closed") color = "#6b7280";
          return (
            <span style={{ fontSize: 14, color }}>
              {status}
            </span>
          );
        })()}
        {typeof count === "number" && <span style={{ fontSize: 14 }}>Count: {count}</span>}
        {typeof timestamp === "number" && (
          <span style={{ fontSize: 14 }}>
            Timestamp: {new Date(timestamp).toLocaleString()}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>WS: {wsUrl || "(client URL pending)"}</div>
      {ids.length === 0 ? (
        <p style={{ fontSize: 14, opacity: 0.8 }}>Keine IDs empfangen.</p>
      ) : (
        <ul style={{ paddingLeft: 20 }}>
          {[...ids].sort((a, b) => a.localeCompare(b)).map((id) => {
            const idAge = idTimestamps.get(id);
            const isRecent = idAge && (currentTime - idAge) < 5000;
            const info = rssiInfo.get(id);
            const ema = avgEma.get(id);
            const displayAvg = typeof ema === 'number' ? ema : info?.avg;
            const best = info ? (() => {
              const nonzero = info.antennas.filter(a => a !== 0);
              return nonzero.length ? Math.max(...nonzero) : undefined;
            })() : undefined;
            return (
              <li
                key={id}
                style={{
                  fontFamily: "monospace",
                  fontSize: 14,
                  wordBreak: "break-all",
                  backgroundColor: isRecent ? "#22c55e20" : "transparent",
                  padding: "6px 8px",
                  marginBottom: "6px",
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{id}</div>
                    {isRecent && <div style={{ color: "#22c55e", marginTop: 2, fontSize: 12 }}>● recent</div>}
                  </div>
                  {info && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ color: rssiToColor(best), fontWeight: 700, marginRight: 8 }}>{typeof best === 'number' ? `${best} dBm` : '—'}</span>
                        <span style={{ fontSize: 11, opacity: 0.8 }}>best</span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>·</span>
                        <span style={{ color: rssiToColor(displayAvg), fontWeight: 600, marginLeft: 8 }}>{typeof displayAvg === 'number' ? `${displayAvg} dBm` : '—'}</span>
                        <span style={{ fontSize: 11, opacity: 0.8, marginLeft: 6 }}>avg</span>
                      </div>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {info.antennas.map((a, idx) => {
                          const pct = a === 0 ? 0 : rssiToPct(a);
                          const color = a === 0 ? '#d1d5db' : rssiToColor(a);
                          return (
                            <div key={idx} title={`Antenna ${idx + 1}: ${a === 0 ? 'n/a' : a + ' dBm'}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>A{idx + 1}</div>
                              <div style={{ width: 40, height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                {!info && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{isRecent ? '' : ''}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
