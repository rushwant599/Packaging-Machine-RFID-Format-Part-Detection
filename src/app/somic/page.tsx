"use client";
import Header from "@/components/Header";
import { useState } from "react";

export default function SomicPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password === "cimos9160") {
      setUnlocked(true);
      setError("");
    } else {
      setError("Falsches Passwort!");
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
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Login
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
