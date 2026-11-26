// Where the application finds its server. The values are public by nature (they are part of the
// code every browser downloads); nothing secret may ever be added here.
const env = import.meta.env;

export const SUPABASE_URL: string = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? '';
/** Region the api function is pinned to (data stay in the EU). */
export const FUNCTION_REGION = 'eu-central-1';

/**
 * Local run for development: no Supabase, the dev server answers /api itself from a database in
 * memory of fictional data and nobody logs in. Never true in a build that was given a Supabase address.
 */
export const LOCAL_MODE: boolean = !SUPABASE_URL && (env.DEV || env.VITE_LOCAL_API === '1');
/** A build without a server address and outside local mode cannot work at all. */
export const CONFIGURED: boolean = LOCAL_MODE || (!!SUPABASE_URL && !!SUPABASE_ANON_KEY);
export const LOCAL_TOKEN = 'local-dev';
