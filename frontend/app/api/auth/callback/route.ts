import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exchangeCodeForTokens, getSpotifyProfile } from "@/lib/spotify";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const redirectUri = (
    process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/api/auth/callback"
  ).trim();
  const appOrigin = new URL(redirectUri).origin;

  if (error || !code) {
    const session = await getSession();
    session.flashError = "auth-cancelled";
    await session.save();
    return NextResponse.redirect(new URL("/", appOrigin));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const profile = await getSpotifyProfile(tokens.access_token);
    const session = await getSession();
    session.hostId = crypto.randomUUID();
    session.roomCode = undefined;
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.accountName = profile.displayName;
    session.isHost = true;
    await session.save();
    return NextResponse.redirect(new URL("/", appOrigin));
  } catch {
    const session = await getSession();
    session.flashError = "auth-failed";
    await session.save();
    return NextResponse.redirect(new URL("/", appOrigin));
  }
}
