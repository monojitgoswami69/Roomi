"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";

function normalizeCode(v: string) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function toastFor(error: string | null): string {
  if (error === "room-not-found") return "Room not found";
  if (error === "host-session-missing") return "Session expired. Please reconnect Spotify.";
  if (error === "auth-cancelled") return "Spotify connection was cancelled. Try again when you're ready.";
  if (error === "auth-failed") return "Failed to connect Spotify. Please try again.";
  return "";
}

type AuthState = {
  connected: boolean;
  accountName: string;
  hasActiveRoom: boolean;
  roomCode: string | null;
  flashError?: string | null;
};

export default function HomePage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState>({
    connected: false,
    accountName: "",
    hasActiveRoom: false,
    roomCode: null,
    flashError: null,
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const canJoin = useMemo(() => code.length === 6 && name.trim().length > 0, [code, name]);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const payload = await res.json();
        if (!res.ok || cancelled) return;
        setAuth({
          connected: Boolean(payload?.connected),
          accountName: String(payload?.accountName ?? ""),
          hasActiveRoom: Boolean(payload?.hasActiveRoom),
          roomCode: payload?.roomCode ? String(payload.roomCode) : null,
          flashError: payload?.flashError ? String(payload.flashError) : null,
        });
        const flash = toastFor(payload?.flashError ? String(payload.flashError) : null);
        if (flash) setToast(flash);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateRoom = async () => {
    setCreateLoading(true);
    try {
      const res = await fetch("/api/room/create", { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setToast(payload?.error ?? "Could not create room");
        setCreateLoading(false);
        return;
      }
      router.push("/host");
    } catch {
      setToast("Could not create room");
      setCreateLoading(false);
    }
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch {
      setLogoutLoading(false);
      setToast("Could not log out");
    }
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!canJoin) return;
    setJoinLoading(true);
    setJoinError("");
    router.push(`/room/${code}?name=${encodeURIComponent(name.trim())}`);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#000005",
        backgroundImage:
          "radial-gradient(circle at 20% 0%, rgba(15, 23, 42, 0.8) 0%, transparent 50%), radial-gradient(circle at 80% 100%, rgba(15, 23, 42, 0.6) 0%, transparent 50%)",
      }}
    >
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 80,
          paddingLeft: 20,
          paddingRight: 20,
          paddingBottom: 60,
        }}
      >
        {toast && (
          <div
            style={{
              marginBottom: 24,
              width: "100%",
              maxWidth: 520,
              borderRadius: 16,
              padding: "12px 18px",
              fontSize: 14,
              fontFamily: "var(--font-sans)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(196,117,106,0.12)",
              border: "1px solid rgba(196,117,106,0.2)",
              color: "#C4756A",
            }}
          >
            <span>{toast}</span>
            <button
              onClick={() => setToast("")}
              style={{
                marginLeft: 12,
                color: "#C4756A",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              ×
            </button>
          </div>
        )}

        <h1
          style={{
            textAlign: "center",
            fontFamily: "var(--font-sans)",
            fontWeight: 700,
            fontSize: "clamp(52px, 7vw, 88px)",
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            margin: 0,
          }}
        >
          <span style={{ color: "var(--text-primary)" }}>Music is better </span>
          <span style={{ color: "var(--accent)" }}>shared.</span>
        </h1>

        <p
          style={{
            marginTop: 20,
            maxWidth: 480,
            textAlign: "center",
            fontFamily: "var(--font-sans)",
            fontWeight: 400,
            fontSize: 18,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          Connect once, then create your room when you&apos;re ready.
        </p>

        <div className="minimal-card" style={{ marginTop: 56, width: "100%", maxWidth: 864 }}>
          <div className="landing-cards">
            <div
              className="card-column"
              style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 32 }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 22,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginTop: 20,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Host a Room
                </h2>

                {authLoading ? (
                  <p style={{ marginTop: 10, color: "var(--text-secondary)" }}>Checking account...</p>
                ) : auth.connected ? (
                  <>
                    <p style={{ marginTop: 10, color: "var(--text-secondary)" }}>
                      Welcome,{" "}
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                        {auth.accountName || "Host"}
                      </span>
                    </p>
                    <p style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 14 }}>
                      Connected account is ready. Create a room with one click.
                    </p>
                  </>
                ) : (
                  <p style={{ marginTop: 10, color: "var(--text-secondary)" }}>
                    Connect Spotify first. This signs in your account only, no room is created yet.
                  </p>
                )}
              </div>

              {!authLoading && !auth.connected ? (
                <a
                  href="/api/auth/login"
                  className="spotify-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    width: "100%",
                    height: 52,
                    borderRadius: 14,
                    background: "#1DB954",
                    border: "none",
                    fontFamily: "var(--font-sans)",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#000000",
                    letterSpacing: "-0.01em",
                    textDecoration: "none",
                    cursor: "pointer",
                  }}
                >
                  Connect with Spotify
                </a>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    type="button"
                    disabled={createLoading}
                    onClick={() => void handleCreateRoom()}
                    className="letsgo-btn"
                    style={{
                      width: "100%",
                      height: 52,
                      borderRadius: 14,
                      background: "var(--accent)",
                      border: "none",
                      fontFamily: "var(--font-sans)",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#FFFFFF",
                      letterSpacing: "-0.01em",
                      cursor: "pointer",
                      opacity: createLoading ? 0.55 : 1,
                    }}
                  >
                    {createLoading ? "Creating room..." : "Create Room"}
                  </button>

                  <button
                    type="button"
                    disabled={logoutLoading}
                    onClick={() => void handleLogout()}
                    style={{
                      width: "100%",
                      height: 52,
                      borderRadius: 14,
                      background: "rgba(239, 68, 68, 0.15)",
                      border: "1px solid rgba(239, 68, 68, 0.35)",
                      fontFamily: "var(--font-sans)",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#FCA5A5",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <LogOut size={16} />
                    {logoutLoading ? "Logging out..." : "Logout"}
                  </button>
                </div>
              )}
            </div>

            <div className="card-separator" />

            <div
              className="card-column"
              style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 32 }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 22,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginTop: 20,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Join a Room
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 15,
                    fontWeight: 400,
                    color: "var(--text-secondary)",
                    lineHeight: 1.65,
                    marginTop: 10,
                    marginBottom: 28,
                  }}
                >
                  Enter the 6-digit code shared by the host to join.
                </p>
              </div>

              <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  value={code}
                  onChange={(e) => setCode(normalizeCode(e.target.value))}
                  placeholder="ROOM CODE"
                  className="minimal-input"
                  style={{
                    width: "100%",
                    height: 52,
                    borderRadius: 14,
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    padding: "0 18px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    color: "var(--text-primary)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    textAlign: "center",
                    outline: "none",
                  }}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder="Your Display Name"
                  className="minimal-input"
                  style={{
                    width: "100%",
                    height: 52,
                    borderRadius: 14,
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    padding: "0 18px",
                    fontFamily: "var(--font-sans)",
                    fontSize: 14,
                    color: "var(--text-primary)",
                    textAlign: "center",
                    outline: "none",
                  }}
                />

                {joinError ? (
                  <p style={{ textAlign: "center", fontSize: 13, color: "#C4756A", margin: 0 }}>{joinError}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={!canJoin || joinLoading}
                  className="letsgo-btn"
                  style={{
                    width: "100%",
                    height: 52,
                    borderRadius: 14,
                    background: "var(--accent)",
                    border: "none",
                    fontFamily: "var(--font-sans)",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#FFFFFF",
                    letterSpacing: "-0.01em",
                    cursor: "pointer",
                    marginTop: 6,
                    opacity: !canJoin || joinLoading ? 0.4 : 1,
                  }}
                >
                  {joinLoading ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Checking...
                    </span>
                  ) : (
                    "Let's Go"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
