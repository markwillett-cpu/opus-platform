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

  /**
   * GET /v1/styles/:styleId/dna
   * Returns aggregate audio attribute profile for a style.
   * Computes from song_attributes rows for all songs in the style.
   */
  app.get('/styles/:styleId/dna', async (req, reply) => {
    const { styleId } = req.params;

    // Step 1: get all song IDs in this style
    const { data: styleSongs, error: styleError } = await supabase
      .from('sim_style_songs')
      .select('library_song_id')
      .eq('style_id', styleId);

    assertNoError(styleError, 'Failed to fetch style songs');

    if (!styleSongs || styleSongs.length === 0) {
      return reply.send({ ok: true, enriched: 0, dna: null });
    }

    const songIds = styleSongs.map(r => r.library_song_id);

    // Step 2: fetch attributes for those songs
    const { data, error } = await supabase
      .from('song_attributes')
      .select(`
        library_song_id,
        bpm, energy, danceability, valence,
        acousticness, instrumentalness, speechiness,
        loudness, key, mode, time_signature, raw
      `)
      .eq('source', 'soundcharts')
      .in('library_song_id', songIds);

    assertNoError(error, 'Failed to fetch style DNA');

    if (!data || data.length === 0) {
      return reply.send({ ok: true, enriched: 0, dna: null });
    }

    // ── Helpers ──────────────────────────────────────────
    const nums = (field) => data.map(r => r[field]).filter(v => v !== null && v !== undefined);
    const avg  = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const std  = (arr) => {
      if (arr.length < 2) return 0;
      const mean = avg(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
    };

    // ── BPM ──────────────────────────────────────────────
    const bpms   = nums('bpm');
    const bpmAvg = avg(bpms);
    const bpmStd = std(bpms);
    const bpmMin = bpms.length ? Math.min(...bpms) : null;
    const bpmMax = bpms.length ? Math.max(...bpms) : null;

    // ── Energy ───────────────────────────────────────────
    const energies  = nums('energy');
    const energyAvg = avg(energies);
    const energyStd = std(energies);

    // ── Other attributes ─────────────────────────────────
    const danceabilities = nums('danceability');
    const valences       = nums('valence');
    const acousticnesses = nums('acousticness');

    // ── Genres ───────────────────────────────────────────
    const genreCounts = {};
    data.forEach(r => {
      const genres = (r.raw?.genres || []).map(g => g.root).filter(Boolean);
      genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
    });
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count, pct: Math.round(count / data.length * 100) }));

    // ── Key distribution ─────────────────────────────────
    const keyCounts = {};
    data.forEach(r => {
      if (r.key !== null && r.key !== undefined) {
        keyCounts[r.key] = (keyCounts[r.key] || 0) + 1;
      }
    });
    const topKeys = Object.entries(keyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key, count]) => ({ key: parseInt(key), count, pct: Math.round(count / data.length * 100) }));

    // ── Mode ─────────────────────────────────────────────
    const modeCounts = { major: 0, minor: 0 };
    data.forEach(r => { if (r.mode) modeCounts[r.mode] = (modeCounts[r.mode] || 0) + 1; });

    // ── Outlier thresholds (±1.5 SD) ─────────────────────
    const outlierThreshold = 1.5;
    const bpmLow  = bpmAvg !== null ? bpmAvg - outlierThreshold * bpmStd : null;
    const bpmHigh = bpmAvg !== null ? bpmAvg + outlierThreshold * bpmStd : null;
    const energyLow  = energyAvg !== null ? energyAvg - outlierThreshold * energyStd : null;
    const energyHigh = energyAvg !== null ? energyAvg + outlierThreshold * energyStd : null;

    return reply.send({
      ok: true,
      enriched: data.length,
      total: data.length,
      dna: {
        bpm: {
          avg: bpmAvg !== null ? Math.round(bpmAvg * 10) / 10 : null,
          std: Math.round(bpmStd * 10) / 10,
          min: bpmMin !== null ? Math.round(bpmMin) : null,
          max: bpmMax !== null ? Math.round(bpmMax) : null,
          outlierLow:  bpmLow  !== null ? Math.round(bpmLow)  : null,
          outlierHigh: bpmHigh !== null ? Math.round(bpmHigh) : null,
        },
        energy: {
          avg: energyAvg !== null ? Math.round(energyAvg * 100) / 100 : null,
          std: Math.round(energyStd * 100) / 100,
          outlierLow:  energyLow  !== null ? Math.round(energyLow  * 100) / 100 : null,
          outlierHigh: energyHigh !== null ? Math.round(energyHigh * 100) / 100 : null,
        },
        danceability: { avg: avg(danceabilities) !== null ? Math.round(avg(danceabilities) * 100) / 100 : null },
        valence:      { avg: avg(valences)       !== null ? Math.round(avg(valences)       * 100) / 100 : null },
        acousticness: { avg: avg(acousticnesses) !== null ? Math.round(avg(acousticnesses) * 100) / 100 : null },
        topGenres,
        topKeys,
        mode: modeCounts,
      }
    });
  });

}
