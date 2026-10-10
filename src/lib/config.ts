import fs from 'fs';
import path from 'path';

export interface AppConfig {
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  supabaseJwksUrl: string;
  cloudflareZoneId: string;
  cloudflareApiToken: string;
  pmtilesUrl: string;
}

function parseKeysFile(): Record<string, string> {
  const result: Record<string, string> = {};
  const keysPath = path.join(process.cwd(), 'keys.txt');

  if (fs.existsSync(keysPath)) {
    try {
      const content = fs.readFileSync(keysPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (val) {
            result[key] = val;
          }
        }
      }
    } catch (e) {
      console.warn('Could not read keys.txt:', e);
    }
  }

  return result;
}

export function getConfig(): AppConfig {
  const fileKeys = parseKeysFile();

  return {
    databaseUrl: process.env.DATABASE_URL || fileKeys.DATABASE_URL || '',
    supabaseUrl: process.env.SUPABASE_URL || fileKeys.SUPABASE_URL || fileKeys.NEXT_PUBLIC_SUPABASE_URL || '',
    supabasePublishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      fileKeys.SUPABASE_PUBLISHABLE_KEY ||
      fileKeys.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      '',
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || fileKeys.SUPABASE_SECRET_KEY || '',
    supabaseJwksUrl: process.env.SUPABASE_JWKS_URL || fileKeys.SUPABASE_JWKS_URL || '',
    cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID || fileKeys.CLOUDFLARE_ZONE_ID || '',
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || fileKeys.CLOUDFLARE_API_TOKEN || '',
    pmtilesUrl:
      process.env.NEXT_PUBLIC_PMTILES_URL ||
      fileKeys.NEXT_PUBLIC_PMTILES_URL ||
      'https://cdn.tuitionmedia.com/tiles/bangladesh_slim.pmtiles'
  };
}
