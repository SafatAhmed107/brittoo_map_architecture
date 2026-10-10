import { NextRequest, NextResponse } from 'next/server';
import { getDbPool, ensureDbSchema } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';

interface RouteContext {
  params: Promise<{
    z: string;
    x: string;
    y: string;
  }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  const { z: zStr, x: xStr, y: yStr } = await context.params;

  // Clean .pbf extension if requested like 14/1234/5678.pbf
  const cleanY = yStr.replace(/\.pbf$/, '');

  const z = parseInt(zStr, 10);
  const x = parseInt(xStr, 10);
  const y = parseInt(cleanY, 10);

  if (isNaN(z) || isNaN(x) || isNaN(y)) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  // 1. Direct PostgreSQL + PostGIS path
  const p = getDbPool();
  if (p) {
    try {
      await ensureDbSchema();
      const result = await p.query(
        'SELECT get_tuition_tile($1, $2, $3) AS tile',
        [z, x, y]
      );

      const tileBuffer: Buffer = result.rows[0]?.tile || Buffer.alloc(0);
      const uint8 = new Uint8Array(tileBuffer);

      return new NextResponse(uint8, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-protobuf',
          'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
          'Surrogate-Key': `tuition-tile-${z}-${x}-${y}`,
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (err: unknown) {
      console.warn(`[MVT Generation Warning] z:${z} x:${x} y:${y}`, err instanceof Error ? err.message : err);
    }
  }

  // 2. Supabase PostGIS RPC fallback (works with API keys alone)
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('get_tuition_tile', { z, x, y });
      if (!error && data) {
        let buf: Buffer;
        if (typeof data === 'string' && data.startsWith('\\x')) {
          buf = Buffer.from(data.slice(2), 'hex');
        } else if (typeof data === 'string') {
          buf = Buffer.from(data, 'hex');
        } else {
          buf = Buffer.from(data);
        }
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: {
            'Content-Type': 'application/x-protobuf',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
            'Surrogate-Key': `tuition-tile-${z}-${x}-${y}`,
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch (err: unknown) {
      console.warn(`[Supabase MVT Tile Warning] z:${z} x:${x} y:${y}`, err instanceof Error ? err.message : err);
    }
  }

  // 3. Return empty tile buffer with proper headers
  return new NextResponse(new Uint8Array(0), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'Surrogate-Key': `tuition-tile-${z}-${x}-${y}`,
      'Access-Control-Allow-Origin': '*'
    }
  });
}
