"use client";
import { useEffect, useRef, useState } from "react";

type LiveEventIdsMessage = {
  type: "live_event_ids";
  ids: string[];
  count?: number;
  timestamp?: number;
};

type IntervalHandle = ReturnType<typeof setInterval>;
type WebSocketWithPing = WebSocket & { __pingInterval?: IntervalHandle };

function isLiveEventIdsSnapshot(v: unknown): v is { ids: string[]; count?: number; timestamp?: number } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const idsOk = Array.isArray(o.ids) && (o.ids as unknown[]).every((x) => typeof x === "string");
  const countOk = o.count === undefined || typeof o.count === "number";
  const tsOk = o.timestamp === undefined || typeof o.timestamp === "number";
  return idsOk && countOk && tsOk;
}

export default function TestLiveEventIdsPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [count, setCount] = useState<number | undefined>(undefined);
  const [timestamp, setTimestamp] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUserRef = useRef<boolean>(false);

  const [wsUrl, setWsUrl] = useState<string>("");
  useEffect(() => {
    // Compute on client after mount to avoid SSR hydration mismatch
    try {
      const env = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (env && env.trim()) {
        const u = new URL(env);
        const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
        setWsUrl(`${wsProto}//${u.host}/ws/opc-ua`);
        return;
      }
      const { protocol, hostname, port } = window.location;
      const isHttps = protocol === "https:";
      let targetHost: string;
      if (port === "3000") {
        targetHost = `${hostname}:8001`;
      } else if (port) {
        targetHost = `${hostname}:${port}`;
      } else {
        targetHost = hostname;
      }
      const wsProto = isHttps ? "wss:" : "ws:";
      setWsUrl(`${wsProto}//${targetHost}/ws/opc-ua`);
    } catch {
      // ignore
    }
  }, []);

  // Keepalive helper moved to component scope to avoid deep nesting
  const setupKeepAlive = (sock: WebSocketWithPing) => {
    try {
      sock.__pingInterval = setInterval(() => {
        try { sock.send("ping"); } catch { /* noop */ }
      }, 25000);
    } catch {
      // ignore
    }
  };

  // Connection helper moved to component scope to flatten nested callbacks
  const connect = (url: string) => {
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
          if (typeof ev.data !== "string") return; // only handle text frames
          const data = JSON.parse(ev.data) as unknown;
          if (
            typeof data === "object" &&
            data !== null &&
            "type" in data &&
            (data as { type?: string }).type === "live_event_ids"
          ) {
            const msg = data as LiveEventIdsMessage;
            if (Array.isArray(msg.ids)) setIds(msg.ids);
            if (typeof msg.count === "number") setCount(msg.count);
            if (typeof msg.timestamp === "number") setTimestamp(msg.timestamp);
          }
        } catch {
          // ignore malformed messages
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
          // simple reconnect after 2s
          reconnectTimerRef.current = setTimeout(() => connect(url), 2000);
        }
      };
    } catch {
      setStatus("error");
    }
  };

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
  }, [wsUrl]);

  // Initial HTTP snapshot so data is shown even before first WS broadcast
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
            setIds(j.ids);
            if (typeof j.count === "number") setCount(j.count);
            if (typeof j.timestamp === "number") setTimestamp(j.timestamp);
          }
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  }, [wsUrl]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Live Event IDs (WebSocket)</h1>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 14 }}>Status:</span>
        {(() => {
          let color = "#ca8a04"; // yellow-600 default (connecting)
          if (status === "open") color = "#16a34a"; // green-600
          else if (status === "error") color = "#dc2626"; // red-600
          else if (status === "closed") color = "#6b7280"; // gray-500
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
          {ids.map((id) => (
            <li key={id} style={{ fontFamily: "monospace", fontSize: 14, wordBreak: "break-all" }}>
              {id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
