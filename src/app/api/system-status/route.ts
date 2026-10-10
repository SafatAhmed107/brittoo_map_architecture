import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { getDbPool, ensureDbSchema } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const config = getConfig();
  let dbStatus = 'Not Configured (Using In-Memory Spatial Store)';
  let dbConnected = false;
  let postCount = 0;
  let hasPostGis = false;

  // 1. Check direct PostgreSQL PostGIS pool
  const p = getDbPool();
  if (p) {
    try {
      const isReady = await ensureDbSchema();
      if (isReady) {
        const checkRes = await p.query('SELECT PostGIS_Version();');
        hasPostGis = !!checkRes.rows[0];
        const countRes = await p.query('SELECT COUNT(*) FROM tuition_posts;');
        postCount = parseInt(countRes.rows[0].count, 10);
        dbConnected = true;
        dbStatus = `Connected via PostgreSQL (PostGIS ${checkRes.rows[0].postgis_version})`;
      }
    } catch (err: unknown) {
      dbStatus = `Direct DB Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  }

  // 2. Check Supabase REST client
  let supabaseReady = false;
  let supabaseTableFound = false;
  const supabase = getSupabaseAdmin();
  if (supabase) {
    supabaseReady = true;
    try {
      const { count, error } = await supabase
        .from('tuition_posts')
        .select('*', { count: 'exact', head: true });

      if (!error) {
        supabaseTableFound = true;
        if (!dbConnected) {
          dbConnected = true;
          postCount = count || 0;
          dbStatus = 'Connected via Supabase (table: tuition_posts ready)';
        }
      } else {
        if (!dbConnected) {
          dbStatus = `Supabase Connected (run setup-db.sql to create tuition_posts table)`;
        }
      }
    } catch (e: unknown) {
      console.warn('Supabase status check:', e);
    }
  }

  return NextResponse.json({
    database: {
      connected: dbConnected,
      status: dbStatus,
      hasPostGis,
      postCount,
      configuredInKeys: !!(config.databaseUrl || config.supabaseSecretKey)
    },
    supabase: {
      configured: supabaseReady,
      tableCreated: supabaseTableFound,
      url: config.supabaseUrl
    },
    cloudflare: {
      configured: !!(config.cloudflareZoneId && config.cloudflareApiToken),
      zoneIdProvided: !!config.cloudflareZoneId,
      tokenProvided: !!config.cloudflareApiToken
    },
    pmtiles: {
      url: config.pmtilesUrl
    }
  });
}
