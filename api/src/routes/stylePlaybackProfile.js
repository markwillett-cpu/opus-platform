import { supabase, assertNoError } from '../supabase.js';
import { normalizeStyleId, normalizeClassCode } from '../normalize.js';

function boolParam(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

export default async function routes(app) {
  // GET /v1/styles/:styleId/playback-profile?include_track_ids=true
  app.get('/styles/:styleId/playback-profile', async (req, reply) => {
    const styleId = normalizeStyleId(req.params.styleId);
    const includeTrackIds = boolParam(req.query?.include_track_ids);

    // 1) Fetch weights (A/B/C only; ignore REST if present)
    const { data: weightsRows, error: weightsErr } = await supabase
      .from('sim_style_class_weights')
      .select('class_code, weight_pct')
      .eq('style_id', styleId);

    assertNoError(weightsErr, 'Failed to fetch weights');

    const weights = { A: 0, B: 0, C: 0 };
    for (const r of (weightsRows || [])) {
      const code = normalizeClassCode(r.class_code);
      if (code === 'A' || code === 'B' || code === 'C') {
        weights[code] = Number(r.weight_pct) || 0;
      }
    }

    // 2) Fetch style membership (all track ids in style)
    const { data: tracksRows, error: tracksErr } = await supabase
      .from('sim_style_songs')
      .select('library_song_id')
      .eq('style_id', styleId)
      .limit(5000);

    assertNoError(tracksErr, 'Failed to fetch style tracks');

    const allTrackIds = (tracksRows || [])
      .map(r => r.library_song_id)
      .filter(Boolean);

    // 3) Fetch assignments (class membership + moved_at)
    const { data: assignsRows, error: assignsErr } = await supabase
      .from('sim_style_song_classes')
      .select('library_song_id, class_code, moved_at')
      .eq('style_id', styleId);

    assertNoError(assignsErr, 'Failed to fetch assignments');

    const classByTrackId = new Map(); // library_song_id -> 'A'|'B'|'C'|'REST'
    let updatedAt = null;

    for (const a of (assignsRows || [])) {
      const id = a.library_song_id;
      if (!id) continue;

      const code = normalizeClassCode(a.class_code);
      if (!code) continue;

      // If there are duplicates, last write wins (matches upsert behavior).
      classByTrackId.set(id, code);

      if (a.moved_at) {
        const t = new Date(a.moved_at);
        if (!Number.isNaN(t.getTime())) {
          if (!updatedAt || t > updatedAt) updatedAt = t;
        }
      }
    }

    // 4) Build pools
    const pools = {
      A: { count: 0, track_ids: includeTrackIds ? [] : undefined },
      B: { count: 0, track_ids: includeTrackIds ? [] : undefined },
      C: { count: 0, track_ids: includeTrackIds ? [] : undefined },
      UNCATEGORIZED: { count: 0, track_ids: includeTrackIds ? [] : undefined },
      REST: { count: 0, track_ids: includeTrackIds ? [] : undefined }
    };

    for (const id of allTrackIds) {
      const code = classByTrackId.get(id);

      if (code === 'A' || code === 'B' || code === 'C') {
        pools[code].count += 1;
        if (includeTrackIds) pools[code].track_ids.push(id);
        continue;
      }

      if (code === 'REST') {
        pools.REST.count += 1;
        if (includeTrackIds) pools.REST.track_ids.push(id);
        continue;
      }

      // Not assigned at all -> UNCATEGORIZED
      pools.UNCATEGORIZED.count += 1;
      if (includeTrackIds) pools.UNCATEGORIZED.track_ids.push(id);
    }

    // 5) Decide mode
    // If style is 100% uncategorized (i.e., no A/B/C assignments), engine should use legacy behavior.
    const abcAssignedCount = pools.A.count + pools.B.count + pools.C.count;
    const abcWeightSum = (weights.A || 0) + (weights.B || 0) + (weights.C || 0);

    const mode = (abcAssignedCount > 0 && abcWeightSum > 0)
      ? 'CLASS_WEIGHTED'
      : 'LEGACY';

    return reply.send({
      data: {
        style_id: styleId,
        mode,
        updated_at: updatedAt ? updatedAt.toISOString() : null,
        weights,
        pools
      }
    });
  });
}
