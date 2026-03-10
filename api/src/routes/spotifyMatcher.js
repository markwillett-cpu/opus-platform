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
  // Accept full URL or bare ID
  const match = input.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : input.trim();
}

// Pull all tracks from a playlist (handles pagination)
async function fetchAllPlaylistTracks(playlistId, token) {
  const tracks = [];
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,artists,album(name),duration_ms,external_ids))`;

  while (url) {
    const data = await spotifyGet(url, token);
    for (const item of (data.items || [])) {
      if (item.track && item.track.id) tracks.push(item.track);
    }
    // next is a full URL, strip the base
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return tracks;
}

// Copy a playlist to our account and return the new playlist ID
async function copyPlaylist(sourceId, sourceName, token) {
  const userId = config.SPOTIFY_TARGET_USER_ID;

  // Verify we're using the right user ID by fetching /me
  const me = await spotifyGet('/me', token);
  console.log(`[Spotify] Authenticated as: id="${me.id}" display_name="${me.display_name}"`);
  console.log(`[Spotify] SPOTIFY_TARGET_USER_ID env = "${userId}"`);

  // Use the actual authenticated user's ID, not the env var
  const actualUserId = me.id;

  // Create new playlist
  const created = await fetch(`https://api.spotify.com/v1/users/${actualUserId}/playlists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `[Opus Import] ${sourceName}`,
      public: false,
      description: `Copied from playlist ${sourceId} for Opus matching`
    })
  });

  if (!created.ok) throw new Error(`Failed to create playlist: ${await created.text()}`);
  const newPlaylist = await created.json();

  // Get all track URIs from source
  const tracks = await fetchAllPlaylistTracks(sourceId, token);
  const uris = tracks.map(t => `spotify:track:${t.id}`);

  // Add in batches of 100
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const added = await fetch(`https://api.spotify.com/v1/playlists/${newPlaylist.id}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: batch })
    });
    if (!added.ok) throw new Error(`Failed to add tracks: ${await added.text()}`);
  }

  return { newPlaylistId: newPlaylist.id, tracks };
}

// ─────────────────────────────────────────────────────────
// Matching logic
// ─────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function matchTracks(spotifyTracks) {
  const matched = [];
  const unmatched = [];

  // Collect all ISRCs and Spotify IDs for bulk queries
  const isrcs = spotifyTracks
    .map(t => t.external_ids?.isrc)
    .filter(Boolean)
    .map(i => i.toUpperCase());

  const spotifyIds = spotifyTracks.map(t => t.id).filter(Boolean);

  // Bulk fetch by ISRC
  const { data: isrcMatches } = await supabase
    .from('library_songs')
    .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
    .in('isrc', isrcs);

  const isrcMap = new Map((isrcMatches || []).map(s => [s.isrc?.toUpperCase(), s]));

  // Bulk fetch by Spotify track ID
  const { data: spotifyMatches } = await supabase
    .from('library_songs')
    .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
    .in('spotify_track_id', spotifyIds);

  const spotifyIdMap = new Map((spotifyMatches || []).map(s => [s.spotify_track_id, s]));

  // Match each track
  for (const track of spotifyTracks) {
    const artistName = track.artists?.[0]?.name || '';
    const isrc = track.external_ids?.isrc?.toUpperCase();

    // 1. ISRC match
    if (isrc && isrcMap.has(isrc)) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName, isrc },
        library: isrcMap.get(isrc),
        match_method: 'isrc',
        confidence: 1.0
      });
      continue;
    }

    // 2. Spotify track ID match
    if (spotifyIdMap.has(track.id)) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName, isrc },
        library: spotifyIdMap.get(track.id),
        match_method: 'spotify_id',
        confidence: 0.95
      });
      continue;
    }

    // 3. Fuzzy: artist_norm + title_norm
    const normTitle = normalize(track.name);
    const normArtist = normalize(artistName);

    const { data: fuzzyMatches } = await supabase
      .from('library_songs')
      .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
      .eq('title_norm', normTitle)
      .ilike('artist_norm', `%${normArtist.split(' ')[0]}%`)
      .limit(5);

    if (fuzzyMatches && fuzzyMatches.length > 0) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName, isrc },
        library: fuzzyMatches[0],
        match_method: 'fuzzy_norm',
        confidence: 0.8
      });
      continue;
    }

    // 4. Aggressive fuzzy: artist_aggressive + title_aggressive
    const aggTitle = normalize(track.name).replace(/\(.*?\)/g, '').replace(/feat.*/i, '').trim();
    const aggArtist = normalize(artistName).split(' ')[0];

    const { data: aggMatches } = await supabase
      .from('library_songs')
      .select('id, title, artist, album, spotify_track_id, isrc, artist_norm, title_norm, artist_aggressive, title_aggressive')
      .ilike('title_aggressive', `%${aggTitle}%`)
      .ilike('artist_aggressive', `%${aggArtist}%`)
      .limit(5);

    if (aggMatches && aggMatches.length > 0) {
      matched.push({
        spotify: { id: track.id, title: track.name, artist: artistName, isrc },
        library: aggMatches[0],
        match_method: 'fuzzy_aggressive',
        confidence: 0.6
      });
      continue;
    }

    // No match
    unmatched.push({
      spotify: { id: track.id, title: track.name, artist: artistName, isrc },
      match_method: null,
      confidence: 0
    });
  }

  return { matched, unmatched };
}

// ─────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────

export default async function routes(app) {

  /**
   * GET /v1/spotify/auth
   * Step 1 of one-time OAuth setup — redirects to Spotify login.
   * Visit this URL once in your browser to get a refresh token.
   */
  /**
   * GET /v1/spotify/me
   * Returns the authenticated Spotify user's profile — use this to find the correct user ID.
   * Temporary debug endpoint.
   */
  app.get('/spotify/me', async (req, reply) => {
    const token = await getAccessToken();
    const me = await spotifyGet('/me', token);
    return reply.send({ id: me.id, display_name: me.display_name, email: me.email });
  });

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
   * GET /v1/spotify/callback
   * Step 2 — Spotify redirects here after login.
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

    // Show the refresh token — copy this to SPOTIFY_REFRESH_TOKEN env var on Render
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
   * Main endpoint — matches a Spotify playlist against the library.
   * Body: { playlist_url: "https://open.spotify.com/playlist/..." }
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

    // Get playlist metadata
    const playlistMeta = await spotifyGet(`/playlists/${playlistId}?fields=name,owner,tracks(total)`, token);

    // Copy to our account and get tracks
    const { tracks } = await copyPlaylist(playlistId, playlistMeta.name, token);

    // Match against library
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
      summary: {
        total,
        matched: matched.length,
        unmatched: unmatched.length,
        match_rate: matchRate
      },
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

    // Filter out songs already in the style
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

    // Create the style
    const { data: style, error: styleError } = await supabase
      .from('sim_styles')
      .insert({ name })
      .select('id, name')
      .single();

    assertNoError(styleError, 'Failed to create style');

    // Add songs
    const rows = song_ids.map(library_song_id => ({ style_id: style.id, library_song_id }));
    const { error: songsError } = await supabase.from('sim_style_songs').insert(rows);
    assertNoError(songsError, 'Failed to add songs to new style');

    return reply.code(201).send({ ok: true, style, added: song_ids.length });
  });
}
