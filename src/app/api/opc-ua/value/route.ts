import { NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8001";

export async function GET() {
  try {
    // Backend OPC UA Value-Endpoint direkt aufrufen
    const response = await fetch(`${BACKEND_URL}/api/opc-ua/value`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Backend nicht erreichbar", value: "Fehler beim Laden" },
        { status: 500 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("Fehler beim Abrufen des OPC UA Werts:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler", value: "Fehler beim Laden" },
      { status: 500 }
    );
  }
}
