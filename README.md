# Roomi

Roomi is a real-time shared music room for parties, hostel common rooms, dorms, cafes, clubs, and small events where one speaker is playing but everyone wants a say in the queue.

Instead of passing one phone around or letting one person control the aux, a host creates a Spotify-backed room, shares a 6-character code or QR code, and guests join instantly from their own devices. Everyone can add songs, vote on the queue, and watch the room update live.

## The Significance & Solution

### Scenario

Group music is usually socially messy. In a hostel lounge, house party, or college event, the music source is often controlled by one person. Guests either interrupt the host to request songs, pass around a phone, or silently tolerate tracks they do not like. The experience breaks down because:

- The person connected to the speaker becomes the accidental DJ.
- Song requests are scattered across conversations, chats, and verbal interruptions.
- Guests have no lightweight way to influence what plays next.
- A bad song can kill the mood, but skipping it manually can feel awkward.
- Public rooms need basic control, because not every join request should be trusted.

### MVP Solution

Roomi turns the music queue into a shared room interface:

- The host logs in with Spotify and creates a room without logging out when a session ends.
- Guests join using a room code or QR code without needing Spotify accounts.
- The host can keep the room open or lock it so new guests require approval.
- Guests can search Spotify, stage multiple songs, and add them to the shared queue.
- Songs are added in queue order, not reordered by votes, so the queue stays predictable.
- Every added song is automatically upvoted by the person who added it.
- All clients see live queue, vote, guest, and room-status updates through Socket.io.
- Hosts can approve, reject, or kick guests from the room.
- The host controls playback; guests see the same UI style but cannot control playback or room security.

The result is a democratic music experience where the host remains in control of the room while the crowd can still participate naturally.

## Tech Stack

| Area | Technology |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4, custom CSS variables, Lucide React, React Icons |
| Authentication | Spotify OAuth, Iron Session encrypted cookies |
| Music Playback | Spotify Web API, Spotify Web Playback SDK |
| Real-time Sync | Socket.io, dedicated Express socket provider |
| Backend/API | Next.js Route Handlers, Express for socket middle layer |
| State Storage | In-memory room store with room TTL for MVP sessions |
| QR Codes | `qrcode` with custom rounded SVG rendering |
| Tooling | ESLint, TypeScript, npm |

## System Architecture & User Flow

```text
Host Browser
  Spotify OAuth + Web Playback SDK
        |
        v
Next.js App + API Routes  <----->  In-memory Room Store
        |
        | REST mutations
        v
Dedicated Socket Provider + In-memory Room Store  <----->  Host + Guest Clients
        |
        v
Live queue, votes, room status, guest list, approval state
```

### Host Flow

1. Host connects a Spotify account on the landing page.
2. Host clicks "Create Room" to generate a 6-character room code.
3. The host page starts the Spotify Web Playback SDK and registers the active playback device.
4. Host shares the room code or QR code with guests.
5. Host can switch the room between open and locked.
6. Host can approve waiting guests, reject requests, kick connected guests, add songs, vote, seek playback, skip, pause, and end the room session.

### Guest Flow

1. Guest enters a room code or scans the QR code.
2. Guest enters a display name and joins the room.
3. If the room is open, the guest joins immediately.
4. If the room is locked, the guest waits until the host approves them.
5. Approved guests can add songs and vote on the queue.
6. Guests see the same room layout as the host, but playback controls and room-security controls remain read-only.

### Data Flow

- Queue additions, votes, access changes, approvals, rejects, kicks, skips, and playback changes go through Next.js API routes.
- The API routes call the socket provider over HTTP.
- The socket provider owns the in-memory room store and emits fresh room snapshots after mutations.
- Connected clients receive `room-updated` events and re-render without manual refresh.
- Queue actions are guarded so pending, rejected, or kicked guests cannot keep adding or voting.

## Local Setup Instructions

### Prerequisites

- Node.js 20+
- npm
- A Spotify Developer app from the Spotify Developer Dashboard
- A Spotify Premium account for the host playback device

### 1. Clone the Repository

```bash
git clone <your-github-repo-url>
cd Roomi
```

The project is split into two independently deployable packages:

- `roomi/` - Next.js app and API routes, deployable on Vercel.
- `socket-provider/` - Express + Socket.io room state service, deployable on Render.

### 2. Install Dependencies

```bash
cd socket-provider
npm install

cd ../roomi
npm install
```

### 3. Configure Environment Variables

Create `.env` for the socket provider:

```bash
cd socket-provider
cp .env.example .env
```

```env
PORT=4001
CORS_ORIGIN=http://127.0.0.1:3000
```

Create `.env.local` for the Next app:

```bash
cd ../roomi
cp .env.example .env.local
```

Fill in the required values:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback
SESSION_PASSWORD=at_least_32_characters_random_secret

NEXT_PUBLIC_SOCKET_URL=http://127.0.0.1:4001
SOCKET_PROVIDER_URL=http://127.0.0.1:4001
```

In the Spotify Developer Dashboard, add this redirect URI exactly:

```text
http://127.0.0.1:3000/api/auth/callback
```

Use `127.0.0.1`, not `localhost`, so OAuth cookies stay consistent.

### 4. Run Locally

Start the socket provider in one terminal:

```bash
cd socket-provider
npm run dev
```

Start the Next.js app in another terminal:

```bash
cd roomi
npm run dev
```

Open the app:

```text
http://127.0.0.1:3000
```

### 5. Useful Commands

```bash
cd roomi
npm run lint
npm run build

cd ../socket-provider
node --check index.js
npm start
```

## Production Deployment

### Render: Socket Provider

Deploy `socket-provider/` as a Render Web Service.

- Root directory: `socket-provider`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Environment variables:
  - `CORS_ORIGIN=https://your-vercel-app.vercel.app`

Render provides `PORT` automatically, so you usually do not need to set it.

### Vercel: Next.js App

Deploy `roomi/` as the Vercel project root.

- Root directory: `roomi`
- Framework preset: Next.js
- Build command: `npm run build`
- Environment variables:
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
  - `SPOTIFY_REDIRECT_URI=https://your-vercel-app.vercel.app/api/auth/callback`
  - `SESSION_PASSWORD`, at least 32 random characters
  - `NEXT_PUBLIC_SOCKET_URL=https://your-render-socket-service.onrender.com`
  - `SOCKET_PROVIDER_URL=https://your-render-socket-service.onrender.com`

In the Spotify Developer Dashboard, add the production redirect URI exactly:

```text
https://your-vercel-app.vercel.app/api/auth/callback
```

## Future Scope

- Persistent storage: Move room, queue, vote, and guest data from memory to Redis or PostgreSQL so sessions survive server restarts.
- Smarter moderation: Add host-configurable vote thresholds, auto-skip rules, profanity filters, and duplicate artist cooldowns.
- Better playback intelligence: Use audio features, BPM, genre, and energy matching to suggest smoother transitions.
- Multi-platform support: Add YouTube, SoundCloud, or local file support for rooms that do not rely only on Spotify.
- Role controls: Add co-hosts, trusted guests, guest mute/ban lists, and room-level permissions.
- Analytics: Show top contributors, most skipped songs, room mood trends, and post-session playlists.
- Production scalability: Replace single-process memory state with shared state and horizontal socket scaling.
- Mobile polish: Add installable PWA flows, haptic feedback, and lock-screen friendly room controls.

## MVP Status

Roomi currently supports the core end-to-end experience: Spotify host login, room creation, QR/code joining, locked/open room access, approval waitlist, guest kicking, live queue updates, voting, song search, automatic first-track playback, and host-side playback controls.
