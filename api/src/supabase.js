import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

export function assertNoError(error, context = 'Supabase error') {
  if (error) {
    const e = new Error(`${context}: ${error.message}`);
    e.statusCode = 500;
    throw e;
  }
}
