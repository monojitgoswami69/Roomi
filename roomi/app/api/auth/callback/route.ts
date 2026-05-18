import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSpotifyProfile } from "@/lib/spotify";

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token: string;
};

function getAuthHeader(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/api/auth/callback";
  const appOrigin = new URL(redirectUri).origin;

  // Handle cancellation or denial from Spotify OAuth
  if (error || !code) {
    const session = await getSession(request);
    session.flashError = "auth-cancelled";
    await session.save();
    return NextResponse.redirect(new URL("/", appOrigin));
  }

  try {
    const payload = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`Spotify token exchange failed: ${response.status}`);
    }
    const tokenPayload = (await response.json()) as SpotifyTokenResponse;

    const profile = await getSpotifyProfile(tokenPayload.access_token);
    const hostId = crypto.randomUUID();

    const session = await getSession(request);
    session.hostId = hostId;
    session.roomCode = undefined;
    session.accessToken = tokenPayload.access_token;
    session.refreshToken = tokenPayload.refresh_token;
    session.accountName = profile.displayName;
    session.isHost = true;
    await session.save();

    return NextResponse.redirect(new URL("/", appOrigin));
  } catch {
    const session = await getSession(request);
    session.flashError = "auth-failed";
    await session.save();
    return NextResponse.redirect(new URL("/", appOrigin));
  }
}
