import { supabase, assertNoError } from '../supabase.js';

export default async function routes(app) {
  app.get('/styles', async (req, reply) => {
    const { data, error } = await supabase
      .from('sim_styles')
      .select('id, name')
      .order('name');

    assertNoError(error, 'Failed to fetch styles');
    return reply.send({ data });
  });
  app.post('/styles', async (req, reply) => {
    const { name } = req.body || {};

    if (!name?.trim()) {
      return reply.code(400).send({ error: { message: 'name is required', status: 400 } });
    }

    const { data, error } = await supabase
      .from('sim_styles')
      .insert({ name: name.trim() })
      .select('id, name')
      .single();

    assertNoError(error, 'Failed to create style');
    return reply.code(201).send({ ok: true, style: data });
  });
}
