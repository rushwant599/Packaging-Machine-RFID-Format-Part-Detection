"use client";
import Header from "@/components/Header";
import React, { useRef, useState, useEffect } from "react";

export default function CustomerPage() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
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
          <input
            id="html-upload"
            type="file"
            accept=".html"
            ref={inputRef}
            onChange={handleFileChange}
            style={{ color: "#666", paddingTop: 0, paddingBottom: 0 }}
          />
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