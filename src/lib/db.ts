import { Pool } from 'pg';
import { getConfig } from './config';
import { getSupabaseAdmin } from './supabase';

export interface TuitionPost {
  id: string;
  guardian_name: string;
  contact_number: string;
  class_level: string;
  subjects: string[];
  salary_budget: number;
  notes?: string;
  thana_name: string;
  district_name: string;
  lat: number;
  lng: number;
  status: 'OPEN' | 'MATCHED' | 'CLOSED';
  created_at: string;
}

// In-Memory Fallback Seed Data (used when remote database is not yet populated)
const memoryPosts: TuitionPost[] = [
  {
    id: 'post-1',
    guardian_name: 'Engr. Rahman',
    contact_number: '01711-234567',
    class_level: 'HSC 2nd Year',
    subjects: ['Physics', 'Higher Math'],
    salary_budget: 8500,
    notes: 'Near BUET Palashi Gate. Seeking BUET engineering tutor for admission preparation.',
    thana_name: 'Lalbagh',
    district_name: 'Dhaka',
    lat: 23.7266,
    lng: 90.3924,
    status: 'OPEN',
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'post-2',
    guardian_name: 'Dr. Sultana',
    contact_number: '01819-876543',
    class_level: 'SSC (Class 10)',
    subjects: ['General Math', 'Physics', 'Chemistry'],
    salary_budget: 7000,
    notes: 'Near Curzon Hall / High Court. 3 days a week, evening 6:00 PM.',
    thana_name: 'Shahbagh',
    district_name: 'Dhaka',
    lat: 23.7275,
    lng: 90.4019,
    status: 'OPEN',
    created_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: 'post-3',
    guardian_name: 'Mrs. Nusrat',
    contact_number: '01912-345678',
    class_level: 'Class 8 (JSC)',
    subjects: ['All Science Subjects', 'English'],
    salary_budget: 6000,
    notes: 'Dhanmondi 27 near Rapa Plaza. Friendly tutor preferred.',
    thana_name: 'Dhanmondi',
    district_name: 'Dhaka',
    lat: 23.7533,
    lng: 90.3725,
    status: 'OPEN',
    created_at: new Date(Date.now() - 10800000).toISOString()
  },
  {
    id: 'post-4',
    guardian_name: 'Prof. Hasan',
    contact_number: '01678-901234',
    class_level: 'HSC 1st Year',
    subjects: ['Chemistry', 'Biology'],
    salary_budget: 7500,
    notes: 'Near Farmgate Metro Station / Indira Road. 4 days a week.',
    thana_name: 'Tejgaon',
    district_name: 'Dhaka',
    lat: 23.7571,
    lng: 90.3888,
    status: 'OPEN',
    created_at: new Date(Date.now() - 14400000).toISOString()
  },
  {
    id: 'post-5',
    guardian_name: 'Md. Tariqul Islam',
    contact_number: '01552-334455',
    class_level: 'HSC 2nd Year',
    subjects: ['Physics', 'ICT'],
    salary_budget: 7000,
    notes: 'Near Mirpur 10 Roundabout. Looking for someone strong in electromagnetism.',
    thana_name: 'Mirpur',
    district_name: 'Dhaka',
    lat: 23.8071,
    lng: 90.3697,
    status: 'OPEN',
    created_at: new Date(Date.now() - 18000000).toISOString()
  },
  {
    id: 'post-6',
    guardian_name: 'Advocate Monir',
    contact_number: '01712-998877',
    class_level: 'Class 9',
    subjects: ['General Science', 'Higher Math'],
    salary_budget: 5500,
    notes: 'Shaheb Bazar / Boalia, Rajshahi. Near Zero Point.',
    thana_name: 'Boalia',
    district_name: 'Rajshahi',
    lat: 24.3676,
    lng: 88.6004,
    status: 'OPEN',
    created_at: new Date(Date.now() - 21600000).toISOString()
  }
];

let pool: Pool | null = null;
let dbInitialized = false;

export function getDbPool(): Pool | null {
  const config = getConfig();
  if (!config.databaseUrl) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000
    });
  }

  return pool;
}

// Automatically runs DDL on direct connection
export async function ensureDbSchema(): Promise<boolean> {
  const p = getDbPool();
  if (!p || dbInitialized) return !!p;

  try {
    const client = await p.connect();
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS tuition_posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guardian_name VARCHAR(100) DEFAULT 'Guardian',
          contact_number VARCHAR(30) DEFAULT '01700000000',
          class_level VARCHAR(50) NOT NULL,
          subjects TEXT[] NOT NULL,
          salary_budget NUMERIC(10, 2) NOT NULL,
          notes TEXT,
          thana_name TEXT NOT NULL,
          district_name TEXT NOT NULL,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          location GEOMETRY(Point, 4326),
          status VARCHAR(20) DEFAULT 'OPEN',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tuition_posts_location ON tuition_posts USING GIST(location);
        CREATE INDEX IF NOT EXISTS idx_tuition_posts_status ON tuition_posts (status) WHERE status = 'OPEN';
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION get_tuition_tile(z integer, x integer, y integer)
        RETURNS bytea AS $$
        DECLARE
            mvt bytea;
        BEGIN
            WITH bbox AS (
                SELECT ST_TileEnvelope(z, x, y) AS geom
            ),
            mvtdata AS (
                SELECT 
                    t.id,
                    t.guardian_name,
                    t.class_level,
                    t.salary_budget,
                    t.subjects,
                    t.thana_name,
                    t.district_name,
                    ST_AsMVTGeom(ST_Transform(COALESCE(t.location, ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326)), 3857), bbox.geom, 4096, 64, true) AS geom
                FROM tuition_posts t, bbox
                WHERE t.status = 'OPEN'
                  AND ST_Intersects(ST_Transform(COALESCE(t.location, ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326)), 3857), bbox.geom)
            )
            SELECT ST_AsMVT(mvtdata.*, 'tuition_layer', 4096, 'geom') INTO mvt FROM mvtdata;
            RETURN mvt;
        END;
        $$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
      `);

      dbInitialized = true;
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[PostGIS Schema Init Warning]:', err);
    return false;
  }
}

// Haversine distance in meters
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Query tuition posts
export async function getTuitions(params?: {
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  status?: string;
  limit?: number;
}): Promise<{ posts: (TuitionPost & { distance_meters?: number })[]; isLiveDb: boolean }> {
  const p = getDbPool();
  const limit = params?.limit || 50;

  // 1. Direct PostgreSQL + PostGIS path
  if (p) {
    try {
      await ensureDbSchema();
      let query = `
        SELECT 
          id, guardian_name, contact_number, class_level, subjects, salary_budget,
          notes, thana_name, district_name, status, created_at,
          COALESCE(lng, ST_X(location)) AS lng, COALESCE(lat, ST_Y(location)) AS lat
      `;

      const values: (string | number)[] = [];
      let whereClause = `WHERE status = 'OPEN'`;

      if (params?.lat !== undefined && params?.lng !== undefined) {
        values.push(params.lng, params.lat);
        query += `, ST_Distance(COALESCE(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326))::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters`;

        if (params.radiusMeters) {
          values.push(params.radiusMeters);
          whereClause += ` AND ST_DWithin(COALESCE(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326))::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`;
        }
        query += ` FROM tuition_posts ${whereClause} ORDER BY distance_meters ASC LIMIT ${limit}`;
      } else {
        query += ` FROM tuition_posts ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`;
      }

      const res = await p.query(query, values);
      return {
        posts: res.rows.map(r => ({
          ...r,
          salary_budget: parseFloat(r.salary_budget),
          distance_meters: r.distance_meters ? Math.round(parseFloat(r.distance_meters)) : undefined
        })),
        isLiveDb: true
      };
    } catch (e) {
      console.warn('[Direct DB Query Fallback]:', e);
    }
  }

  // 2. Supabase Client Path
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const query = supabase
        .from('tuition_posts')
        .select('*')
        .eq('status', params?.status || 'OPEN')
        .order('created_at', { ascending: false })
        .limit(limit);

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        let result = data.map((item: Record<string, unknown>) => {
          let distance_meters: number | undefined;
          const itemLat = Number(item.lat);
          const itemLng = Number(item.lng);
          if (params?.lat !== undefined && params?.lng !== undefined) {
            distance_meters = Math.round(getDistanceMeters(params.lat, params.lng, itemLat, itemLng));
          }
          return {
            ...item,
            id: String(item.id),
            guardian_name: String(item.guardian_name || 'Guardian'),
            contact_number: String(item.contact_number || ''),
            class_level: String(item.class_level || ''),
            subjects: Array.isArray(item.subjects) ? (item.subjects as string[]) : [],
            notes: item.notes ? String(item.notes) : undefined,
            thana_name: String(item.thana_name || ''),
            district_name: String(item.district_name || ''),
            lat: itemLat,
            lng: itemLng,
            status: (item.status || 'OPEN') as 'OPEN' | 'MATCHED' | 'CLOSED',
            created_at: String(item.created_at || new Date().toISOString()),
            salary_budget: parseFloat(String(item.salary_budget || 0)),
            distance_meters
          };
        });

        if (params?.lat !== undefined && params?.lng !== undefined) {
          if (params.radiusMeters) {
            result = result.filter(item => (item.distance_meters || 0) <= params.radiusMeters!);
          }
          result.sort((a, b) => (a.distance_meters || 0) - (b.distance_meters || 0));
        }

        return { posts: result, isLiveDb: true };
      }
    } catch (e) {
      console.warn('[Supabase REST Query Fallback]:', e);
    }
  }

  // 3. Resilient In-Memory Spatial Store
  let filtered = [...memoryPosts];
  if (params?.status) {
    filtered = filtered.filter(p => p.status === params.status);
  }

  let result = filtered.map(item => {
    let distance_meters: number | undefined;
    if (params?.lat !== undefined && params?.lng !== undefined) {
      distance_meters = Math.round(getDistanceMeters(params.lat, params.lng, item.lat, item.lng));
    }
    return { ...item, distance_meters };
  });

  if (params?.lat !== undefined && params?.lng !== undefined) {
    if (params.radiusMeters) {
      result = result.filter(item => (item.distance_meters || 0) <= params.radiusMeters!);
    }
    result.sort((a, b) => (a.distance_meters || 0) - (b.distance_meters || 0));
  } else {
    result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  return { posts: result.slice(0, limit), isLiveDb: false };
}

// Insert new tuition post
export async function createTuition(post: {
  guardian_name?: string;
  contact_number?: string;
  class_level: string;
  subjects: string[];
  salary_budget: number;
  notes?: string;
  thana_name: string;
  district_name: string;
  lat: number;
  lng: number;
}): Promise<{ post: TuitionPost; isLiveDb: boolean }> {
  const p = getDbPool();
  const supabase = getSupabaseAdmin();

  const newPost: TuitionPost = {
    id: `post-${Date.now()}`,
    guardian_name: post.guardian_name || 'Guardian',
    contact_number: post.contact_number || '01700-000000',
    class_level: post.class_level,
    subjects: post.subjects,
    salary_budget: Number(post.salary_budget),
    notes: post.notes || '',
    thana_name: post.thana_name,
    district_name: post.district_name,
    lat: post.lat,
    lng: post.lng,
    status: 'OPEN',
    created_at: new Date().toISOString()
  };

  // Always keep in local memory cache
  memoryPosts.unshift(newPost);

  // 1. Try Direct PostgreSQL with PostGIS geometry
  if (p) {
    try {
      await ensureDbSchema();
      const insertQuery = `
        INSERT INTO tuition_posts (
          guardian_name, contact_number, class_level, subjects, salary_budget, notes,
          thana_name, district_name, lat, lng, location
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ST_SetSRID(ST_MakePoint($10, $9), 4326)
        ) RETURNING id, created_at;
      `;
      const res = await p.query(insertQuery, [
        newPost.guardian_name,
        newPost.contact_number,
        newPost.class_level,
        newPost.subjects,
        newPost.salary_budget,
        newPost.notes,
        newPost.thana_name,
        newPost.district_name,
        newPost.lat,
        newPost.lng
      ]);

      if (res.rows.length > 0) {
        newPost.id = res.rows[0].id;
        newPost.created_at = res.rows[0].created_at;
      }
      return { post: newPost, isLiveDb: true };
    } catch (e) {
      console.warn('[Direct DB Insert Fallback]:', e);
    }
  }

  // 2. Try Supabase REST Client
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('tuition_posts')
        .insert({
          guardian_name: newPost.guardian_name,
          contact_number: newPost.contact_number,
          class_level: newPost.class_level,
          subjects: newPost.subjects,
          salary_budget: newPost.salary_budget,
          notes: newPost.notes,
          thana_name: newPost.thana_name,
          district_name: newPost.district_name,
          lat: newPost.lat,
          lng: newPost.lng,
          status: 'OPEN'
        })
        .select()
        .single();

      if (!error && data) {
        newPost.id = data.id;
        newPost.created_at = data.created_at;
        return { post: newPost, isLiveDb: true };
      }
    } catch (e) {
      console.warn('[Supabase REST Insert Fallback]:', e);
    }
  }

  return { post: newPost, isLiveDb: false };
}
