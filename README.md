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
| `uncategorized-detail.html` | Unassigned tracks view + song search drawer + audio attribute filters |
| `curator-dashboard.html` | Curator scheduling — cadence, overdue alerts, CSV export |
| `mood-tagging.html` | Tag styles with up to 6 ordered moods |
| `spotify-sync.html` | Spotify playlist sync — register playlists, view sync status, export unmatched songs |

---

## API Routes

All routes are prefixed `/v1` and require `x-api-key`.

### Styles
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/styles` | List all styles |
| POST | `/v1/styles` | Create a new style |
| GET | `/v1/styles/:styleId/dna` | Aggregate audio profile — BPM stats, energy/danceability/valence averages, top genres, key distribution, outlier thresholds |

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

### Song Search & Attributes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/songs/search?q=` | Fuzzy search by title + artist — includes BPM, energy, key, mode if enriched |
| POST | `/v1/styles/:styleId/songs` | Add a song to a style (lands as Uncategorized) |
| GET | `/v1/songs/attributes?ids=` | Batch fetch audio attributes by library_song_id (comma-separated) |
| POST | `/v1/songs/enrich` | Enrich a batch of unenriched songs via Soundcharts (`{ limit, offset, style_name? }`) |

### Spotify Sync
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/spotify/register-sync` | Register a Spotify playlist to sync with a style |
| POST | `/v1/spotify/run-sync` | Run sync for one or all registered playlists |
| GET | `/v1/spotify/syncs` | List all registered syncs |
| DELETE | `/v1/spotify/syncs/:playlistId` | Remove a registered sync |

---

## Spotify Sync System

Playlists are synced to styles on a nightly schedule via GitHub Actions. The sync:
1. Fetches the current playlist tracks from Spotify
2. Matches each track against the library using a 4-tier matching strategy (Spotify ID → normalized title/artist → aggressive normalization → fuzzy feat/remix)
3. Adds newly matched songs to the style
4. Removes songs from the style that were removed from the playlist
5. Records added/removed/unmatched counts on the sync record

Unmatched songs (tracks in the playlist with no library match) are available via the Spotify Sync page and can be exported as CSV for the curation team to source.

**Cron job:** `.github/workflows/nightly-sync.yml` runs `POST /v1/spotify/run-sync` at 3am UTC every night.

---

## Audio Attributes System

Songs can be enriched with audio attributes from external APIs and stored in `song_attributes`. The table is keyed by `(library_song_id, source)` so multiple enrichment sources can coexist without conflict.

### Attributes stored

| Attribute | Description |
|-----------|-------------|
| `bpm` | Tempo in beats per minute |
| `key` | Musical key (C, C♯, D … B) |
| `mode` | `major` or `minor` |
| `energy` | 0–1 intensity and activity |
| `danceability` | 0–1 suitability for dancing |
| `valence` | 0–1 musical positiveness (mood) |
| `acousticness` | 0–1 confidence the track is acoustic |
| `instrumentalness` | 0–1 prediction of no vocals |
| `speechiness` | 0–1 presence of spoken words |
| `loudness` | Average loudness in dB |
| `duration_seconds` | Track length |
| `time_signature` | Beats per bar |
| `raw` | Full raw API response (JSONB) — preserves genres, labels, composers, credits |

### Current enrichment source: Soundcharts

Soundcharts is queried via ISRC (2 API calls per song: ISRC → UUID, then UUID → full metadata). The library has ~122k songs with 94.5% ISRC coverage.

**Required environment variables:**
```
SOUNDCHARTS_APP_ID=
SOUNDCHARTS_API_KEY=
```

**Running enrichment:**
```bash
# Enrich next 100 unenriched songs across the whole library
POST /v1/songs/enrich
{ "limit": 100 }

# Enrich songs from a specific style first
POST /v1/songs/enrich
{ "style_name": "Bubbakoo B", "limit": 100 }
```

### Style DNA

`GET /v1/styles/:styleId/dna` computes an aggregate audio profile across all enriched songs in a style:

- **BPM:** avg, std dev, min, max, and outlier thresholds (±1.5 SD)
- **Feel averages:** energy, danceability, valence, acousticness
- **Top genres:** ranked by song count with percentages
- **Key distribution:** top 4 keys
- **Mode split:** major vs. minor percentage

Outlier thresholds are pre-computed server-side and used by the frontend to highlight tracks that fall outside the style's normal sonic range.

### Where attributes surface in the UI

- **Track rows** — inline `122 BPM · E:86% · C maj` chips under each track title
- **Track metadata modal** — full attribute breakdown (tempo/key, feel bars, texture, credits)
- **BPM / Energy / Genre filter bar** — range sliders and dropdowns to filter the track list
- **Style DNA sidebar card** — BPM range, energy/danceability/valence bars, top genres, key distribution, outlier count
- **Outlier highlighting** — BPM outliers get a yellow border + `⚡ BPM` badge; energy outliers get red + `⚡ E`; both get purple
- **Add Songs drawer** — search result chips are green (fits style DNA) or yellow (outlier) based on the current style's BPM and energy thresholds

---

## Database Tables

### Core (existing)
- `sim_styles` — style/playlist records
- `sim_style_songs` — songs linked to a style
- `library_songs` — full song library (~122k songs, 94.5% ISRC coverage)
- `sim_style_song_classes` — class assignments (A/B/C/Rest)
- `sim_style_class_weights` — weight distribution per style

### Added by Opus
- `opus_curator_schedules` — curator cadence schedules (weekly/biweekly/monthly/quarterly)
- `opus_style_moods` — ordered mood tags per style (up to 6, position matters)
- `playlist_syncs` — registered Spotify playlist → style sync relationships
- `song_attributes` — audio attributes per song per source (BPM, energy, key, genres, etc.)

Migrations:
- `supabase-migration.sql` — curator schedules table
- `supabase-migration-moods.sql` — style moods table
- `supabase-migration-playlist-syncs.sql` — playlist syncs table
- `supabase-migration-song-attributes.sql` — song attributes table

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
