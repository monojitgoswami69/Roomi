import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  hostId?: string;
  roomCode?: string;
  accessToken?: string;
  refreshToken?: string;
  accountName?: string;
  isHost?: boolean;
  flashError?: string;
}

export const sessionOptions: SessionOptions = {
  cookieName: "roomi-session",
  password:
    process.env.SESSION_PASSWORD ?? "roomi_session_password_at_least_32_chars",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
