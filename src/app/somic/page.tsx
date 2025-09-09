"use client";
import Header from "@/components/Header";
import { useState, useEffect, useRef } from "react";
import { useAPI, BACKEND_URL } from "@/lib/api-client";

type Config = {
  OPC_UA_SERVER_URL: string;
  OPC_UA_NODE_ID: string;
  OPC_UA_EVENT_ENABLED: boolean;
  OPC_UA_EVENT_SERVER_URL: string;
  OPC_UA_EVENT_TYPE: string;
  OPC_UA_EVENT_INTERVAL_MS: number;
  OPC_UA_EVENT_MAX_EVENTS: number;
  OPC_UA_ENABLED: boolean;
  RFID_INVENTORY_ENABLED: boolean;
  RFID_READER_IP: string;
  RFID_READER_PORT: number;
  RFID_READER_ANT: string;
  RFID_CURRENT_RETENTION_SEC: number;
  RFID_INVENTORY_INTERVAL_SEC: number;
};

const defaultConfig: Config = {
  OPC_UA_SERVER_URL: "",
  OPC_UA_NODE_ID: "",
  OPC_UA_EVENT_ENABLED: false,
  OPC_UA_EVENT_SERVER_URL: "",
  OPC_UA_EVENT_TYPE: "",
  OPC_UA_EVENT_INTERVAL_MS: 500,
  OPC_UA_EVENT_MAX_EVENTS: 500,
  OPC_UA_ENABLED: false,
  RFID_INVENTORY_ENABLED: false,
  RFID_READER_IP: "",
  RFID_READER_PORT: 2111,
  RFID_READER_ANT: "F",
  RFID_CURRENT_RETENTION_SEC: 10,
  RFID_INVENTORY_INTERVAL_SEC: 1,
};

const backendUrl = BACKEND_URL;

export default function SomicPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [openSection, setOpenSection] = useState<string | null>(null);
  const api = useAPI();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${backendUrl}/api/config`)
      .then((res) => res.json())
      .then((data) => {
        setConfig({
          OPC_UA_SERVER_URL: data.OPC_UA_SERVER_URL || "",
          OPC_UA_NODE_ID: data.OPC_UA_NODE_ID || "",
          OPC_UA_EVENT_ENABLED: !!data.OPC_UA_EVENT_ENABLED,
          OPC_UA_EVENT_SERVER_URL: data.OPC_UA_EVENT_SERVER_URL || data.OPC_UA_SERVER_URL || "",
          OPC_UA_EVENT_TYPE: data.OPC_UA_EVENT_TYPE || "",
          OPC_UA_EVENT_INTERVAL_MS: Number(data.OPC_UA_EVENT_INTERVAL_MS ?? 500),
          OPC_UA_EVENT_MAX_EVENTS: Number(data.OPC_UA_EVENT_MAX_EVENTS ?? 500),
          OPC_UA_ENABLED: !!data.OPC_UA_ENABLED,
          RFID_INVENTORY_ENABLED: !!data.RFID_INVENTORY_ENABLED,
          RFID_READER_IP: data.RFID_READER_IP || "",
            RFID_READER_PORT: data.RFID_READER_PORT ?? 2111,
            RFID_READER_ANT: data.RFID_READER_ANT || "F",
            RFID_CURRENT_RETENTION_SEC: data.RFID_CURRENT_RETENTION_SEC ?? 10,
            RFID_INVENTORY_INTERVAL_SEC: data.RFID_INVENTORY_INTERVAL_SEC ?? 1,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await api.verifyPassword(password);
      if (response.success) {
        setUnlocked(true);
        setError("");
      } else {
        setError(response.message);
      }
    } catch (err) {
      console.error("Password verification failed:", err);
      setError("Verbindung zum Server fehlgeschlagen. Fallback wird verwendet.");
      // Fallback to original logic if backend is not available
      if (password === "a") {
        setUnlocked(true);
        setError("");
      } else {
        setError("Falsches Passwort!");
      }
    } finally {
      setLoading(false);
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked !== undefined ? (e.target as HTMLInputElement).checked : undefined;
    setConfig((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : (type === 'number' ? Number(value) : value),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${backendUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setSaveMsg("Configuration saved successfully.");
      } else {
        setSaveMsg("Failed to save configuration.");
      }
    } catch {
      setSaveMsg("Failed to save configuration.");
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-black" style={{ height: "100vh" }}>
      <Header profile="Somic" />
      <main
        className="flex-1 w-full p-0 m-0 flex items-center justify-center"
        style={{ background: "#fff", height: "100%" }}
      >
        {!unlocked ? (
          <form onSubmit={handlePasswordSubmit} className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded shadow-lg p-6 flex flex-col gap-4 min-w-[320px]">
            <label className="text-gray-800 dark:text-gray-200">
              Passwort für Somic:
            </label>
            <input
              type="password"
              className="w-full px-2 py-2 border rounded text-black dark:text-white"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <div className="text-red-600">{error}</div>}
            <button
              type="submit"
              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Prüfe..." : "Login"}
            </button>
          </form>
        ) : (
          <div className="w-full h-full relative">
            <button
              onClick={() => setShowConfig((v) => !v)}
              className="absolute top-2 right-2 z-10 px-3 py-1 bg-gray-200  text-gray-800  rounded shadow hover:bg-blue-200 dark:hover:bg-blue-800"
            >
              {showConfig ? "Close Settings" : "Settings"}
            </button>
            <iframe
              src="/somic.html"
              className="w-full h-full border-0"
              style={{ minHeight: "80vh" }}
              title="Somic Inhalt"
            />
            {showConfig && (
              <div className="absolute top-12 right-2 z-20 bg-white border border-gray-300 rounded shadow-lg p-6 w-[350px] max-w-full">
                <h2 className="text-xl font-semibold mb-4 text-black">Configuration</h2>
                {/* Select File für HTML-Cache */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-black mb-1">
                    Upload-Formatchangelist
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {/* Inline Upload-Icon (SVG) */}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12l4.5-4.5m0 0l4.5 4.5m-4.5-4.5V18" />
                    </svg>
                    Select File
                  </button>
                  <input
                    ref={fileInputRef}
                    id="html-upload"
                    type="file"
                    accept=".html"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      setUploadMsg("");
                      const file = e.target.files?.[0];
                      if (file) {
                        const formData = new FormData();
                        formData.append("file", file);
                        const res = await fetch(`${backendUrl}/api/customer-html`, {
                          method: "POST",
                          body: formData,
                        });
                        if (res.ok) {
                          setUploadMsg("HTML-File uploaded successfully.");
                        } else {
                          setUploadMsg("Error uploading HTML-File.");
                        }
                        // Reset input, damit gleiche Datei erneut hochgeladen werden kann
                        e.target.value = "";
                      }
                    }}
                  />
                  {uploadMsg && (
                    <div className={`mt-2 text-sm ${uploadMsg.includes("successfully") ? "text-green-600" : "text-red-600"}`}>{uploadMsg}</div>
                  )}
                </div>
                {loading ? (
                  <p>Loading configuration...</p>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSave();
                    }}
                    className="space-y-4"
                  >
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="OPC_UA_ENABLED"
                        checked={config.OPC_UA_ENABLED}
                        onChange={handleChange}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label className="ml-2 block text-sm text-black">
                        Enable OPC UA
                      </label>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="OPC_UA_EVENT_ENABLED"
                        checked={config.OPC_UA_EVENT_ENABLED}
                        onChange={handleChange}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label className="ml-2 block text-sm text-black">
                        Enable OPC UA Event Listener
                      </label>
                    </div>
                    <hr className="my-2" />
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="RFID_INVENTORY_ENABLED"
                        checked={config.RFID_INVENTORY_ENABLED}
                        onChange={handleChange}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label className="ml-2 block text-sm text-black">
                        Enable Direct RFID Inventory
                      </label>
                    </div>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setOpenSection(openSection === 'opcua' ? null : 'opcua')}
                        className="w-full flex justify-between items-center px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 text-black"
                      >
                        <span>OPC UA Settings</span>
                        <span>{openSection === 'opcua' ? '−' : '+'}</span>
                      </button>
                      {openSection === 'opcua' && (
                        <div className="mt-2 space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-black">OPC UA Server URL</label>
                            <input type="text" name="OPC_UA_SERVER_URL" value={config.OPC_UA_SERVER_URL} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">OPC UA Node ID</label>
                            <input type="text" name="OPC_UA_NODE_ID" value={config.OPC_UA_NODE_ID} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setOpenSection(openSection === 'opcevents' ? null : 'opcevents')}
                        className="w-full flex justify-between items-center px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 text-black"
                      >
                        <span>OPC UA Event Listener Settings</span>
                        <span>{openSection === 'opcevents' ? '−' : '+'}</span>
                      </button>
                      {openSection === 'opcevents' && (
                        <div className="mt-2 space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-black">Event Server URL</label>
                            <input type="text" name="OPC_UA_EVENT_SERVER_URL" value={config.OPC_UA_EVENT_SERVER_URL} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">Event Type NodeId</label>
                            <input type="text" name="OPC_UA_EVENT_TYPE" value={config.OPC_UA_EVENT_TYPE} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">Event Interval (ms)</label>
                            <input type="number" name="OPC_UA_EVENT_INTERVAL_MS" value={config.OPC_UA_EVENT_INTERVAL_MS} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">Max Events (Buffer)</label>
                            <input type="number" name="OPC_UA_EVENT_MAX_EVENTS" value={config.OPC_UA_EVENT_MAX_EVENTS} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setOpenSection(openSection === 'directrfid' ? null : 'directrfid')}
                        className="w-full flex justify-between items-center px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 text-black"
                      >
                        <span>Direct RFID Inventory Settings</span>
                        <span>{openSection === 'directrfid' ? '−' : '+'}</span>
                      </button>
                      {openSection === 'directrfid' && (
                        <div className="mt-2 space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-black">RFID Reader IP</label>
                            <input type="text" name="RFID_READER_IP" value={config.RFID_READER_IP} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">RFID Reader Port</label>
                            <select name="RFID_READER_PORT" value={config.RFID_READER_PORT} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black">
                              <option value={2111}>2111 (CoLa-A ASCII)</option>
                              <option value={2112}>2112 (CoLa-B Binary)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">RFID Reader Ant Mask</label>
                            <input type="text" name="RFID_READER_ANT" value={config.RFID_READER_ANT} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">Current RFID Retention (s)</label>
                            <input type="number" name="RFID_CURRENT_RETENTION_SEC" value={config.RFID_CURRENT_RETENTION_SEC} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black">Inventory Interval (s)</label>
                            <input type="number" name="RFID_INVENTORY_INTERVAL_SEC" value={config.RFID_INVENTORY_INTERVAL_SEC} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-black" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full inline-flex justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                    {saveMsg && (
                      <div className="text-sm text-green-600">{saveMsg}</div>
                    )}
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
