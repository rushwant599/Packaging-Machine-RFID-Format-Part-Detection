import { NextResponse } from 'next/server';

export async function GET() {
  // Proxy-Request an das Backend
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001'}/rfid/tags`);
  const data = await res.json();
  return NextResponse.json(data);
}
