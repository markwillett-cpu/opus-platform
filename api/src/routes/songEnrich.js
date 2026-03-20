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

  /**
   * GET /v1/songs/by-isrc/:isrc
   * Look up a library song by ISRC and return its audio attributes.
   * Used by the DNA Compare page to resolve an ISRC to enriched features.
   */
  app.get('/songs/by-isrc/:isrc', async (req, reply) => {
    const isrc = (req.params.isrc || '').toUpperCase().trim();
    if (!isrc) return reply.code(400).send({ error: { message: 'ISRC required', status: 400 } });

    const { data: songs, error: songErr } = await supabase
      .from('library_songs')
      .select('id, title, artist, isrc')
      .ilike('isrc', isrc)
      .limit(1);

    assertNoError(songErr, 'Failed to look up song by ISRC');

    if (!songs || songs.length === 0) {
      return reply.code(404).send({ error: { message: 'Song not found', status: 404 } });
    }

    const song = songs[0];

    const { data: attrs, error: attrErr } = await supabase
      .from('song_attributes')
      .select('*')
      .eq('library_song_id', song.id)
      .eq('source', 'soundcharts')
      .maybeSingle();

    assertNoError(attrErr, 'Failed to fetch song attributes');

    if (!attrs) {
      return reply.code(404).send({ error: { message: 'Song found but not yet enriched', status: 404 } });
    }

    return reply.send({
      id:     song.id,
      title:  song.title,
      artist: song.artist,
      isrc:   song.isrc,
      features: {
        energy:           attrs.energy,
        valence:          attrs.valence,
        danceability:     attrs.danceability,
        acousticness:     attrs.acousticness,
        tempo:            attrs.bpm,
        loudness:         attrs.loudness,
        speechiness:      attrs.speechiness,
        liveness:         attrs.liveness,
        instrumentalness: attrs.instrumentalness,
        key:              attrs.key,
        mode:             attrs.mode,
        time_signature:   attrs.time_signature,
      }
    });
  });

  /**
   * GET /v1/songs/songstats/:isrc
   * Proxy to Songstats RapidAPI — works around CORS restriction.
   */
  app.get('/songs/songstats/:isrc', async (req, reply) => {
    const isrc = (req.params.isrc || '').toUpperCase().trim();
    if (!isrc) return reply.code(400).send({ error: { message: 'ISRC required', status: 400 } });

    const SS_KEY = config.SONGSTATS_RAPIDAPI_KEY;
    if (!SS_KEY) return reply.code(503).send({ error: { message: 'Songstats API key not configured', status: 503 } });

    const res = await fetch(`https://songstats.p.rapidapi.com/tracks/info?isrc=${encodeURIComponent(isrc)}`, {
      headers: {
        'x-rapidapi-host': 'songstats.p.rapidapi.com',
        'x-rapidapi-key': SS_KEY,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();
    if (!res.ok) return reply.code(res.status).send({ error: { message: data?.message || 'Songstats error', status: res.status } });

    return reply.send(data);
  });

  /**
   * GET /v1/soundcharts?path=/api/v2/...
   * Generic Soundcharts proxy for frontend pages (Charts page etc.)
   */
  app.get('/soundcharts', async (req, reply) => {
    const scPath = req.query.path;
    if (!scPath || !scPath.startsWith('/api/')) {
      return reply.code(400).send({ error: { message: 'path query param required (must start with /api/)', status: 400 } });
    }
    try {
      const data = await soundchartsGet(scPath);
      return reply.send(data);
    } catch (e) {
      const status = e.message.includes('404') ? 404 : 502;
      return reply.code(status).send({ error: { message: e.message, status } });
    }
  });

  /**
   * POST /v1/songs/match-csv
   * Matches a list of { title, artist } pairs against the library.
   * Uses the same fuzzy matching tiers as the Spotify matcher (tiers 2-4).
   * Body: { tracks: [{ title, artist }], name?: string }
   * Returns: { playlist, summary, matched, unmatched }
   */
  app.post('/songs/match-csv', async (req, reply) => {
    const { tracks, name } = req.body || {};
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return reply.code(400).send({ error: { message: 'tracks array is required', status: 400 } });
    }
    if (tracks.length > 2000) {
      return reply.code(400).send({ error: { message: 'Maximum 2000 tracks per request', status: 400 } });
    }

    function normalize(str) {
      return (str || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and')
        .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    const matched = [];
    const unmatched = [];

    for (const track of tracks) {
      const title  = (track.title  || '').trim();
      const artist = (track.artist || '').trim();
      if (!title) continue;

      const normTitle  = normalize(title);
      const normArtist = normalize(artist);
      const aggTitle   = normTitle
        .replace(/\(.*?\)/g, '').replace(/feat.*/i, '')
        .replace(/\s(radio edit|edit version|single version|remaster|remastered|live version|acoustic version|album version|original mix|extended mix|explicit version|clean version|deluxe edition|bonus track)(\s.*)?$/i, '')
        .replace(/^the\s+/i, '').trim();
      const aggArtist  = normalize(artist).replace(/^the\s+/i, '').trim();
      const spotifyEntry = { id: null, title, artist };

      // Tier 2: Exact title_norm + artist_norm
      const { data: exactMatches } = await supabase
        .from('library_songs').select('id, title, artist, album')
        .eq('title_norm', normTitle).eq('artist_norm', normArtist).limit(1);
      if (exactMatches?.length) {
        matched.push({ spotify: spotifyEntry, library: exactMatches[0], match_method: 'fuzzy_norm', confidence: 0.9 });
        continue;
      }

      // Tier 3: Aggressive normalization
      let aggMatch = null;
      for (const t of [aggTitle, `the ${aggTitle}`]) {
        const { data } = await supabase.from('library_songs').select('id, title, artist, album')
          .eq('title_aggressive', t).eq('artist_aggressive', aggArtist).limit(1);
        if (data?.length) { aggMatch = data[0]; break; }
      }
      if (aggMatch) {
        matched.push({ spotify: spotifyEntry, library: aggMatch, match_method: 'fuzzy_aggressive', confidence: 0.85 });
        continue;
      }

      // Tier 4: Feat/remix fuzzy prefix
      const featPattern = /^(feat|ft|featuring|remix|remaster|version|live|acoustic|radio edit)/i;
      const { data: fuzzyMatches } = await supabase.from('library_songs')
        .select('id, title, artist, album, title_aggressive')
        .ilike('title_aggressive', `${aggTitle}%`).ilike('artist_aggressive', `${aggArtist}%`).limit(5);
      if (fuzzyMatches?.length) {
        const best = fuzzyMatches.find(m => {
          const libAgg = (m.title_aggressive || '').toLowerCase();
          const spotAgg = aggTitle.toLowerCase();
          if (libAgg === spotAgg) return true;
          if (libAgg.startsWith(spotAgg)) return featPattern.test(libAgg.slice(spotAgg.length).trim());
          if (spotAgg.startsWith(libAgg)) return featPattern.test(spotAgg.slice(libAgg.length).trim());
          return false;
        });
        if (best) {
          matched.push({ spotify: spotifyEntry, library: best, match_method: 'fuzzy_feat', confidence: 0.75 });
          continue;
        }
      }

      unmatched.push({ spotify: spotifyEntry, match_method: null, confidence: 0 });
    }

    const total = tracks.length;
    const matchRate = total > 0 ? Math.round((matched.length / total) * 100) : 0;
    return reply.send({
      playlist: { id: null, name: name || 'CSV Import', owner: null, total_tracks: total },
      summary: { total, matched: matched.length, unmatched: unmatched.length, match_rate: matchRate },
      matched, unmatched
    });
  });


  /**
   * POST /v1/songs/check-isrcs
   * Body: { isrcs: string[] }
   * Returns: { results: { [isrc]: { inLibrary: bool, songId, title, artist } } }
   */
  app.post('/songs/check-isrcs', async (req, reply) => {
    const { isrcs } = req.body || {};
    if (!Array.isArray(isrcs) || !isrcs.length) {
      return reply.code(400).send({ error: { message: 'isrcs array required', status: 400 } });
    }
    const batch = isrcs.slice(0, 200).map(i => String(i).toUpperCase().trim());

    const { data, error } = await supabase
      .from('library_songs')
      .select('id, title, artist, isrc')
      .in('isrc', batch);

    assertNoError(error, 'Failed to check ISRCs');

    const found = {};
    for (const song of (data || [])) {
      found[song.isrc] = { inLibrary: true, songId: song.id, title: song.title, artist: song.artist };
    }

    const results = {};
    for (const isrc of batch) {
      results[isrc] = found[isrc] || { inLibrary: false, songId: null };
    }

    return reply.send({ results });
  });

  /**
   * POST /v1/songs/check-sc-uuids
   * Body: { sc_uuids: string[] }
   * Returns: { results: { [sc_uuid]: { inLibrary: bool, songId, title, artist, isrc } } }
   * Looks up Soundcharts song UUIDs stored in song_attributes.raw->>'uuid'
   */
  app.post('/songs/check-sc-uuids', async (req, reply) => {
    const { sc_uuids } = req.body || {};
    if (!Array.isArray(sc_uuids) || !sc_uuids.length) {
      return reply.code(400).send({ error: { message: 'sc_uuids array required', status: 400 } });
    }
    const batch = sc_uuids.slice(0, 200).map(u => String(u).trim());

    // song_attributes.raw contains the full Soundcharts response including uuid
    const { data, error } = await supabase
      .from('song_attributes')
      .select('library_song_id, raw')
      .eq('source', 'soundcharts')
      .in('raw->>uuid', batch);

    assertNoError(error, 'Failed to check SC UUIDs');

    // Also fetch song details for matched library_song_ids
    const songIds = (data || []).map(r => r.library_song_id);
    let songMap = {};
    if (songIds.length) {
      const { data: songs } = await supabase
        .from('library_songs')
        .select('id, title, artist, isrc')
        .in('id', songIds);
      for (const s of (songs || [])) {
        songMap[s.id] = s;
      }
    }

    const found = {};
    for (const row of (data || [])) {
      const scUuid = row.raw?.uuid;
      const song   = songMap[row.library_song_id];
      if (scUuid && song) {
        found[scUuid] = {
          inLibrary: true,
          songId:    song.id,
          title:     song.title,
          artist:    song.artist,
          isrc:      song.isrc,
        };
      }
    }

    const results = {};
    for (const uuid of batch) {
      results[uuid] = found[uuid] || { inLibrary: false, songId: null };
    }

    return reply.send({ results });
  });


  // ─────────────────────────────────────────────────────────
  // Acquisition Queue
  // ─────────────────────────────────────────────────────────

  /**
   * GET /v1/acquisition
   * Returns all items in the acquisition queue, newest first.
   * Optional ?status=want|purchased|in_library filter.
   */
  app.get('/acquisition', async (req, reply) => {
    let query = supabase
      .from('opus_acquisition_queue')
      .select('*')
      .order('created_at', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    assertNoError(error, 'Failed to fetch acquisition queue');
    return reply.send({ data: data || [] });
  });

  /**
   * POST /v1/acquisition
   * Add a song to the acquisition queue.
   * Body: { title, artist, isrc?, playlist_name?, source?, notes? }
   */
  app.post('/acquisition', async (req, reply) => {
    const { title, artist, isrc, playlist_name, source, notes } = req.body || {};
    if (!title || !artist) {
      return reply.code(400).send({ error: { message: 'title and artist are required', status: 400 } });
    }

    // Check for duplicate (same title+artist already in want or purchased)
    const { data: existing } = await supabase
      .from('opus_acquisition_queue')
      .select('id, status')
      .ilike('title', title)
      .ilike('artist', artist)
      .in('status', ['want', 'purchased'])
      .limit(1);

    if (existing?.length) {
      return reply.code(409).send({
        error: { message: 'Already in queue', status: 409 },
        existing: existing[0]
      });
    }

    const { data, error } = await supabase
      .from('opus_acquisition_queue')
      .insert({ title, artist, isrc: isrc || null, playlist_name: playlist_name || null, source: source || null, notes: notes || null, status: 'want' })
      .select('*')
      .single();

    assertNoError(error, 'Failed to add to acquisition queue');
    return reply.code(201).send({ ok: true, item: data });
  });

  /**
   * PATCH /v1/acquisition/:id
   * Update status, source, or notes on a queue item.
   * Body: { status?, source?, notes? }
   */
  app.patch('/acquisition/:id', async (req, reply) => {
    const { id } = req.params;
    const { status, source, notes } = req.body || {};
    const VALID_STATUSES = ['want', 'purchased', 'in_library'];
    const VALID_SOURCES  = ['itunes', 'amazon', 'ilm', 'serviced', 'explicit', ''];
    if (status && !VALID_STATUSES.includes(status)) {
      return reply.code(400).send({ error: { message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, status: 400 } });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (status  !== undefined) updates.status  = status;
    if (source  !== undefined) updates.source  = source;
    if (notes   !== undefined) updates.notes   = notes;

    const { data, error } = await supabase
      .from('opus_acquisition_queue')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    assertNoError(error, 'Failed to update acquisition item');
    return reply.send({ ok: true, item: data });
  });

  /**
   * DELETE /v1/acquisition/:id
   * Remove an item from the queue.
   */
  app.delete('/acquisition/:id', async (req, reply) => {
    const { id } = req.params;
    const { error } = await supabase
      .from('opus_acquisition_queue')
      .delete()
      .eq('id', id);
    assertNoError(error, 'Failed to delete acquisition item');
    return reply.send({ ok: true });
  });


}
