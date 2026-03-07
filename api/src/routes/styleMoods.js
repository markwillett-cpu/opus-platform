import { z } from 'zod';
import { supabase, assertNoError } from '../supabase.js';
import { normalizeStyleId } from '../normalize.js';

// ─────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────

const VALID_MOODS = [
  'Calm', 'Classic', 'Comfortable', 'Current', 'Energetic', 'Festive',
  'Fun', 'Intimate', 'Joyful', 'Modern', 'Peaceful', 'Premium',
  'Professional', 'Reflective', 'Relaxed', 'Sophisticated', 'Soulful',
  'Upbeat', 'Uplifting', 'Vibrant', 'Warm', 'Welcoming'
];

const PutBody = z.object({
  moods: z.array(z.string().min(1)).min(0).max(6)
});

export default async function routes(app) {

  /**
   * GET /v1/styles/:styleId/moods
   * Returns ordered moods for a style.
   */
  app.get('/styles/:styleId/moods', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const { data, error } = await supabase
      .from('opus_style_moods')
      .select('mood, position')
      .eq('style_id', styleId)
      .order('position');

    assertNoError(error, 'Failed to fetch style moods');

    return reply.send({ data: data || [] });
  });

  /**
   * GET /v1/moods/all
   * Returns all styles with their moods in one call.
   * Useful for bulk loading the mood tagging UI.
   */
  app.get('/moods/all', async (req, reply) => {
    const { data, error } = await supabase
      .from('opus_style_moods')
      .select(`
        style_id,
        mood,
        position,
        sim_styles ( name )
      `)
      .order('style_id')
      .order('position');

    assertNoError(error, 'Failed to fetch all moods');

    // Group by style_id into { style_id, style_name, moods: [...] }
    const map = new Map();
    for (const row of (data || [])) {
      if (!map.has(row.style_id)) {
        map.set(row.style_id, {
          style_id:   row.style_id,
          style_name: row.sim_styles?.name || null,
          moods:      []
        });
      }
      map.get(row.style_id).moods.push(row.mood);
    }

    return reply.send({ data: [...map.values()] });
  });

  /**
   * PUT /v1/styles/:styleId/moods
   * Full replace — deletes existing moods and inserts new ordered list.
   * Body: { moods: ['Calm', 'Relaxed', 'Peaceful'] }  (ordered, max 6)
   */
  app.put('/styles/:styleId/moods', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { message: parsed.error.message, status: 400 } });
      return;
    }

    const { moods } = parsed.data;

    // Validate mood values
    const invalid = moods.filter(m => !VALID_MOODS.includes(m));
    if (invalid.length) {
      reply.code(400).send({
        error: { message: `Invalid mood values: ${invalid.join(', ')}`, status: 400 }
      });
      return;
    }

    // Delete existing moods for this style
    const { error: deleteError } = await supabase
      .from('opus_style_moods')
      .delete()
      .eq('style_id', styleId);

    assertNoError(deleteError, 'Failed to clear existing moods');

    // Insert new ordered moods
    if (moods.length > 0) {
      const rows = moods.map((mood, i) => ({
        style_id: styleId,
        mood,
        position: i + 1,
        updated_at: new Date().toISOString()
      }));

      const { error: insertError } = await supabase
        .from('opus_style_moods')
        .insert(rows);

      assertNoError(insertError, 'Failed to insert moods');
    }

    return reply.send({ ok: true, style_id: styleId, moods });
  });

  /**
   * DELETE /v1/styles/:styleId/moods
   * Clears all moods for a style.
   */
  app.delete('/styles/:styleId/moods', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const { error } = await supabase
      .from('opus_style_moods')
      .delete()
      .eq('style_id', styleId);

    assertNoError(error, 'Failed to delete moods');

    return reply.send({ ok: true, style_id: styleId });
  });
}
