import { z } from 'zod';
import { supabase, assertNoError } from '../supabase.js';
import { normalizeClassCode, normalizeStyleId } from '../normalize.js';

const PutBody = z.object({
  assignments: z.array(z.object({
    library_song_id: z.string().min(1),
    class_code: z.string().min(1)
  })).min(1)
});

const DeleteBody = z.object({
  songIds: z.array(z.string().min(1)).min(1)
});


export default async function routes(app) {
  app.get('/styles/:styleId/assignments', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const { data, error } = await supabase
      .from('sim_style_song_classes')
      .select('library_song_id, class_code, moved_at')
      .eq('style_id', styleId);

    assertNoError(error, 'Failed to fetch assignments');

    return reply.send({ data: data || [] });
  });

  app.put('/styles/:styleId/assignments', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { message: parsed.error.message, status: 400 } });
      return;
    }

    const rows = parsed.data.assignments.map(a => {
      const code = normalizeClassCode(a.class_code);
      if (!code) {
        const e = new Error(`Invalid class_code: ${a.class_code}`);
        e.statusCode = 400;
        throw e;
      }
      return {
        style_id: styleId,
        library_song_id: a.library_song_id,
        class_code: code
      };
    });

    const { error } = await supabase
      .from('sim_style_song_classes')
      .upsert(rows, { onConflict: 'style_id,library_song_id' });


    assertNoError(error, 'Failed to upsert assignments');

    return reply.send({ ok: true, upserted: rows.length });
  });
  app.delete('/styles/:styleId/assignments', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const parsed = DeleteBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { message: parsed.error.message, status: 400 } });
      return;
    }

    const { songIds } = parsed.data;

    const { data, error } = await supabase
      .from('sim_style_song_classes')
      .delete()
      .eq('style_id', styleId)
      .in('library_song_id', songIds)
      .select('library_song_id');

    assertNoError(error, 'Failed to delete assignments');

    return reply.send({ ok: true, deleted: (data || []).length });
  });

}
