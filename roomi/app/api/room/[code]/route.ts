import { NextResponse } from "next/server";
import { providerGetRoom } from "@/lib/socketProvider";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const url = new URL(_request.url);
  const viewerId = url.searchParams.get("viewerId")?.trim() || undefined;
  const roomState = await providerGetRoom(code, viewerId);

  if (!roomState) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json(roomState);
}
