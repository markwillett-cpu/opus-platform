/**
 * PRO Enrichment Agent
 * 
 * Queries ASCAP (primary) and BMI (fallback) for each track in library_songs
 * and upserts rightsholder/PRO data into library_pro_affiliations.
 *
 * Strategy:
 *   1. Fetch unenriched songs from library_songs (no existing PRO row)
 *   2. Search ASCAP by title + performer — their API returns JSON directly
 *   3. If not found in ASCAP, search BMI by title + performer
 *   4. Parse writers/publishers and their PRO affiliations from the response
 *   5. Upsert into library_pro_affiliations
 *   6. Rate limit: ~1 req/sec to avoid blocks
 *
 * Usage:
 *   node scripts/enrich-pro.js                    # enrich all unenriched songs
 *   node scripts/enrich-pro.js --limit 100        # enrich first 100
 *   node scripts/enrich-pro.js --offset 500       # start from offset
 *   node scripts/enrich-pro.js --isrc USUM72403305 # single track by ISRC
 *   node scripts/enrich-pro.js --dry-run          # preview without writing
 *
 * Run from the api/ directory:
 *   cd api && node scripts/enrich-pro.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ASCAP_SEARCH_BASE = 'https://www.ascap.com/repertory/api/ace/search/workID';
const BMI_SEARCH_BASE   = 'https://repertoire.bmi.com/Search/Search';

const RATE_LIMIT_MS  = 1200;   // ms between requests per PRO
const BATCH_SIZE     = 50;
const MAX_RESULTS    = 5;      // max results to consider per search

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.ascap.com/repertory',
};

// Known PRO name normalizations
const PRO_NORMALIZE = {
  'ASCAP': 'ASCAP',
  'BMI': 'BMI',
  'SESAC': 'SESAC',
  'GMR': 'GMR',
  'GLOBAL MUSIC RIGHTS': 'GMR',
  'SOCAN': 'SOCAN',
  'PRS': 'PRS',
  'GEMA': 'GEMA',
  'SACEM': 'SACEM',
  'SOUNDEXCHANGE': 'SoundExchange',
};

// ─────────────────────────────────────────────
// ARGS
// ─────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i+1] || true] : null)
    .filter(Boolean)
);

const DRY_RUN = args['dry-run'] === true || args['dry-run'] === 'true';
const LIMIT   = parseInt(args.limit)  || 500;
const OFFSET  = parseInt(args.offset) || 0;
const SINGLE_ISRC = args.isrc || null;

// ─────────────────────────────────────────────
// ASCAP SEARCH
// ─────────────────────────────────────────────

async function searchASCAP(title, artist) {
  // ASCAP URL format: /api/ace/search/workID/title/{title}/{artist}
  // Returns JSON with works array
  const titleEnc  = encodeURIComponent(title.trim());
  const artistEnc = encodeURIComponent(artist.trim());
  const url = `${ASCAP_SEARCH_BASE}/title/${titleEnc}/${artistEnc}`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      // Try title-only fallback
      const res2 = await fetch(`${ASCAP_SEARCH_BASE}/title/${titleEnc}`, { headers: HEADERS });
      if (!res2.ok) return null;
      const data2 = await res2.json();
      return data2;
    }
    return await res.json();
  } catch (e) {
    console.warn(`  ASCAP fetch error: ${e.message}`);
    return null;
  }
}

function parseASCAPResults(data, title, artist) {
  // ASCAP response shape:
  // { works: [{ workTitle, performers: [], writers: [{name, ipiNo, societyCode}], publishers: [{name, ipiNo, societyCode}] }] }
  const works = data?.works || data?.result || [];
  if (!works.length) return null;

  // Find best match by title similarity
  const titleLower  = title.toLowerCase();
  const artistLower = artist.toLowerCase();

  let best = works[0];
  for (const w of works.slice(0, MAX_RESULTS)) {
    const wTitle = (w.workTitle || w.title || '').toLowerCase();
    const wPerfs = (w.performers || []).map(p => (p.name || p.performerName || '').toLowerCase()).join(' ');
    if (wTitle.includes(titleLower.slice(0, 10)) &&
        (wPerfs.includes(artistLower.split(' ')[0]) || artistLower.split(' ').some(t => wPerfs.includes(t)))) {
      best = w;
      break;
    }
  }

  const rows = [];
  const iswc = best.iswc || best.workId || null;

  // Writers
  for (const w of (best.writers || best.songWriters || [])) {
    const name    = w.name || w.writerName || w.fullName;
    const society = normalizePRO(w.societyCode || w.society || w.pro || 'ASCAP');
    if (!name) continue;
    rows.push({
      pro:               society,
      iswc,
      rightsholder_name: name,
      rightsholder_type: 'writer',
    });
  }

  // Publishers
  for (const p of (best.publishers || [])) {
    const name    = p.name || p.publisherName;
    const society = normalizePRO(p.societyCode || p.society || p.pro || 'ASCAP');
    if (!name) continue;
    rows.push({
      pro:               society,
      iswc,
      rightsholder_name: name,
      rightsholder_type: 'publisher',
    });
  }

  return rows.length ? { rows, source: 'ascap', iswc } : null;
}

// ─────────────────────────────────────────────
// BMI SEARCH
// ─────────────────────────────────────────────

async function searchBMI(title, artist) {
  // BMI search: POST or GET with query params
  // GET /Search/Search?q=title&SearchType=Title&SearchIn=Songview
  const params = new URLSearchParams({
    q:          title.trim(),
    SearchType: 'Title',
    SearchIn:   'Songview',
  });
  const url = `${BMI_SEARCH_BASE}?${params}`;

  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        'Referer': 'https://repertoire.bmi.com/',
        'Accept': 'application/json, text/html, */*',
      }
    });
    if (!res.ok) return null;
    const text = await res.text();

    // BMI returns HTML or JSON depending on request
    // Try JSON parse first
    try {
      return JSON.parse(text);
    } catch {
      // Parse HTML table response
      return parseBMIHTML(text, title, artist);
    }
  } catch (e) {
    console.warn(`  BMI fetch error: ${e.message}`);
    return null;
  }
}

function parseBMIHTML(html, title, artist) {
  // Extract work rows from BMI HTML response
  // BMI returns a table with columns: Title, Performers, Writers, Publishers
  const rows = [];
  const titleLower = title.toLowerCase();

  // Find matching title rows
  const workBlocks = html.match(/<tr[^>]*class="[^"]*work[^"]*"[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const block of workBlocks.slice(0, MAX_RESULTS)) {
    // Extract title
    const titleMatch = block.match(/class="[^"]*title[^"]*"[^>]*>(.*?)<\/td>/i);
    const blockTitle = titleMatch ? stripTags(titleMatch[1]).toLowerCase() : '';
    if (!blockTitle.includes(titleLower.slice(0, 8))) continue;

    // Extract writers
    const writerMatches = block.matchAll(/class="[^"]*writer[^"]*"[^>]*>(.*?)<\/td>/gi);
    for (const m of writerMatches) {
      const name = stripTags(m[1]).trim();
      if (name) rows.push({ pro: 'BMI', rightsholder_name: name, rightsholder_type: 'writer', iswc: null });
    }

    // Extract publishers
    const pubMatches = block.matchAll(/class="[^"]*publisher[^"]*"[^>]*>(.*?)<\/td>/gi);
    for (const m of pubMatches) {
      const name = stripTags(m[1]).trim();
      if (name) rows.push({ pro: 'BMI', rightsholder_name: name, rightsholder_type: 'publisher', iswc: null });
    }

    if (rows.length) break;
  }

  return rows.length ? rows : null;
}

// ─────────────────────────────────────────────
// MUSICBRAINZ FALLBACK
// MusicBrainz is open data and has PRO/publisher info for many tracks
// ─────────────────────────────────────────────

async function searchMusicBrainz(isrc) {
  if (!isrc) return null;
  try {
    const url = `https://musicbrainz.org/ws/2/recording/?query=isrc:${isrc}&fmt=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OpusPlatform/1.0 (contact@customchannels.net)',
        'Accept': 'application/json',
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const recording = data.recordings?.[0];
    if (!recording) return null;

    // Fetch full work data including relations
    if (recording['work-relations']?.length) {
      const workId = recording['work-relations'][0]?.work?.id;
      if (workId) {
        await sleep(500); // MusicBrainz rate limit: 1 req/sec
        const workRes = await fetch(
          `https://musicbrainz.org/ws/2/work/${workId}?inc=artist-rels+label-rels&fmt=json`,
          { headers: { 'User-Agent': 'OpusPlatform/1.0 (contact@customchannels.net)', 'Accept': 'application/json' } }
        );
        if (workRes.ok) {
          const work = await workRes.json();
          return parseMBWork(work, recording.id);
        }
      }
    }

    return { mbRecordingId: recording.id, rows: [] };
  } catch (e) {
    console.warn(`  MusicBrainz error: ${e.message}`);
    return null;
  }
}

function parseMBWork(work, recordingId) {
  const rows = [];
  const iswc = work.iswcs?.[0] || null;
  const mbWorkId = work.id || null;

  for (const rel of (work.relations || [])) {
    if (!['composer', 'writer', 'lyricist', 'publisher'].includes(rel.type)) continue;
    const name = rel.artist?.name || rel.label?.name;
    if (!name) continue;

    // MusicBrainz doesn't directly give PRO — infer from known publishers
    const pro = inferPROFromPublisher(name);
    rows.push({
      pro:               pro || 'UNKNOWN',
      iswc,
      mb_work_id:        mbWorkId,
      mb_artist_id:      rel.artist?.id || null,
      rightsholder_name: name,
      rightsholder_type: ['publisher', 'label'].includes(rel.type) ? 'publisher' : 'writer',
    });
  }

  return { rows, iswc, mbWorkId };
}

// ─────────────────────────────────────────────
// PUBLISHER → PRO INFERENCE
// Major publishers have consistent PRO affiliations
// ─────────────────────────────────────────────

const PUBLISHER_PRO_MAP = [
  // ASCAP-affiliated publishers
  { pattern: /universal music publishing|ump|songs of universal/i,         pro: 'ASCAP' },
  { pattern: /kobalt/i,                                                     pro: 'ASCAP' },
  { pattern: /warner chappell|wc music/i,                                  pro: 'ASCAP' },
  { pattern: /disney music|walt disney/i,                                   pro: 'ASCAP' },
  { pattern: /downtown music|downtown global/i,                             pro: 'ASCAP' },
  // BMI-affiliated publishers
  { pattern: /sony music publishing|sony\/atv|atv music/i,                 pro: 'BMI'   },
  { pattern: /concord music|concord bicycle/i,                              pro: 'BMI'   },
  { pattern: /ole|ole media/i,                                              pro: 'BMI'   },
  { pattern: /peermusic/i,                                                  pro: 'BMI'   },
  { pattern: /songs of integrity|integrity music/i,                         pro: 'BMI'   },
  // GMR-affiliated (major hitmakers who signed with GMR)
  { pattern: /irving azoff|azoff/i,                                         pro: 'GMR'   },
  // SESAC-affiliated
  { pattern: /bob dylan music|special rider/i,                              pro: 'SESAC' },
  { pattern: /neil diamond/i,                                               pro: 'SESAC' },
];

function inferPROFromPublisher(name) {
  for (const { pattern, pro } of PUBLISHER_PRO_MAP) {
    if (pattern.test(name)) return pro;
  }
  return null;
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function normalizePRO(raw) {
  if (!raw) return 'UNKNOWN';
  const upper = String(raw).toUpperCase().trim();
  return PRO_NORMALIZE[upper] || raw.trim();
}

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg, level = 'info') {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix = { info: '  ', warn: '⚠ ', error: '✗ ', success: '✓ ' }[level] || '  ';
  console.log(`[${ts}] ${prefix}${msg}`);
}

// ─────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────

async function getUnenrichedSongs(limit, offset, isrc = null) {
  let query = supabase
    .from('library_songs')
    .select('id, title, artist, isrc')
    .not('isrc', 'is', null);

  if (isrc) {
    query = query.ilike('isrc', isrc);
  } else {
    // Exclude songs that already have PRO data
    const { data: enriched } = await supabase
      .from('library_pro_affiliations')
      .select('library_song_id');
    const enrichedIds = (enriched || []).map(r => r.library_song_id);
    if (enrichedIds.length > 0) {
      query = query.not('id', 'in', `(${enrichedIds.map(id => `"${id}"`).join(',')})`);
    }
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch songs: ${error.message}`);
  return data || [];
}

async function upsertPRORows(songId, rows) {
  if (!rows.length) return 0;

  const records = rows.map(r => ({
    library_song_id:   songId,
    pro:               r.pro,
    iswc:              r.iswc || null,
    mb_work_id:        r.mb_work_id || null,
    mb_artist_id:      r.mb_artist_id || null,
    rightsholder_name: r.rightsholder_name || null,
    rightsholder_type: r.rightsholder_type || null,
  }));

  const { error } = await supabase
    .from('library_pro_affiliations')
    .upsert(records, { onConflict: 'library_song_id,pro,rightsholder_name', ignoreDuplicates: true });

  if (error) throw new Error(`Upsert failed: ${error.message}`);
  return records.length;
}

// ─────────────────────────────────────────────
// CORE ENRICHMENT LOGIC
// ─────────────────────────────────────────────

async function enrichSong(song) {
  const { id, title, artist, isrc } = song;
  let rows = [];
  let source = null;

  // ── Step 1: Try ASCAP ──
  await sleep(RATE_LIMIT_MS);
  const ascapData = await searchASCAP(title, artist);
  if (ascapData) {
    const parsed = parseASCAPResults(ascapData, title, artist);
    if (parsed?.rows?.length) {
      rows = parsed.rows;
      source = 'ascap';
    }
  }

  // ── Step 2: Try BMI if ASCAP found nothing ──
  if (!rows.length) {
    await sleep(RATE_LIMIT_MS);
    const bmiData = await searchBMI(title, artist);
    if (bmiData) {
      const bmiRows = Array.isArray(bmiData) ? bmiData : (bmiData.rows || []);
      if (bmiRows.length) {
        rows = bmiRows;
        source = 'bmi';
      }
    }
  }

  // ── Step 3: MusicBrainz fallback (open data, always worth trying) ──
  if (!rows.length && isrc) {
    await sleep(1100); // MusicBrainz: strict 1 req/sec
    const mbData = await searchMusicBrainz(isrc);
    if (mbData?.rows?.length) {
      rows = mbData.rows;
      source = 'musicbrainz';
    }
  }

  // ── Step 4: Publisher inference from existing metadata ──
  if (!rows.length) {
    // Try inferring from artist/label name as a last resort
    const inferredPRO = inferPROFromPublisher(artist);
    if (inferredPRO) {
      rows = [{ pro: inferredPRO, rightsholder_name: artist, rightsholder_type: 'inferred', iswc: null }];
      source = 'inferred';
    }
  }

  return { rows, source };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  PRO Enrichment Agent');
  console.log('  ASCAP → BMI → MusicBrainz → Inference');
  console.log('═'.repeat(60));
  console.log(`  Mode:    ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Limit:   ${SINGLE_ISRC ? 'single track' : LIMIT}`);
  if (SINGLE_ISRC) console.log(`  ISRC:    ${SINGLE_ISRC}`);
  console.log('═'.repeat(60) + '\n');

  // Validate env
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const songs = await getUnenrichedSongs(LIMIT, OFFSET, SINGLE_ISRC);
  console.log(`Found ${songs.length} songs to enrich\n`);

  if (!songs.length) {
    console.log('Nothing to do — all songs already enriched.');
    return;
  }

  const stats = { total: songs.length, enriched: 0, notFound: 0, errors: 0 };
  const sourceCounts = {};

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const pct  = Math.round(((i + 1) / songs.length) * 100);
    console.log(`[${String(i + 1).padStart(4)}/${songs.length}] (${pct}%) ${song.artist} — ${song.title}`);
    console.log(`         ISRC: ${song.isrc || 'none'}`);

    try {
      const { rows, source } = await enrichSong(song);

      if (!rows.length) {
        log('Not found in any source', 'warn');
        stats.notFound++;
        continue;
      }

      log(`Found ${rows.length} rightsholder(s) via ${source.toUpperCase()}`, 'success');
      rows.forEach(r => log(`  ${r.rightsholder_type?.padEnd(10)} ${r.pro?.padEnd(8)} ${r.rightsholder_name}`));

      if (!DRY_RUN) {
        const written = await upsertPRORows(song.id, rows);
        log(`Wrote ${written} row(s) to library_pro_affiliations`);
      }

      stats.enriched++;
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    } catch (e) {
      log(`Error: ${e.message}`, 'error');
      stats.errors++;
    }

    console.log('');
  }

  // Summary
  console.log('═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Total processed:  ${stats.total}`);
  console.log(`  Enriched:         ${stats.enriched}`);
  console.log(`  Not found:        ${stats.notFound}`);
  console.log(`  Errors:           ${stats.errors}`);
  console.log(`  Sources:`);
  Object.entries(sourceCounts).forEach(([s, c]) => console.log(`    ${s.padEnd(14)} ${c} tracks`));
  if (DRY_RUN) console.log('\n  ⚠ DRY RUN — no data was written');
  console.log('═'.repeat(60) + '\n');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
