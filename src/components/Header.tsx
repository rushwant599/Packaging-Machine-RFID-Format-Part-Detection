"use client";
import Image from "next/image";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export default function Header({ profile }: { profile: string }) {
  const [showMenu, setShowMenu] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { t, lang, setLang } = useI18n();

  function handleProfileSelect(selected: string) {
    setShowMenu(false);
    if (selected === "Somic") {
      if (pathname !== "/somic") router.push("/somic");
    } else {
      if (pathname !== "/customer") router.push("/customer");
    }
  }

  return (
    <header className="w-full flex items-center justify-between px-6 py-4 shadow-sm bg-white dark:bg-gray-600">
      {/* Logo links */}
      <div className="flex items-center">
        <Image
          src="/somic-logo.png"
          alt="Somic Logo"
          width={100}
          height={100}
        />
      </div>
      {/* App-Name mittig */}
      <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-900 flex-1">
        Somic RFID
      </h1>
      {/* Profil-Auswahl & Sprache rechts */}
      <div className="relative flex items-center gap-2">
        {/* Language toggle */}
        <button
          className="px-3 py-2 rounded bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 transition text-sm"
          onClick={() => setLang(lang === "de" ? "en" : "de")}
          aria-label={t("language")}
          title={t("language")}
        >
          {lang === "de" ? "DE" : "EN"}
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 transition"
          onClick={() => setShowMenu((v) => !v)}
        >
          <Image
            src={profile === "Somic" ? "/somic-logo.png" : "/globe.svg"}
            alt="Profil"
            width={24}
            height={24}
          />
          <span className="hidden sm:inline text-gray-800 dark:text-gray-200">{profile === "Somic" ? t("somic") : t("customer")}</span>
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-10 w-40 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded shadow-lg z-10">
            <button
              className="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-neutral-700"
              onClick={() => handleProfileSelect("Customer")}
            >
              {t("customer")}
            </button>
            <button
              className="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-neutral-700"
              onClick={() => handleProfileSelect("Somic")}
            >
              {t("somic")}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
