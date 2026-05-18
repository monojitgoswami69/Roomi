import axios from "axios";
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
    return NextResponse.redirect(new URL("/?error=auth-cancelled", appOrigin));
  }

  try {
    const payload = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const response = await axios.post<SpotifyTokenResponse>(
      "https://accounts.spotify.com/api/token",
      payload,
      {
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const profile = await getSpotifyProfile(response.data.access_token);
    const hostId = crypto.randomUUID();

    const session = await getSession(request);
    session.hostId = hostId;
    session.roomCode = undefined;
    session.accessToken = response.data.access_token;
    session.refreshToken = response.data.refresh_token;
    session.accountName = profile.displayName;
    session.isHost = true;
    await session.save();

    return NextResponse.redirect(new URL("/", appOrigin));
  } catch {
    return NextResponse.redirect(new URL("/?error=auth-failed", appOrigin));
  }
}
