# Opus API

Fastify REST API serving the Opus frontend. Deployed on Render, backed by Supabase (PostgreSQL).

**Base URL:** `https://opus-platform.onrender.com`  
**Auth:** `x-api-key` header on every request (except `/health`)

---

## Project Structure

```
api/
├── server.js              # Entry point — registers all routes
└── src/
    ├── config.js          # Env var loading
    ├── auth.js            # x-api-key middleware
    ├── supabase.js        # Supabase client + assertNoError helper
    ├── normalize.js       # normalizeStyleId, normalizeClassCode
    └── routes/
        ├── styles.js              # GET /v1/styles, POST /v1/styles, GET /v1/styles/:id/dna
        ├── styleTracks.js         # GET /v1/styles/:id/tracks
        ├── styleAssignments.js    # CRUD /v1/styles/:id/assignments
        ├── styleWeights.js        # CRUD /v1/styles/:id/weights
        ├── stylePlaybackProfile.js # GET /v1/styles/:id/playback-profile
        ├── curatorSchedules.js    # CRUD /v1/curator-schedules
        ├── styleMoods.js          # CRUD /v1/styles/:id/moods
        ├── songSearch.js          # GET /v1/songs/search, POST /v1/styles/:id/songs
        ├── songEnrich.js          # GET /v1/songs/attributes, POST /v1/songs/enrich
        └── spotifyMatcher.js      # Spotify sync — register, run, list, delete
```

---

## Environment Variables

```env
PORT=8787
NODE_ENV=development
OPUS_INTERNAL_API_KEY=your-key-here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ORIGIN=https://markwillett-cpu.github.io
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REFRESH_TOKEN=your-spotify-refresh-token
SPOTIFY_TARGET_USER_ID=your-spotify-username
API_BASE_URL=https://opus-platform.onrender.com
SOUNDCHARTS_APP_ID=your-soundcharts-app-id
SOUNDCHARTS_API_KEY=your-soundcharts-api-key
```

---

## Endpoints

### Health
```
GET /health
```
No auth. Returns `{ ok: true }`.

---

### Styles
```
GET  /v1/styles
POST /v1/styles   body: { name }
GET  /v1/styles/:styleId/dna
```

`GET /v1/styles` returns `{ data: [{ id, name }] }`.  
`POST /v1/styles` returns `{ ok: true, style: { id, name } }`.  
`GET /v1/styles/:styleId/dna` returns an aggregate audio profile for all enriched songs in the style:

```json
{
  "bpm": { "avg": 112, "std": 14.2, "min": 75, "max": 190, "outlierLow": 90.7, "outlierHigh": 133.3 },
  "energy": 0.72,
  "danceability": 0.68,
  "valence": 0.54,
  "acousticness": 0.18,
  "genres": [{ "genre": "hip-hop", "count": 48, "pct": 52 }, ...],
  "keys": ["C", "F", "G", "A"],
  "majorPct": 64,
  "enrichedCount": 93,
  "totalCount": 93
}
```

Outlier thresholds are ±1.5 standard deviations from the BPM mean and are used by the frontend to flag tracks outside the style's normal sonic range.

---

### Tracks
```
GET /v1/styles/:styleId/tracks
```
Returns tracks with full song metadata. Capped at 3000 rows.

```json
{
  "data": [{
    "library_song_id": "uuid",
    "sim_duration_seconds": 214,
    "song": { "id", "title", "artist", "album", "peak_year", "run_time_seconds", "styles" }
  }]
}
```

---

### Assignments
```
GET    /v1/styles/:styleId/assignments
PUT    /v1/styles/:styleId/assignments   body: { assignments: [{ library_song_id, class_code }] }
DELETE /v1/styles/:styleId/assignments   body: { songIds: ["uuid", ...] }
```

`class_code` must be `A`, `B`, `C`, or `REST`. Normalized to uppercase automatically.

---

### Weights
```
GET /v1/styles/:styleId/weights
PUT /v1/styles/:styleId/weights   body: { weights: [{ class_code, weight_pct }] }
```

Weights must sum to exactly 100. Returns `{ ok: true, upserted: 4 }`.

---

### Playback Profile
```
GET /v1/styles/:styleId/playback-profile
```

Composite view — tracks, assignments, and weights in one call.

---

### Curator Schedules
```
GET    /v1/curator-schedules               ?curator_name= ?style_id=
GET    /v1/curator-schedules/curators
PUT    /v1/curator-schedules               body: { style_id, curator_name, cadence, last_updated?, notes? }
PATCH  /v1/curator-schedules/:styleId/mark-updated
DELETE /v1/curator-schedules/:styleId
```

`cadence` values: `weekly` (7d) · `biweekly` (14d) · `monthly` (30d) · `quarterly` (90d)

Requires `supabase-migration.sql` to be run first.

---

### Mood Tagging
```
GET    /v1/styles/:styleId/moods
GET    /v1/moods/all
PUT    /v1/styles/:styleId/moods     body: { moods: ["Calm", "Relaxed", "Peaceful"] }
DELETE /v1/styles/:styleId/moods
```

`PUT` is a full replace — sends the complete ordered array. Max 6 moods. Position is significant (index 0 = Mood 1 = primary).

Valid mood values: `Calm`, `Classic`, `Comfortable`, `Current`, `Energetic`, `Festive`, `Fun`, `Intimate`, `Joyful`, `Modern`, `Peaceful`, `Premium`, `Professional`, `Reflective`, `Relaxed`, `Sophisticated`, `Soulful`, `Upbeat`, `Uplifting`, `Vibrant`, `Warm`, `Welcoming`

Requires `supabase-migration-moods.sql` to be run first.

---

### Song Search & Attributes
```
GET  /v1/songs/search?q=petty+learning&limit=20
POST /v1/styles/:styleId/songs   body: { library_song_id: "uuid" }
GET  /v1/songs/attributes?ids=uuid1,uuid2,...
POST /v1/songs/enrich            body: { limit, offset?, style_name? }
```

**Search** splits the query into tokens — each token must match somewhere in `title` or `artist` (case-insensitive). Results include audio attributes (`bpm`, `energy`, `key`, `mode`, `danceability`, `valence`) when available, left-joined from `song_attributes`. If multiple sources exist for a song, the `soundcharts` row is preferred.

**POST songs** adds the song to `sim_style_songs` with no class assignment (lands as Uncategorized). Returns `409` if song already in style.

**GET attributes** returns a batch of full attribute records for the given `library_song_id` list.

**POST enrich** fetches audio attributes from Soundcharts for songs not yet in `song_attributes`. Uses a 2-step lookup: ISRC → UUID, then UUID → full metadata. Processes up to `limit` songs with a 200ms delay between requests to respect rate limits. Optionally scoped to a specific style via `style_name`.

```json
// POST /v1/songs/enrich response
{
  "enriched": 87,
  "skipped": 6,
  "errors": 0,
  "total": 93
}
```

Requires `supabase-migration-song-attributes.sql` and `SOUNDCHARTS_APP_ID` / `SOUNDCHARTS_API_KEY` env vars.

---

### Spotify Sync
```
POST   /v1/spotify/register-sync   body: { playlist_url, style_id }
POST   /v1/spotify/run-sync        body: { playlist_id? }   (omit playlist_id to run all)
GET    /v1/spotify/syncs
DELETE /v1/spotify/syncs/:playlistId
```

**register-sync** — Links a Spotify collaborative playlist to a style. Stores the relationship in `playlist_syncs`. Safe to call again on an existing playlist (upserts).

**run-sync** — Fetches the current playlist from Spotify, matches tracks against the library, adds new matches to the style, and removes tracks that were deleted from the playlist. If `playlist_id` is omitted, runs all registered syncs. Returns per-sync results including `added`, `removed`, `unmatched`, `total_tracks`, and `unmatched_tracks` (full title/artist list).

Matching uses a 4-tier strategy:
1. Spotify track ID (exact, highest confidence)
2. Normalized title + artist (lowercased, accents stripped, punctuation removed)
3. Aggressive normalization (feat/remix/leading "the" stripped)
4. Fuzzy prefix match for feat/remix variants

**Cron:** `.github/workflows/nightly-sync.yml` calls `run-sync` at 3am UTC nightly via GitHub Actions.

Requires `supabase-migration-playlist-syncs.sql` and Spotify env vars to be set.


---

### Acquisition Queue
```
GET    /v1/acquisition              ?status=want|purchased|in_library
POST   /v1/acquisition              body: { title, artist, isrc?, playlist_name?, source?, notes? }
PATCH  /v1/acquisition/:id          body: { status?, source?, notes? }
DELETE /v1/acquisition/:id
```

Tracks songs flagged for purchase from Spotchecker sessions. Songs are added via the 🛒 Want button on unmatched rows. Duplicate detection prevents the same title+artist being added twice while still in `want` or `purchased` status.

Valid `status` values: `want` · `purchased` · `in_library`  
Valid `source` values: `itunes` · `amazon` · `ilm` · `serviced`

Requires `opus_acquisition_queue` table (run migration SQL).

---

### Spotify Auth (one-time setup)
```
GET /v1/spotify/auth       # redirects to Spotify OAuth — visit in browser once
GET /v1/spotify/callback   # exchanges code for tokens — copy refresh token to env vars
GET /v1/spotify/me         # verify authenticated user
```

These are used once during initial Spotify setup. `/auth` and `/callback` skip the `x-api-key` check.

---

## Error Format

All errors return:
```json
{ "error": { "message": "Description", "status": 400 } }
```

Common codes: `400` bad request · `401` unauthorized · `409` conflict · `500` server error

---

## Adding a New Route

1. Create `src/routes/myRoute.js`:
```js
import { supabase, assertNoError } from '../supabase.js';
import { normalizeStyleId } from '../normalize.js';

export default async function routes(app) {
  app.get('/my-endpoint', async (req, reply) => {
    const { data, error } = await supabase.from('my_table').select('*');
    assertNoError(error, 'Failed to fetch');
    return reply.send({ data });
  });
}
```

2. Register in `server.js`:
```js
import myRoutes from './src/routes/myRoute.js';
await app.register(myRoutes, { prefix: '/v1' });
```

3. Add client method to `frontend/api-client.js`:
```js
OpusAPIClient.prototype.myMethod = async function() {
  const { data } = await this.request('/my-endpoint');
  return data;
};
```
