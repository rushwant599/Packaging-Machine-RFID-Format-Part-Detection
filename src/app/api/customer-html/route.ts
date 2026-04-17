import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_LANG = "default";

function normalizeLang(lang: string | null | undefined): string {
  if (!lang) return DEFAULT_LANG;
  const cleaned = lang
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!cleaned || cleaned === "default" || cleaned === "fallback") return DEFAULT_LANG;
  return cleaned.slice(0, 24);
}

function getDataPath(lang: string): string {
  if (lang === DEFAULT_LANG) {
    return path.join(DATA_DIR, "customer-html-cache.html");
  }
  return path.join(DATA_DIR, `customer-html-cache.${lang}.html`);
}

async function resolveExistingDataPath(lang: string): Promise<{ lang: string; filePath: string }> {
  const preferredPath = getDataPath(lang);
  try {
    await fs.access(preferredPath);
    return { lang, filePath: preferredPath };
  } catch {
    const fallbackPath = getDataPath(DEFAULT_LANG);
    return { lang: DEFAULT_LANG, filePath: fallbackPath };
  }
}

// API route to get or update the cached customer HTML file
export async function GET(req: NextRequest) {
  try {
    const lang = normalizeLang(req.nextUrl.searchParams.get("lang"));
    const resolved = await resolveExistingDataPath(lang);
    const html = await fs.readFile(resolved.filePath, "utf-8");
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "X-Somic-HTML-Lang": resolved.lang,
      },
    });
  } catch {
    return new NextResponse("", { status: 200 });
  }
}

// Handle file upload to update the cached customer HTML file
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const langRaw = (formData.get("lang") as string | null) ?? req.nextUrl.searchParams.get("lang");
  const lang = normalizeLang(langRaw);
  const dataPath = getDataPath(lang);
  if (!file) {
    return new NextResponse("No file uploaded", { status: 400 });
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(dataPath, buffer);
  if (lang !== DEFAULT_LANG) {
    await fs.writeFile(getDataPath(DEFAULT_LANG), buffer);
  }
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "X-Somic-HTML-Lang": lang,
    },
  });
}
