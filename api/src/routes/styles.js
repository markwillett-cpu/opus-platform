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
}
