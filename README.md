# Opus Platform

Music curation and playback management platform for Custom Channels. Built with vanilla HTML/JS on GitHub Pages and a Fastify + Supabase API on Render.

**Live:**
- Frontend: https://markwillett-cpu.github.io/opus-platform/
- API: https://opus-platform.onrender.com

---

## Architecture

```
Browser (GitHub Pages)
  └── api-client.js
        └── x-api-key header
              └── Fastify API (Render)
                    └── Supabase (PostgreSQL)
```

Auth is a static `x-api-key` header checked on every request. The service role key never leaves the API server.

---

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Playback class manager — assign tracks to A/B/C/Rest |
| `class-detail.html` | Per-class track view |
| `uncategorized-detail.html` | Unassigned tracks view + song search drawer |
| `curator-dashboard.html` | Curator scheduling — cadence, overdue alerts, CSV export |
| `mood-tagging.html` | Tag styles with up to 6 ordered moods |

---

## API Routes

All routes are prefixed `/v1` and require `x-api-key`.

### Styles
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/styles` | List all styles |

### Tracks & Assignments
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/styles/:styleId/tracks` | All tracks for a style |
| GET | `/v1/styles/:styleId/assignments` | Class assignments for a style |
| PUT | `/v1/styles/:styleId/assignments` | Bulk upsert assignments |
| DELETE | `/v1/styles/:styleId/assignments` | Remove assignments |

### Weights
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/styles/:styleId/weights` | Class weight distribution |
| PUT | `/v1/styles/:styleId/weights` | Update weights (must sum to 100) |

### Playback Profile
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/styles/:styleId/playback-profile` | Full playback profile |

### Curator Schedules
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/curator-schedules` | All schedules (`?curator_name=` `?style_id=`) |
| GET | `/v1/curator-schedules/curators` | Distinct curator names |
| PUT | `/v1/curator-schedules` | Upsert a schedule |
| PATCH | `/v1/curator-schedules/:styleId/mark-updated` | Stamp last_updated = today |
| DELETE | `/v1/curator-schedules/:styleId` | Remove a schedule |

### Mood Tagging
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/styles/:styleId/moods` | Ordered moods for a style |
| GET | `/v1/moods/all` | All styles with moods (bulk load) |
| PUT | `/v1/styles/:styleId/moods` | Full replace moods (ordered, max 6) |
| DELETE | `/v1/styles/:styleId/moods` | Clear all moods for a style |

### Song Search
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/songs/search?q=` | Fuzzy search by title + artist |
| POST | `/v1/styles/:styleId/songs` | Add a song to a style (lands as Uncategorized) |

---

## Database Tables

### Core (existing)
- `sim_styles` — style/playlist records
- `sim_style_songs` — songs linked to a style
- `library_songs` — full song library
- `sim_style_song_classes` — class assignments (A/B/C/Rest)
- `sim_style_class_weights` — weight distribution per style

### Added by Opus
- `opus_curator_schedules` — curator cadence schedules (weekly/biweekly/monthly/quarterly)
- `opus_style_moods` — ordered mood tags per style (up to 6, position matters)

Migrations for both are in the repo root:
- `supabase-migration.sql` — curator schedules table
- `supabase-migration-moods.sql` — style moods table

---

## Mood System

22 moods organized into 5 families:

| Family | Moods |
|--------|-------|
| Energy & Excitement | Energetic, Upbeat, Vibrant, Festive, Joyful, Uplifting |
| Warmth & Positivity | Fun, Warm, Comfortable, Welcoming, Soulful |
| Calm & Reflective | Calm, Relaxed, Peaceful, Reflective, Intimate |
| Polished & Refined | Sophisticated, Premium, Professional |
| Era & Style | Classic, Current, Modern |

Each style can have up to 6 moods. Position is significant — Mood 1 is primary.

---

## Frontend Config

`config.js` controls:
- `API_BASE_URL` — points to Render API
- `API_KEY` — sandbox key for auth
- `STYLES_TO_EXCLUDE` — style names hidden from UI
- `MAX_TRACKS_DISPLAY` — cap for track table rendering
- `SEARCH_DEBOUNCE` — ms delay on search inputs
- `TOAST_DURATION` — ms for success toast visibility

---

## Local Development

```bash
# API
cd api
npm install
cp .env.example .env   # fill in Supabase creds + API key
npm run dev            # runs on :8787

# Frontend — any static server
cd frontend
npx serve .
```

Update `config.js` `API_BASE_URL` to `http://localhost:8787/v1` for local API.

---

## Deployment

**API → Render:** push to `main`, auto-deploys from `api/` directory. Env vars in Render dashboard.

**Frontend → GitHub Pages:** push to `main`, serves from `frontend/`.

**Deploy sequence for DB changes:**
1. Run migration SQL in Supabase dashboard
2. Deploy API
3. Deploy frontend
