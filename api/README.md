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
        ├── styles.js              # GET /v1/styles
        ├── styleTracks.js         # GET /v1/styles/:id/tracks
        ├── styleAssignments.js    # CRUD /v1/styles/:id/assignments
        ├── styleWeights.js        # CRUD /v1/styles/:id/weights
        ├── stylePlaybackProfile.js # GET /v1/styles/:id/playback-profile
        ├── curatorSchedules.js    # CRUD /v1/curator-schedules
        ├── styleMoods.js          # CRUD /v1/styles/:id/moods
        └── songSearch.js          # GET /v1/songs/search, POST /v1/styles/:id/songs
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
GET /v1/styles
```
Returns `{ data: [{ id, name }] }`.

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

### Song Search
```
GET  /v1/songs/search?q=petty+learning&limit=20
POST /v1/styles/:styleId/songs   body: { library_song_id: "uuid" }
```

Search splits the query into tokens — each token must match somewhere in `title` or `artist` (case-insensitive). So `"petty learning"` matches Tom Petty's "Learning to Fly".

`POST` adds the song to `sim_style_songs` with no class assignment (lands as Uncategorized). Returns `409` if song already in style.

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
