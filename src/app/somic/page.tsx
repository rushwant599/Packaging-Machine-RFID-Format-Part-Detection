"use client";
import Header from "@/components/Header";
import { useState } from "react";
import { useAPI } from "@/lib/api-client";

export default function SomicPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const api = useAPI();

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
              className="w-full px-2 py-2 border rounded text-white"
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
          <div className="w-full h-full">
            <iframe
              src="/somic.html"
              className="w-full h-full border-0"
              style={{ minHeight: "80vh" }}
              title="Somic Inhalt"
            />
          </div>
        )}
      </main>
    </div>
  );
}
