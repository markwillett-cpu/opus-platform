import { z } from 'zod';
import { supabase, assertNoError } from '../supabase.js';
import { normalizeClassCode, normalizeStyleId } from '../normalize.js';

const PutBody = z.object({
  weights: z.array(z.object({
    class_code: z.string().min(1),
    weight_pct: z.number().int().min(0).max(100)
  })).min(1)
});

export default async function routes(app) {
  app.get('/styles/:styleId/weights', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const { data, error } = await supabase
      .from('sim_style_class_weights')
      .select('class_code, weight_pct')
      .eq('style_id', styleId)
      .order('class_code');

    assertNoError(error, 'Failed to fetch weights');

    return reply.send({ data: data || [] });
  });

  app.put('/styles/:styleId/weights', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);

    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { message: parsed.error.message, status: 400 } });
      return;
    }

    const weights = parsed.data.weights.map(w => {
      const code = normalizeClassCode(w.class_code);
      if (!code) {
        const e = new Error(`Invalid class_code: ${w.class_code}`);
        e.statusCode = 400;
        throw e;
      }
      return { style_id: styleId, class_code: code, weight_pct: w.weight_pct };
    });

    const sum = weights.reduce((acc, w) => acc + w.weight_pct, 0);
    if (sum !== 100) {
      const e = new Error(`Weights must sum to 100. Got ${sum}.`);
      e.statusCode = 400;
      throw e;
    }

    const { error } = await supabase
      .from('sim_style_class_weights')
      .upsert(weights, { onConflict: 'style_id,class_code' });

    assertNoError(error, 'Failed to upsert weights');

    return reply.send({ ok: true, upserted: weights.length });
  });
}
