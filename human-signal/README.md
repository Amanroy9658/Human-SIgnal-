# HUMAN SIGNAL

**Train the AI. Outsmart the Bots. Become the Human Expert.**

A no-login, room-code multiplayer AI-evaluation party game. Built with Next.js, TypeScript, Tailwind CSS, Framer Motion, Supabase Postgres and Supabase Realtime.

## Included in this MVP

- Premium responsive game landing page and SIGNAL mascot treatment
- Create a room / join with a six-character code
- 2–8 players, live lobby, ready state and host controls
- Five AI-literacy challenge types with curated questions
- Timed rounds, server-side answer validation and score calculation
- Live player score updates and final leaderboard
- SQL schema, RLS read policies and SECURITY DEFINER RPCs

## 1. Requirements

- Node.js 20.9+
- A Supabase project (free tier is enough for a small demo)

## 2. Supabase setup

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor → New query**.
3. Paste and run `supabase/schema.sql`.
4. In **Project Settings → API**, copy the Project URL and anon/public key.
5. Create `.env.local` in this project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

The schema enables public read access to room/player/answer rows for no-login play. Writes are restricted to RPC functions. This is suitable for a time-boxed demo, not a hardened commercial launch: room codes are guessable, player IDs are client-held bearer identifiers, and public room data is visible. Add rate limiting, abuse controls, private room secrets and stronger identity/session tokens before production.

## 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 in two browser windows/devices. Create a room on one and join with the six-character code on the other. Use different nicknames.

## 4. Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Import the repository at https://vercel.com/new.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel project environment variables.
4. Deploy. Test the public URL from two separate devices.

## Important MVP limitations to fix before judging / production

- Host advances rounds manually. The host should click **NEXT ROUND** after everyone has answered or the timer expires.
- The current curated question bank has ten questions. It is deliberately bundled in the client for fast iteration; the answer key is also mirrored in SQL for server scoring. Keep both in sync when editing questions.
- Team Battle, AI-generated question creation, session persistence across refreshes, reconnect identity recovery, and host migration are not included in this first playable MVP.
- Public SELECT policies expose room/player/answer rows. Tighten policies and add server-issued player tokens before public production use.
- The current game timer is displayed client-side, but the database timestamp is authoritative for answer acceptance.

## Project structure

```text
app/
  globals.css
  layout.tsx
  page.tsx
lib/
  questions.ts
  supabase.ts
supabase/
  schema.sql
```
