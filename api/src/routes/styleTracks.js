import { supabase, assertNoError } from '../supabase.js';
import { normalizeStyleId } from '../normalize.js';

export default async function routes(app) {
  app.get('/styles/:styleId/tracks', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const { data, error } = await supabase
      .from('sim_style_songs')
      .select(`
        library_song_id,
        sim_duration_seconds,
        library_songs(
          id, artist, title, album, peak_year, run_time_seconds, styles
        )
      `)      
.eq('style_id', styleId)
.limit(3000);  // Add this line
    assertNoError(error, 'Failed to fetch style tracks');

    // Normalize response shape a bit for client consumption
    const rows = (data || []).map(r => ({
      library_song_id: r.library_song_id,
      sim_duration_seconds: r.sim_duration_seconds,
      song: r.library_songs || null
    }));

    return reply.send({ data: rows });
  });
}
