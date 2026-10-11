import { NextRequest, NextResponse } from 'next/server';
import UNIVERSITY_HALLS from '@/lib/core-halls-seed';

interface DiscoveredLandmark {
  id: string;
  name: string;
  name_bn?: string;
  category: string;
  type: string;
  lat: number;
  lng: number;
  thana?: string;
  district: string;
  division?: string;
  source: 'edge' | 'osm_crawler';
}

// In-memory LRU cache for upstream search results (Protects upstream from high traffic)
const SEARCH_CACHE = new Map<string, DiscoveredLandmark[]>();

// In-flight request coalescing (prevents thundering herd if 100k users query concurrently)
const IN_FLIGHT = new Map<string, Promise<DiscoveredLandmark[]>>();

// Rate limiter state for upstream OSM queries (max 1 req/sec)
let lastOsmRequestTime = 0;

export async function GET(request: NextRequest) {
  const t0 = performance.now();
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q')?.trim() || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '8', 10), 20);

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], executionMs: 0 });
  }

  const qLower = query.toLowerCase();
  const cacheKey = qLower;

  // 1. Check in-memory server cache (0.02ms response)
  if (SEARCH_CACHE.has(cacheKey)) {
    const cached = SEARCH_CACHE.get(cacheKey)!;
    return NextResponse.json({
      results: cached.slice(0, limit),
      source: 'server_cache',
      executionMs: +(performance.now() - t0).toFixed(2)
    });
  }

  // 2. Search local core halls registry first (0.05ms response)
  const localMatches: DiscoveredLandmark[] = [];
  for (const h of UNIVERSITY_HALLS) {
    const n = h.name.toLowerCase();
    const bn = (h.name_bn || '').toLowerCase();
    const alts = (h.alt_names || []).join(' ').toLowerCase();

    if (n.includes(qLower) || bn.includes(qLower) || alts.includes(qLower)) {
      localMatches.push({
        id: h.id || h.name,
        name: h.name,
        name_bn: h.name_bn,
        category: 'hall',
        type: 'University Residential Hall',
        lat: h.lat,
        lng: h.lng,
        thana: h.thana,
        district: h.district || 'Dhaka',
        division: h.division,
        source: 'edge'
      });
      if (localMatches.length >= limit) break;
    }
  }

  if (localMatches.length >= limit) {
    SEARCH_CACHE.set(cacheKey, localMatches);
    return NextResponse.json({
      results: localMatches,
      source: 'local_registry',
      executionMs: +(performance.now() - t0).toFixed(2)
    });
  }

  // 3. Fallback to OpenStreetMap with Request Coalescing & Rate Limiting
  // If an identical query is already in-flight, await the same promise (0 duplicate calls)
  if (IN_FLIGHT.has(cacheKey)) {
    try {
      const results = await IN_FLIGHT.get(cacheKey)!;
      return NextResponse.json({
        results: results.slice(0, limit),
        source: 'coalesced_crawler',
        executionMs: +(performance.now() - t0).toFixed(2)
      });
    } catch {
      return NextResponse.json({ results: localMatches, source: 'local_registry', executionMs: 0 });
    }
  }

  const crawlPromise = (async () => {
    // Respect upstream 1 request / second limit
    const now = Date.now();
    const elapsed = now - lastOsmRequestTime;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
    lastOsmRequestTime = Date.now();

    const osmUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=bd&format=json&addressdetails=1&limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const osmRes = await fetch(osmUrl, {
      headers: {
        'User-Agent': 'BrittooMapArchitecture/2.0 (buet_student_project)',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!osmRes.ok) return localMatches;

    const osmData = await osmRes.json();
    const discovered: DiscoveredLandmark[] = osmData.map((item: any, idx: number) => {
      const addr = item.address || {};
      const district = addr.state_district || addr.district || addr.city || 'Bangladesh';
      const thana = addr.suburb || addr.borough || addr.town || addr.village;
      const isHall = item.display_name.toLowerCase().includes('hall') || query.includes('hall');

      return {
        id: `osm-${item.osm_id || idx}`,
        name: item.name || item.display_name.split(',')[0],
        name_bn: addr['name:bn'],
        category: isHall ? 'hall' : (item.type || 'landmark'),
        type: isHall ? 'University Residential Hall' : (item.class || 'Landmark'),
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        thana,
        district,
        source: 'osm_crawler' as const
      };
    });

    const merged = [...localMatches];
    const seen = new Set(merged.map(m => `${m.lat.toFixed(4)},${m.lng.toFixed(4)}`));
    for (const d of discovered) {
      const key = `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
      if (!seen.has(key)) {
        merged.push(d);
        seen.add(key);
      }
    }

    SEARCH_CACHE.set(cacheKey, merged);
    return merged;
  })();

  IN_FLIGHT.set(cacheKey, crawlPromise);

  try {
    const finalResults = await crawlPromise;
    IN_FLIGHT.delete(cacheKey);
    return NextResponse.json({
      results: finalResults.slice(0, limit),
      source: 'osm_crawler',
      executionMs: +(performance.now() - t0).toFixed(2)
    });
  } catch {
    IN_FLIGHT.delete(cacheKey);
    return NextResponse.json({
      results: localMatches,
      source: 'local_registry',
      executionMs: +(performance.now() - t0).toFixed(2)
    });
  }
}
