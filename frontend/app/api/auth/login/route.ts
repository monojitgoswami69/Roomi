import { NextResponse } from "next/server";

const SCOPES = [
  "streaming",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-email",
  "user-read-private",
].join(" ");

export async function GET() {
  const redirectUri = (
    process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/api/auth/callback"
  ).trim();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: (process.env.SPOTIFY_CLIENT_ID ?? "").trim(),
    scope: SCOPES,
    redirect_uri: redirectUri,
  });
  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
