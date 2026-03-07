import { z } from 'zod';
import { supabase, assertNoError } from '../supabase.js';
import { normalizeStyleId } from '../normalize.js';

const AddSongBody = z.object({
  library_song_id: z.string().min(1)
});

export default async function routes(app) {

  /**
   * GET /v1/songs/search?q=petty+learning&limit=20
   * Fuzzy search across title + artist in library_songs.
   * Splits query into tokens and requires all tokens to match
   * somewhere across title+artist (case-insensitive).
   */
  app.get('/songs/search', async (req, reply) => {
    const q     = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!q) return reply.send({ data: [] });

    // Split into tokens — each token must appear in title or artist
    const tokens = q.split(/\s+/).filter(Boolean);

    // Build a Supabase query using ilike filters chained for each token
    // Each token must match title OR artist
    let query = supabase
      .from('library_songs')
      .select('id, title, artist, album, peak_year, run_time_seconds, styles')
      .limit(limit);

    tokens.forEach(token => {
      query = query.or(`title.ilike.%${token}%,artist.ilike.%${token}%`);
    });

    const { data, error } = await query.order('artist').order('title');

    assertNoError(error, 'Search failed');

    return reply.send({ data: data || [] });
  });

  /**
   * POST /v1/styles/:styleId/songs
   * Adds a song to a style (inserts into sim_style_songs).
   * Song lands as uncategorized — no class assignment.
   * Body: { library_song_id: "uuid" }
   */
  app.post('/styles/:styleId/songs', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const parsed = AddSongBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { message: parsed.error.message, status: 400 } });
      return;
    }

    const { library_song_id } = parsed.data;

    // Check song isn't already in style
    const { data: existing } = await supabase
      .from('sim_style_songs')
      .select('library_song_id')
      .eq('style_id', styleId)
      .eq('library_song_id', library_song_id)
      .maybeSingle();

    if (existing) {
      reply.code(409).send({ error: { message: 'Song already in style', status: 409 } });
      return;
    }

    const { error } = await supabase
      .from('sim_style_songs')
      .insert({ style_id: styleId, library_song_id });

    assertNoError(error, 'Failed to add song to style');

    // Return the full song record so client can show it immediately
    const { data: song } = await supabase
      .from('library_songs')
      .select('id, title, artist, album, peak_year, run_time_seconds, styles')
      .eq('id', library_song_id)
      .single();

    return reply.code(201).send({ ok: true, song });
  });
}
