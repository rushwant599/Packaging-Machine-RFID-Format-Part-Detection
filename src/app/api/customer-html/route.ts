import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_PATH = path.join(DATA_DIR, "customer-html-cache.html");

// API route to get or update the cached customer HTML file
export async function GET() {
  try {
    const html = await fs.readFile(DATA_PATH, "utf-8");
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  } catch {
    return new NextResponse("", { status: 200 });
  }
}

// Handle file upload to update the cached customer HTML file
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return new NextResponse("No file uploaded", { status: 400 });
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_PATH, buffer);
  return new NextResponse(buffer, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
