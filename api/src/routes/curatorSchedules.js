import { z } from 'zod';
import { supabase, assertNoError } from '../supabase.js';
import { normalizeStyleId } from '../normalize.js';

// ─────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────

const VALID_CADENCES = ['weekly', 'biweekly', 'monthly', 'quarterly'];

const UpsertBody = z.object({
  style_id:     z.string().min(1),
  curator_name: z.string().min(1).max(200),
  cadence:      z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  notes:        z.string().max(500).optional()
});

const DeleteBody = z.object({
  style_id: z.string().min(1)
});

// ─────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────

export default async function routes(app) {

  /**
   * GET /v1/curator-schedules
   * Returns all curator schedules, optionally filtered by curator_name or style_id.
   * Query params: ?curator_name=Maya+Chen  |  ?style_id=<uuid>
   */
  app.get('/curator-schedules', async (req, reply) => {
    let query = supabase
      .from('opus_curator_schedules')
      .select(`
        id,
        style_id,
        curator_name,
        cadence,
        last_updated,
        notes,
        created_at,
        updated_at,
        sim_styles ( name )
      `)
      .order('curator_name')
      .order('cadence');

    if (req.query.curator_name) {
      query = query.eq('curator_name', req.query.curator_name);
    }

    if (req.query.style_id) {
      query = query.eq('style_id', normalizeStyleId(req.query.style_id));
    }

    const { data, error } = await query;
    assertNoError(error, 'Failed to fetch curator schedules');

    // Flatten style name from join
    const normalized = (data || []).map(row => ({
      id:           row.id,
      style_id:     row.style_id,
      style_name:   row.sim_styles?.name || null,
      curator_name: row.curator_name,
      cadence:      row.cadence,
      last_updated: row.last_updated,
      notes:        row.notes || '',
      created_at:   row.created_at,
      updated_at:   row.updated_at
    }));

    return reply.send({ data: normalized });
  });

  /**
   * GET /v1/curator-schedules/curators
   * Returns the distinct list of curator names that have schedules.
   * Useful for populating the curator filter dropdown dynamically.
   */
  app.get('/curator-schedules/curators', async (req, reply) => {
    const { data, error } = await supabase
      .from('opus_curator_schedules')
      .select('curator_name')
      .order('curator_name');

    assertNoError(error, 'Failed to fetch curator names');

    const unique = [...new Set((data || []).map(r => r.curator_name))];
    return reply.send({ data: unique });
  });

  /**
   * PUT /v1/curator-schedules
   * Upsert a schedule for a style. Conflicts on style_id.
   * Body: { style_id, curator_name, cadence, last_updated?, notes? }
   */
  app.put('/curator-schedules', async (req, reply) => {
    const parsed = UpsertBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { message: parsed.error.message, status: 400 } });
      return;
    }

    const { style_id, curator_name, cadence, last_updated, notes } = parsed.data;

    const row = {
      style_id:     normalizeStyleId(style_id),
      curator_name: curator_name.trim(),
      cadence,
      last_updated: last_updated || new Date().toISOString().slice(0, 10),
      notes:        (notes || '').trim(),
      updated_at:   new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('opus_curator_schedules')
      .upsert(row, { onConflict: 'style_id' })
      .select()
      .single();

    assertNoError(error, 'Failed to upsert curator schedule');

    return reply.send({ ok: true, data });
  });

  /**
   * PATCH /v1/curator-schedules/:styleId/mark-updated
   * Stamps last_updated = today on a schedule (called after curator adds songs).
   */
  app.patch('/curator-schedules/:styleId/mark-updated', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('opus_curator_schedules')
      .update({ last_updated: today, updated_at: new Date().toISOString() })
      .eq('style_id', styleId)
      .select()
      .single();

    assertNoError(error, 'Failed to mark schedule updated');

    if (!data) {
      reply.code(404).send({ error: { message: 'No schedule found for this style', status: 404 } });
      return;
    }

    return reply.send({ ok: true, data });
  });

  /**
   * DELETE /v1/curator-schedules/:styleId
   * Remove a schedule for a style.
   */
  app.delete('/curator-schedules/:styleId', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const { data, error } = await supabase
      .from('opus_curator_schedules')
      .delete()
      .eq('style_id', styleId)
      .select('style_id')
      .single();

    assertNoError(error, 'Failed to delete curator schedule');

    if (!data) {
      reply.code(404).send({ error: { message: 'No schedule found for this style', status: 404 } });
      return;
    }

    return reply.send({ ok: true, deleted: data.style_id });
  });
}
