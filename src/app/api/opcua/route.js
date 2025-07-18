// src/app/api/opcua/route.js
import { NextResponse } from 'next/server';
import { readRfidTags } from './opcua-client';

export async function GET() {
  try {
    const tags = await readRfidTags();
    return NextResponse.json({ tags });
  } catch (err) {
    console.error(err);
    return new NextResponse(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
