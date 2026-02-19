export const config = {
  PORT: Number(process.env.PORT || 8787),
  NODE_ENV: process.env.NODE_ENV || 'development',
  OPUS_INTERNAL_API_KEY: process.env.OPUS_INTERNAL_API_KEY || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
};

function must(value, name) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Validate required config at startup
must(config.OPUS_INTERNAL_API_KEY, 'OPUS_INTERNAL_API_KEY');
must(config.SUPABASE_URL, 'SUPABASE_URL');
must(config.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
