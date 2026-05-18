import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { providerGetRoom, providerModerateGuest, providerSetAccess } from "@/lib/socketProvider";

export async function POST(request: Request) {
  const session = await getSession(request);

  if (!session.isHost || !session.roomCode) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const room = await providerGetRoom(session.roomCode);

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const intent = body?.intent;

  if (intent === "set-access") {
    const access = body?.access;
    if (access !== "open" && access !== "locked") {
      return NextResponse.json({ error: "Invalid access setting" }, { status: 400 });
    }

    await providerSetAccess(room.roomCode, access);
    return NextResponse.json({ ok: true });
  }

  if (intent === "approve-guest") {
    const guestId =
      typeof body?.guestId === "string" ? body.guestId.trim() : "";
    if (!guestId) {
      return NextResponse.json({ error: "guestId is required" }, { status: 400 });
    }

    await providerModerateGuest(room.roomCode, "approve-guest", guestId);
    return NextResponse.json({ ok: true });
  }

  if (intent === "reject-guest") {
    const guestId =
      typeof body?.guestId === "string" ? body.guestId.trim() : "";
    if (!guestId) {
      return NextResponse.json({ error: "guestId is required" }, { status: 400 });
    }

    await providerModerateGuest(room.roomCode, "reject-guest", guestId);
    return NextResponse.json({ ok: true });
  }

  if (intent === "kick-guest") {
    const guestId =
      typeof body?.guestId === "string" ? body.guestId.trim() : "";
    if (!guestId) {
      return NextResponse.json({ error: "guestId is required" }, { status: 400 });
    }

    await providerModerateGuest(room.roomCode, "kick-guest", guestId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid intent" }, { status: 400 });
}
