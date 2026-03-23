import { supabase, assertNoError } from '../supabase.js';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────
// Spotify helpers
// ─────────────────────────────────────────────────────────

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.SPOTIFY_REFRESH_TOKEN
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed: ${text}`);
  }

  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _cachedToken;
}

async function spotifyGet(path, token) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${text}`);
  }
  return res.json();
}

function extractPlaylistId(input) {
  const match = input.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : input.trim();
}

// Pull all tracks from a playlist (handles pagination)
// Compatible with both pre- and post-February 2026 Spotify API.
// external_ids (ISRC) removed in new API — omitted from fields request.
async function fetchAllPlaylistTracks(playlistId, token, maxTracks = Infinity) {
  const tracks = [];
  let url = `/playlists/${playlistId}/items?limit=100`;

  while (url) {
    const data = await spotifyGet(url, token);
    const items = data.items || [];
    for (const item of items) {
      const track = item.item;
      if (track && track.id) tracks.push(track);
      if (tracks.length >= maxTracks) return tracks;
    }
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return tracks;
}

// ─────────────────────────────────────────────────────────
// Matching logic
// ─────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function matchTracks(spotifyTracks) {
  const matched = [];
  const unmatched = [];

  const spotifyIds = spotifyTracks.map(t => t.id).filter(Boolean);

  // Tier 1: Bulk fetch by Spotify ID
  const { data: spotifyMatches } = await supabase
    .from('library_songs')
    .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
    .in('spotify_track_id', spotifyIds);

  const spotifyIdMap = new Map((spotifyMatches || []).map(s => [s.spotify_track_id, s]));

  for (const track of spotifyTracks) {
    const artistName = track.artists?.[0]?.name || '';

    // Tier 1: Spotify ID
    if (spotifyIdMap.has(track.id)) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName },
        library: spotifyIdMap.get(track.id),
        match_method: 'spotify_id',
        confidence: 0.95
      });
      continue;
    }

    const normTitle = normalize(track.name);
    const normArtist = normalize(artistName);

    const aggTitle = normalize(track.name)
      .replace(/\(.*?\)/g, '')
      .replace(/feat.*/i, '')
      .replace(/\s(radio edit|edit version|single version|remaster|remastered|live version|acoustic version|album version|original mix|extended mix|explicit version|clean version|deluxe edition|bonus track)(\s.*)?$/i, '')
      .replace(/^the\s+/i, '')
      .trim();
    const aggArtist = normalize(artistName)
      .replace(/^the\s+/i, '')
      .trim();

    // Tier 2: Exact title_norm + artist_norm
    const { data: exactMatches } = await supabase
      .from('library_songs')
      .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
      .eq('title_norm', normTitle)
      .eq('artist_norm', normArtist)
      .limit(1);

    if (exactMatches && exactMatches.length > 0) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName },
        library: exactMatches[0],
        match_method: 'exact_norm',
        confidence: 0.9
      });
      continue;
    }

    // Tier 3: Exact title_aggressive + artist_aggressive (try with and without leading "the")
    const aggTitlesToTry = [aggTitle, `the ${aggTitle}`];

    let aggExactMatch = null;
    for (const t of aggTitlesToTry) {
      const { data } = await supabase
        .from('library_songs')
        .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
        .eq('title_aggressive', t)
        .eq('artist_aggressive', aggArtist)
        .limit(1);
      if (data && data.length > 0) { aggExactMatch = data[0]; break; }
    }

    if (aggExactMatch) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName },
        library: aggExactMatch,
        match_method: 'exact_aggressive',
        confidence: 0.85
      });
      continue;
    }

    // Tier 4: feat/remix fuzzy — library title starts with spotify title + qualifier
    const featPattern = /^(feat|ft|featuring|remix|remaster|version|live|acoustic|radio edit)/i;

    const { data: fuzzyMatches } = await supabase
      .from('library_songs')
      .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
      .ilike('title_aggressive', `${aggTitle}%`)
      .ilike('artist_aggressive', `${aggArtist}%`)
      .limit(5);

    if (fuzzyMatches && fuzzyMatches.length > 0) {
      const best = fuzzyMatches.find(m => {
        const libAgg = (m.title_aggressive || '').toLowerCase();
        const spotAgg = aggTitle.toLowerCase();

        if (libAgg === spotAgg) return true;

        if (libAgg.startsWith(spotAgg)) {
          const extra = libAgg.slice(spotAgg.length).trim();
          return featPattern.test(extra);
        }

        if (spotAgg.startsWith(libAgg)) {
          const extra = spotAgg.slice(libAgg.length).trim();
          return featPattern.test(extra);
        }

        return false;
      });

      if (best) {
        matched.push({
          spotify: { id: track.id, title: track.name, artist: artistName },
          library: best,
          match_method: 'fuzzy_feat',
          confidence: 0.75
        });
        continue;
      }
    }

    // No match
    unmatched.push({
      spotify: { id: track.id, title: track.name, artist: artistName },
      match_method: null,
      confidence: 0
    });
  }

  return { matched, unmatched };
}

// ─────────────────────────────────────────────────────────
// Sync logic
// ─────────────────────────────────────────────────────────

/**
 * Core sync function — fetches the playlist, matches tracks, and reconciles
 * additions and removals against the style. Called by both sync endpoints.
 */
async function runSync(syncRecord) {
  const token = await getAccessToken();
  const tracks = await fetchAllPlaylistTracks(syncRecord.playlist_id, token);
  const { matched, unmatched } = await matchTracks(tracks);

  const incomingLibraryIds = new Set(matched.map(m => m.library.id));

  // Fetch songs currently in this style
  const { data: currentSongs } = await supabase
    .from('sim_style_songs')
    .select('library_song_id')
    .eq('style_id', syncRecord.style_id);

  const currentIds = new Set((currentSongs || []).map(r => r.library_song_id));

  // Songs to add — in playlist now, not yet in style
  const toAdd = [...incomingLibraryIds].filter(id => !currentIds.has(id));

  // Songs to remove — in style but no longer in playlist
  const toRemove = [...currentIds].filter(id => !incomingLibraryIds.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map(library_song_id => ({
      style_id: syncRecord.style_id,
      library_song_id
    }));
    const { error } = await supabase.from('sim_style_songs').insert(rows);
    assertNoError(error, 'Failed to add songs during sync');
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('sim_style_songs')
      .delete()
      .eq('style_id', syncRecord.style_id)
      .in('library_song_id', toRemove);
    assertNoError(error, 'Failed to remove songs during sync');
  }

  // Update sync metadata
  await supabase
    .from('playlist_syncs')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_added: toAdd.length,
      last_sync_removed: toRemove.length,
      last_sync_unmatched: unmatched.length,
      updated_at: new Date().toISOString()
    })
    .eq('id', syncRecord.id);

  return {
    added: toAdd.length,
    removed: toRemove.length,
    unmatched: unmatched.length,
    unmatched_tracks: unmatched,
    total_tracks: tracks.length
  };
}

// ─────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────

export default async function routes(app) {

  /**
   * GET /v1/spotify/me
   * Returns the authenticated Spotify user's profile.
   */
  app.get('/spotify/me', async (req, reply) => {
    const token = await getAccessToken();
    const me = await spotifyGet('/me', token);
    return reply.send({ id: me.id, display_name: me.display_name, email: me.email });
  });

  /**
   * GET /v1/spotify/auth
   * One-time OAuth setup — redirects to Spotify login.
   * Visit in browser once to get a refresh token, then save to SPOTIFY_REFRESH_TOKEN env var.
   */
  app.get('/spotify/auth', { config: { skipAuth: true } }, async (req, reply) => {
    const scopes = [
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-private',
      'playlist-modify-public'
    ].join(' ');

    const params = new URLSearchParams({
      client_id: config.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: `${config.API_BASE_URL}/v1/spotify/callback`,
      scope: scopes,
      show_dialog: 'true'
    });

    return reply.redirect(`https://accounts.spotify.com/authorize?${params}`);
  });

/**
 * GET /v1/spotify/search?q=...&limit=8
 * Track search — used by library.html Add Track flow
 */
app.get('/spotify/search', async (req, reply) => {
  const { q, limit = 8 } = req.query;
  if (!q) return reply.code(400).send({ error: 'q is required' });

  const token = await getAccessToken();
  const data = await spotifyGet(
    `/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}&market=US`,
    token
  );
  return reply.send(data);
});
  
  /**
   * GET /v1/spotify/callback
   * Spotify redirects here after login.
   * Exchanges code for tokens and displays the refresh token.
   */
  app.get('/spotify/callback', { config: { skipAuth: true } }, async (req, reply) => {
    const { code, error } = req.query;

    if (error) {
      return reply.send({ error: `Spotify auth error: ${error}` });
    }

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${config.API_BASE_URL}/v1/spotify/callback`
      })
    });

    const data = await res.json();

    if (data.error) {
      return reply.send({ error: data.error, description: data.error_description });
    }

    return reply.type('text/html').send(`
      <html><body style="font-family:monospace;padding:40px;background:#1a1a1a;color:#fff">
        <h2 style="color:#1db954">✓ Spotify Auth Successful</h2>
        <p>Copy this refresh token and add it as <strong>SPOTIFY_REFRESH_TOKEN</strong> in your Render env vars:</p>
        <textarea style="width:100%;height:80px;background:#2a2a2a;color:#1db954;padding:12px;border:1px solid #333;font-size:13px;margin-top:10px">${data.refresh_token}</textarea>
        <p style="margin-top:20px;color:#888">Also add <strong>SPOTIFY_TARGET_USER_ID</strong> — your Spotify username.</p>
        <p style="color:#888">Access token expires in ${data.expires_in}s. The refresh token does not expire.</p>
      </body></html>
    `);
  });

  /**
   * POST /v1/spotify/match-playlist
   * Matches a Spotify playlist against the library.
   * Body: { playlist_url }
   */
  app.post('/spotify/match-playlist', async (req, reply) => {
    const { playlist_url } = req.body || {};

    if (!playlist_url) {
      return reply.code(400).send({ error: { message: 'playlist_url is required', status: 400 } });
    }

    if (!config.SPOTIFY_CLIENT_ID || !config.SPOTIFY_CLIENT_SECRET || !config.SPOTIFY_REFRESH_TOKEN) {
      return reply.code(503).send({ error: { message: 'Spotify credentials not configured on server', status: 503 } });
    }

    const playlistId = extractPlaylistId(playlist_url);
    if (!playlistId) {
      return reply.code(400).send({ error: { message: 'Could not extract playlist ID from URL', status: 400 } });
    }

    const token = await getAccessToken();
    const playlistMeta = await spotifyGet(`/playlists/${playlistId}?fields=name,owner,tracks.total`, token);

    const CAP = 500;
    const totalTracks = playlistMeta.tracks?.total || 0;
    const wasCapped = totalTracks > CAP;
    const tracks = await fetchAllPlaylistTracks(playlistId, token, CAP);
    const { matched, unmatched } = await matchTracks(tracks);

    const total = tracks.length;
    const matchRate = total > 0 ? Math.round((matched.length / total) * 100) : 0;

    return reply.send({
      playlist: {
        id: playlistId,
        name: playlistMeta.name,
        owner: playlistMeta.owner?.display_name,
        total_tracks: total
      },
      summary: { total, matched: matched.length, unmatched: unmatched.length, match_rate: matchRate },
      matched,
      unmatched
    });
  });

  /**
   * POST /v1/spotify/add-to-style
   * Adds matched library songs to an existing style.
   * Body: { style_id, song_ids: ["uuid", ...] }
   */
  app.post('/spotify/add-to-style', async (req, reply) => {
    const { style_id, song_ids } = req.body || {};

    if (!style_id || !song_ids?.length) {
      return reply.code(400).send({ error: { message: 'style_id and song_ids are required', status: 400 } });
    }

    const { data: existing } = await supabase
      .from('sim_style_songs')
      .select('library_song_id')
      .eq('style_id', style_id)
      .in('library_song_id', song_ids);

    const existingIds = new Set((existing || []).map(r => r.library_song_id));
    const toInsert = song_ids.filter(id => !existingIds.has(id));

    if (toInsert.length === 0) {
      return reply.send({ ok: true, added: 0, skipped: song_ids.length });
    }

    const rows = toInsert.map(library_song_id => ({ style_id, library_song_id }));
    const { error } = await supabase.from('sim_style_songs').insert(rows);
    assertNoError(error, 'Failed to add songs to style');

    return reply.send({ ok: true, added: toInsert.length, skipped: existingIds.size });
  });

  /**
   * POST /v1/spotify/create-style
   * Creates a new style and adds matched songs to it.
   * Body: { name, song_ids: ["uuid", ...] }
   */
  app.post('/spotify/create-style', async (req, reply) => {
    const { name, song_ids } = req.body || {};

    if (!name || !song_ids?.length) {
      return reply.code(400).send({ error: { message: 'name and song_ids are required', status: 400 } });
    }

    const { data: style, error: styleError } = await supabase
      .from('sim_styles')
      .insert({ name })
      .select('id, name')
      .single();

    assertNoError(styleError, 'Failed to create style');

    const rows = song_ids.map(library_song_id => ({ style_id: style.id, library_song_id }));
    const { error: songsError } = await supabase.from('sim_style_songs').insert(rows);
    assertNoError(songsError, 'Failed to add songs to new style');

    return reply.code(201).send({ ok: true, style, added: song_ids.length });
  });

  /**
   * POST /v1/spotify/register-sync
   * Registers a Spotify playlist to sync with a style.
   * Body: { playlist_url, style_id }
   */
  app.post('/spotify/register-sync', async (req, reply) => {
    const { playlist_url, style_id } = req.body || {};

    if (!playlist_url || !style_id) {
      return reply.code(400).send({ error: { message: 'playlist_url and style_id are required', status: 400 } });
    }

    const playlistId = extractPlaylistId(playlist_url);
    if (!playlistId) {
      return reply.code(400).send({ error: { message: 'Could not extract playlist ID from URL', status: 400 } });
    }

    const token = await getAccessToken();
    const playlistMeta = await spotifyGet(`/playlists/${playlistId}?fields=name,owner`, token);

    const { data, error } = await supabase
      .from('playlist_syncs')
      .upsert({
        playlist_id: playlistId,
        playlist_name: playlistMeta.name,
        style_id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'playlist_id' })
      .select('id, playlist_id, playlist_name, style_id, created_at')
      .single();

    assertNoError(error, 'Failed to register playlist sync');

    return reply.code(201).send({ ok: true, sync: data });
  });

  /**
   * POST /v1/spotify/run-sync
   * Runs a sync for one playlist, or all registered playlists if no playlist_id given.
   * Body (optional): { playlist_id }
   * Called manually or by the nightly Render cron job.
   */
  app.post('/spotify/run-sync', async (req, reply) => {
    const { playlist_id } = req.body || {};

    let query = supabase.from('playlist_syncs').select('*');
    if (playlist_id) query = query.eq('playlist_id', playlist_id);

    const { data: syncs, error } = await query;
    assertNoError(error, 'Failed to fetch playlist syncs');

    if (!syncs || syncs.length === 0) {
      return reply.code(404).send({ error: { message: 'No matching playlist syncs found', status: 404 } });
    }

    const results = [];
    for (const sync of syncs) {
      try {
        const result = await runSync(sync);
        results.push({ playlist_id: sync.playlist_id, playlist_name: sync.playlist_name, ok: true, ...result });
      } catch (err) {
        results.push({ playlist_id: sync.playlist_id, playlist_name: sync.playlist_name, ok: false, error: err.message });
      }
    }

    return reply.send({ ok: true, synced: results.length, results });
  });
  /**
   * GET /v1/spotify/test-audio-features/:trackId
   * Temporary — tests whether Spotify audio features API is still accessible.
   */
  app.get('/spotify/test-audio-features/:trackId', async (req, reply) => {
    const token = await getAccessToken();
    const data = await spotifyGet(`/audio-features/${req.params.trackId}`, token);
    return reply.send(data);
  });



/**
   * POST /v1/spotify/find-style
   * Matches a Spotify playlist against the library in bulk, then tallies which
   * styles the matched songs belong to. Uses batched queries instead of per-song
   * lookups so it handles 1000+ track playlists efficiently.
   * Body: { playlist_url }
   */
  app.post('/spotify/find-style', async (req, reply) => {
    const { playlist_url } = req.body || {};
    if (!playlist_url) {
      return reply.code(400).send({ error: { message: 'playlist_url is required', status: 400 } });
    }

    const playlistId = extractPlaylistId(playlist_url);
    if (!playlistId) {
      return reply.code(400).send({ error: { message: 'Could not extract playlist ID from URL', status: 400 } });
    }

    const token = await getAccessToken();
    const playlistMeta = await spotifyGet(`/playlists/${playlistId}?fields=name,owner,tracks.total`, token);
    const totalTracks = playlistMeta.tracks?.total || 0;

    // Cap at 500 tracks — enough for an accurate style fingerprint, avoids timeout
    const TRACK_CAP = 500;
    const tracks = await fetchAllPlaylistTracks(playlistId, token, TRACK_CAP);
    const wasCapped = totalTracks > TRACK_CAP;

    // ── Batched matching (optimised for large playlists) ──────────────────
    // Pre-compute normalised keys for every playlist track
    const featPattern = /^(feat|ft|featuring|remix|remaster|version|live|acoustic|radio edit)/i;

    const prepared = tracks.map(t => {
      const artistName = t.artists?.[0]?.name || '';
      const normTitle  = normalize(t.name);
      const normArtist = normalize(artistName);
      const aggTitle   = normTitle.replace(/\(.*?\)/g, '').replace(/feat.*/i, '').replace(/\s(radio edit|edit version|single version|remaster|remastered|live version|acoustic version|album version|original mix|extended mix|explicit version|clean version|deluxe edition|bonus track)(\s.*)?$/i, '').replace(/^the\s+/i, '').trim();
      const aggArtist  = normArtist.replace(/^the\s+/i, '').trim();
      return { track: t, artistName, normTitle, normArtist, aggTitle, aggArtist };
    });

    const matchedIds = new Set();
    const CHUNK = 500; // Supabase IN clause limit

    // Tier 1: Spotify ID bulk lookup
    const spotifyIds = tracks.map(t => t.id).filter(Boolean);
    for (let i = 0; i < spotifyIds.length; i += CHUNK) {
      const chunk = spotifyIds.slice(i, i + CHUNK);
      const { data } = await supabase
        .from('library_songs')
        .select('id, spotify_track_id')
        .in('spotify_track_id', chunk);
      (data || []).forEach(r => matchedIds.add(r.id));
    }

    // Tier 2: Bulk title_norm + artist_norm
    // Build unique norm pairs for unmatched tracks
    const unmatchedAfterT1 = prepared.filter(p => !matchedIds.has(p.track.id));
    const normPairs = [...new Set(unmatchedAfterT1.map(p => `${p.normTitle}|||${p.normArtist}`))];

    for (let i = 0; i < normPairs.length; i += CHUNK) {
      const chunk = normPairs.slice(i, i + CHUNK);
      // Fetch all library songs whose title_norm appears in any of these pairs
      const titleNorms  = [...new Set(chunk.map(p => p.split('|||')[0]))];
      const artistNorms = [...new Set(chunk.map(p => p.split('|||')[1]))];
      const { data } = await supabase
        .from('library_songs')
        .select('id, title_norm, artist_norm')
        .in('title_norm',  titleNorms)
        .in('artist_norm', artistNorms);

      // Match in memory — only count exact pairs
      const libMap = new Map();
      (data || []).forEach(r => libMap.set(`${r.title_norm}|||${r.artist_norm}`, r.id));
      chunk.forEach(pair => {
        const id = libMap.get(pair);
        if (id) matchedIds.add(id);
      });
    }

    // Tier 3: Aggressive normalization bulk
    const unmatchedAfterT2 = prepared.filter(p => !matchedIds.has(p.track.id));
    const aggPairs = [...new Set(unmatchedAfterT2.flatMap(p =>
      [p.aggTitle, `the ${p.aggTitle}`].map(t => `${t}|||${p.aggArtist}`)
    ))];

    for (let i = 0; i < aggPairs.length; i += CHUNK) {
      const chunk = aggPairs.slice(i, i + CHUNK);
      const aggTitles  = [...new Set(chunk.map(p => p.split('|||')[0]))];
      const aggArtists = [...new Set(chunk.map(p => p.split('|||')[1]))];
      const { data } = await supabase
        .from('library_songs')
        .select('id, title_aggressive, artist_aggressive')
        .in('title_aggressive', aggTitles)
        .in('artist_aggressive', aggArtists);

      const libMap = new Map();
      (data || []).forEach(r => libMap.set(`${r.title_aggressive}|||${r.artist_aggressive}`, r.id));
      chunk.forEach(pair => {
        const id = libMap.get(pair);
        if (id) matchedIds.add(id);
      });
    }

    // Tier 4: Feat/remix prefix — only for remaining unmatched (usually a small set)
    const unmatchedAfterT3 = prepared.filter(p => !matchedIds.has(p.track.id));
    for (const p of unmatchedAfterT3) {
      if (!p.aggTitle) continue;
      const { data } = await supabase
        .from('library_songs')
        .select('id, title_aggressive')
        .ilike('title_aggressive', `${p.aggTitle}%`)
        .ilike('artist_aggressive', `${p.aggArtist}%`)
        .limit(5);

      const best = (data || []).find(m => {
        const libAgg  = (m.title_aggressive || '').toLowerCase();
        const spotAgg = p.aggTitle.toLowerCase();
        if (libAgg === spotAgg) return true;
        if (libAgg.startsWith(spotAgg))  return featPattern.test(libAgg.slice(spotAgg.length).trim());
        if (spotAgg.startsWith(libAgg))  return featPattern.test(spotAgg.slice(libAgg.length).trim());
        return false;
      });
      if (best) matchedIds.add(best.id);
    }

    if (!matchedIds.size) {
      return reply.send({
        playlist: { name: playlistMeta.name, total_tracks: totalTracks, analyzed_tracks: tracks.length, capped: wasCapped },
        matched_count: 0,
        style_matches: [],
        recommendation: null
      });
    }

    // Fetch all style memberships for matched library songs in bulk
    const libraryIdArray = [...matchedIds];
    let memberships = [];
    for (let i = 0; i < libraryIdArray.length; i += CHUNK) {
      const chunk = libraryIdArray.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('sim_style_songs')
        .select('library_song_id, style_id, sim_styles!inner(id, name)')
        .in('library_song_id', chunk);
      assertNoError(error, 'Failed to fetch style memberships');
      memberships = memberships.concat(data || []);
    }

    // Excluded styles
    const EXCLUDE = ['AA Remix'];

    // Tally overlap per style
    const styleCounts = {};
    const styleNames  = {};
    (memberships || []).forEach(row => {
      const name = row.sim_styles?.name;
      const id   = row.sim_styles?.id || row.style_id;
      if (!name || EXCLUDE.includes(name)) return;
      styleCounts[id] = (styleCounts[id] || 0) + 1;
      styleNames[id]  = name;
    });

    const total = matchedIds.size;
    const ranked = Object.entries(styleCounts)
      .map(([id, count]) => ({
        style_id:   id,
        style_name: styleNames[id],
        overlap:    count,
        score:      Math.round((count / total) * 100)
      }))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 10);

    // Blend vs single threshold: top style ≥60% = single match
    const BLEND_THRESHOLD = 60;
    const top = ranked[0];
    let recommendation;

    if (!top) {
      recommendation = null;
    } else if (top.score >= BLEND_THRESHOLD) {
      recommendation = { type: 'single', styles: [top] };
    } else {
      // Blend — take top styles until we've explained ≥70% of matches or hit 3
      const blend = [];
      let cumulative = 0;
      for (const s of ranked) {
        if (blend.length >= 3) break;
        blend.push(s);
        cumulative += s.score;
        if (cumulative >= 70) break;
      }
      recommendation = { type: 'blend', styles: blend };
    }

    return reply.send({
      playlist:      { name: playlistMeta.name, total_tracks: totalTracks, sampled: tracks.length, was_capped: wasCapped },
      matched_count: matchedIds.size,
      style_matches: ranked,
      recommendation
    });
  });

  /**
   * GET /v1/spotify/syncs
   * Returns all registered playlist syncs.
   */
  app.get('/spotify/syncs', async (req, reply) => {
    const { data, error } = await supabase
      .from('playlist_syncs')
      .select('*')
      .order('created_at', { ascending: false });

    assertNoError(error, 'Failed to fetch syncs');
    return reply.send({ data });
  });

  /**
   * DELETE /v1/spotify/syncs/:playlistId
   * Removes a registered sync. Does not affect songs already in the style.
   */
  app.delete('/spotify/syncs/:playlistId', async (req, reply) => {
    const { playlistId } = req.params;

    const { error } = await supabase
      .from('playlist_syncs')
      .delete()
      .eq('playlist_id', playlistId);

    assertNoError(error, 'Failed to remove sync');
    return reply.send({ ok: true });
  });
}
