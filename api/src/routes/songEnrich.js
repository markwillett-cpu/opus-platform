import { supabase, assertNoError } from '../supabase.js';
import { config } from '../config.js';

const SOUNDCHARTS_APP_ID = config.SOUNDCHARTS_APP_ID;
const SOUNDCHARTS_API_KEY = config.SOUNDCHARTS_API_KEY;
const SOUNDCHARTS_BASE = 'https://customer.api.soundcharts.com';

async function soundchartsGet(path) {
  const res = await fetch(`${SOUNDCHARTS_BASE}${path}`, {
    headers: {
      'x-app-id': SOUNDCHARTS_APP_ID,
      'x-api-key': SOUNDCHARTS_API_KEY
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Soundcharts error ${res.status}: ${text}`);
  }
  return res.json();
}

async function enrichSong(song) {
  const isrc = (song.isrc || '').toUpperCase();
  if (!isrc) return { id: song.id, ok: false, reason: 'no_isrc' };

  // Step 1: ISRC → Soundcharts UUID
  let uuid;
  try {
    const lookup = await soundchartsGet(`/api/v2.25/song/by-isrc/${isrc}`);
    uuid = lookup?.object?.uuid;
    if (!uuid) return { id: song.id, ok: false, reason: 'not_found' };
  } catch(err) {
    return { id: song.id, ok: false, reason: err.message };
  }

  // Step 2: UUID → full metadata + audio features
  let data;
  try {
    const detail = await soundchartsGet(`/api/v2.25/song/${uuid}`);
    data = detail?.object;
    if (!data) return { id: song.id, ok: false, reason: 'no_data' };
  } catch(err) {
    return { id: song.id, ok: false, reason: err.message };
  }

  const audio = data.audio || {};
  const genres = (data.genres || []).map(g => g.root);

  // Upsert into song_attributes
  const { error } = await supabase
    .from('song_attributes')
    .upsert({
      library_song_id: song.id,
      source: 'soundcharts',
      bpm: audio.tempo ?? null,
      key: audio.key !== undefined ? String(audio.key) : null,
      mode: audio.mode === 1 ? 'major' : audio.mode === 0 ? 'minor' : null,
      energy: audio.energy ?? null,
      danceability: audio.danceability ?? null,
      valence: audio.valence ?? null,
      acousticness: audio.acousticness ?? null,
      instrumentalness: audio.instrumentalness ?? null,
      speechiness: audio.speechiness ?? null,
      loudness: audio.loudness ?? null,
      duration_seconds: data.duration ?? null,
      time_signature: audio.timeSignature ?? null,
      raw: data,
      fetched_at: new Date().toISOString()
    }, { onConflict: 'library_song_id,source' });

  if (error) return { id: song.id, ok: false, reason: error.message };

  return {
    id: song.id,
    ok: true,
    title: song.title,
    artist: song.artist,
    bpm: audio.tempo,
    energy: audio.energy,
    genres
  };
}

export default async function routes(app) {

  /**
   * GET /v1/songs/enriched/count
   * Returns the total number of enriched songs (soundcharts source, bpm not null).
   * Used by the Style Builder to know how many pages to expect before loading.
   */
  app.get('/songs/enriched/count', async (req, reply) => {
    const { count, error } = await supabase
      .from('song_attributes')
      .select('*', { count: 'exact', head: true })
      .eq('source', 'soundcharts')
      .not('bpm', 'is', null);

    assertNoError(error, 'Failed to count enriched songs');

    return reply.send({ count: count ?? 0 });
  });

  /**
   * GET /v1/songs/attributes?ids=uuid1,uuid2,...
   * Returns song_attributes rows for the given library_song_ids.
   * Used by the frontend to load audio metadata for a style's tracks.
   */
  app.get('/songs/attributes', async (req, reply) => {
    const raw = req.query?.ids || '';
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);

    if (ids.length === 0) {
      return reply.send([]);
    }

    const { data, error } = await supabase
      .from('song_attributes')
      .select('*')
      .in('library_song_id', ids)
      .eq('source', 'soundcharts');

    assertNoError(error, 'Failed to fetch song attributes');

    return reply.send(data || []);
  });

  /**
   * GET /v1/songs/enriched?limit=1000&offset=0
   * Returns all library songs that have audio attributes, paginated.
   * Used by the Style Builder to load the full enriched library client-side.
   *
   * Response shape per song:
   *   { library_song_id, title, artist, bpm, energy, danceability, valence,
   *     acousticness, key, mode, genres[] }
   *
   * genres is extracted from raw->genres in song_attributes.
   * Only returns soundcharts-sourced rows. Requires bpm to be non-null.
   */
  app.get('/songs/enriched', async (req, reply) => {
    const limit  = Math.min(parseInt(req.query.limit)  || 1000, 2000);
    const offset = parseInt(req.query.offset) || 0;

    const { data, error } = await supabase
      .from('song_attributes')
      .select(`
        library_song_id,
        bpm,
        energy,
        danceability,
        valence,
        acousticness,
        key,
        mode,
        raw,
        library_songs!inner(title, artist)
      `)
      .eq('source', 'soundcharts')
      .not('bpm', 'is', null)
      .order('library_song_id')
      .range(offset, offset + limit - 1);

    assertNoError(error, 'Failed to fetch enriched songs');

    const results = (data || []).map(row => {
      // Extract genres from raw jsonb — stored as [{ root, ... }]
      let genres = [];
      try {
        const rawObj = typeof row.raw === 'string' ? JSON.parse(row.raw) : row.raw;
        genres = (rawObj?.genres || [])
          .map(g => (typeof g === 'string' ? g : g.root || g.name || g.slug))
          .filter(Boolean);
      } catch { /* leave genres empty */ }

      return {
        library_song_id: row.library_song_id,
        title:           row.library_songs?.title  ?? '',
        artist:          row.library_songs?.artist ?? '',
        bpm:             row.bpm,
        energy:          row.energy,
        danceability:    row.danceability,
        valence:         row.valence,
        acousticness:    row.acousticness,
        key:             row.key,
        mode:            row.mode,
        genres,
      };
    });

    return reply.send({
      data:   results,
      total:  results.length,
      offset,
      limit,
    });
  });

  /**
   * POST /v1/songs/enrich
   * Enriches a batch of songs from library_songs with audio attributes from Soundcharts.
   * Body (optional): { limit: 100, offset: 0, style_name?: string }
   * Fetches songs with ISRC, looks up Soundcharts, upserts into song_attributes.
   */
  app.post('/songs/enrich', async (req, reply) => {
    const limit  = Math.min(req.body?.limit  ?? 100, 200); // cap at 200
    const offset = req.body?.offset ?? 0;

    // Get IDs already enriched from soundcharts
    const { data: alreadyEnriched } = await supabase
      .from('song_attributes')
      .select('library_song_id')
      .eq('source', 'soundcharts');

    const enrichedIds = (alreadyEnriched || []).map(r => r.library_song_id);

    // Fetch songs — optionally filtered by style name
    let query = supabase
      .from('library_songs')
      .select(`
        id, title, artist, isrc,
        sim_style_songs!inner(
          sim_styles!inner(name)
        )
      `)
      .not('isrc', 'is', null);

    if (enrichedIds.length > 0) {
      query = query.not('id', 'in', `(${enrichedIds.map(id => `"${id}"`).join(',')})`);
    }

    if (req.body?.style_name) {
      query = query.eq('sim_style_songs.sim_styles.name', req.body.style_name);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: songs, error } = await query;

    assertNoError(error, 'Failed to fetch songs for enrichment');

    if (!songs || songs.length === 0) {
      return reply.send({ ok: true, message: 'No songs left to enrich', enriched: 0 });
    }

    const results = [];
    for (const song of songs) {
      const result = await enrichSong(song);
      results.push(result);
      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 200));
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed    = results.filter(r => !r.ok).length;

    return reply.send({
      ok: true,
      total: songs.length,
      enriched: succeeded,
      failed,
      results
    });
  });

}
