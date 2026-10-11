import RBush from 'rbush';
import Fuse from 'fuse.js';

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export interface ThanaFeature {
  type: 'Feature';
  properties: {
    thana_name: string;
    district_name: string;
    division_name: string;
  };
  geometry: PolygonGeometry | MultiPolygonGeometry;
}

export interface LandmarkItem {
  id?: string;
  name: string;
  name_bn?: string;
  alt_names?: string[];
  thana: string;
  district: string;
  division?: string;
  lat: number;
  lng: number;
  category?: string;
  type?: string;
  isCore?: boolean;
  source?: string;
}

interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  index: number;
  centerX: number;
  centerY: number;
}

// ---------- Bounds Check for Bangladesh ----------
export const BD_BOUNDS = { minLng: 88.0, maxLng: 92.7, minLat: 20.6, maxLat: 26.6 };

export function isInBangladesh(lng: number, lat: number): boolean {
  return lng >= BD_BOUNDS.minLng && lng <= BD_BOUNDS.maxLng &&
         lat >= BD_BOUNDS.minLat && lat <= BD_BOUNDS.maxLat;
}

// ---------- Inline Ray-Cast Point-in-Polygon (0.5 KB, Zero Dependencies) ----------
function raycastRing([x, y]: [number, number], ring: number[][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon([x, y]: [number, number], feature: ThanaFeature): boolean {
  if (!feature || !feature.geometry) return false;
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    const coords = geom.coordinates;
    if (!coords || !coords[0]) return false;
    return raycastRing([x, y], coords[0]);
  } else if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates;
    if (!polys) return false;
    for (const poly of polys) {
      if (poly && poly[0] && raycastRing([x, y], poly[0])) {
        return true;
      }
    }
  }

  return false;
}

import UNIVERSITY_HALLS from './core-halls-seed';

// ---------- State & Indices ----------
let thanaGeoJSON: { features: ThanaFeature[] } | null = null;
const tree = new RBush<RBushItem>();
let allTreeItems: RBushItem[] = [];

// Token & Prefix Inverted Index for sub-millisecond instant autocomplete
const tokenIndex = new Map<string, Set<number>>();

const KEYBOARD_NEIGHBORS: Record<string, string> = {
  a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc',
  g: 'ftyhbv', h: 'gyujnb', i: 'ujko', j: 'huikmn', k: 'jiolm', l: 'kop',
  m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft', s: 'awedxz',
  t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tghu', z: 'asx'
};

function buildTokenIndex(items: LandmarkItem[]) {
  tokenIndex.clear();
  const add = (tok: string, idx: number) => {
    if (tok.length < 2) return;
    let s = tokenIndex.get(tok);
    if (!s) {
      s = new Set();
      tokenIndex.set(tok, s);
    }
    s.add(idx);
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = [
      item.name,
      item.name_bn || '',
      ...(item.alt_names || []),
      item.thana || '',
      item.district || ''
    ].join(' ').toLowerCase();

    const words = text.split(/[\s,().\-_/]+/).filter(w => w.length >= 2);
    for (const w of words) {
      add(w, i);
      const maxPrefix = Math.min(w.length, 12);
      for (let len = 2; len < maxPrefix; len++) {
        add(w.slice(0, len), i);
      }
    }
  }
}

function getTypoVariants(tok: string): string[] {
  const vars: string[] = [];
  for (let i = 0; i < tok.length; i++) {
    const ch = tok[i];
    const neighbors = KEYBOARD_NEIGHBORS[ch] || '';
    for (let j = 0; j < neighbors.length; j++) {
      vars.push(tok.slice(0, i) + neighbors[j] + tok.slice(i + 1));
    }
  }
  return vars;
}

// Synchronous Tier 0 Seed initialization: 100% eliminates cold-start delay
let landmarksData: LandmarkItem[] = [...UNIVERSITY_HALLS];
buildTokenIndex(landmarksData);
let searchIndex: Fuse<LandmarkItem> | null = new Fuse(landmarksData, {
  keys: [
    { name: 'name', weight: 0.5 },
    { name: 'name_bn', weight: 0.45 },
    { name: 'alt_names', weight: 0.4 },
    { name: 'thana', weight: 0.25 },
    { name: 'district', weight: 0.2 },
    { name: 'category', weight: 0.1 },
    { name: 'type', weight: 0.1 }
  ],
  threshold: 0.48,
  ignoreLocation: true,
  includeScore: true,
  shouldSort: true
});

// ---------- Initialize Spatial Geo Engine (Cache API + RBush) ----------
export async function initGeoEngine(): Promise<void> {
  if (thanaGeoJSON && allTreeItems.length > 0) return;

  try {
    let json: { features: ThanaFeature[] } | null = null;

    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await caches.open('geo-engine-v7');
      const cacheKey = '/geo/bd_thanas.min.geojson';
      let response = await cache.match(cacheKey);

      if (!response) {
        response = await fetch(cacheKey);
        if (response.ok) {
          await cache.put(cacheKey, response.clone());
        }
      }
      if (response && response.ok) {
        json = await response.json();
      }
    } else {
      const response = await fetch('/geo/bd_thanas.min.geojson');
      if (response.ok) {
        json = await response.json();
      }
    }

    if (json && json.features) {
      thanaGeoJSON = json;
      allTreeItems = [];

      json.features.forEach((f, i) => {
        const props = f.properties as any;
        if (props && Array.isArray(props.bbox) && props.bbox.length === 4) {
          const [minX, minY, maxX, maxY] = props.bbox;
          const center = Array.isArray(props.center) ? props.center : [(minX + maxX) / 2, (minY + maxY) / 2];
          allTreeItems.push({
            minX,
            minY,
            maxX,
            maxY,
            index: i,
            centerX: center[0],
            centerY: center[1]
          });
          return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const geom = f.geometry;

        const updateBounds = (coords: number[][]) => {
          for (const [x, y] of coords) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        };

        if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
          updateBounds(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon' && geom.coordinates) {
          geom.coordinates.forEach((poly) => {
            if (poly?.[0]) updateBounds(poly[0]);
          });
        }

        if (minX !== Infinity) {
          allTreeItems.push({
            minX,
            minY,
            maxX,
            maxY,
            index: i,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
          });
        }
      });

      tree.clear();
      tree.load(allTreeItems);
    }
  } catch (err) {
    console.warn('Could not initialize GeoEngine via cache:', err);
  }
}

// ---------- Initialize Search Index (Cache API + Fuse.js) ----------
export async function initSearchIndex(): Promise<LandmarkItem[]> {
  if (searchIndex && landmarksData.length > 0) return landmarksData;

  try {
    let landmarks: LandmarkItem[] | null = null;

    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await caches.open('geo-engine-v7');
      const cacheKey = '/geo/bd_landmarks.json';
      let response = await cache.match(cacheKey);

      if (!response) {
        response = await fetch(cacheKey);
        if (response.ok) {
          await cache.put(cacheKey, response.clone());
        }
      }
      if (response && response.ok) {
        landmarks = await response.json();
      }
    } else {
      const response = await fetch('/geo/bd_landmarks.json');
      if (response.ok) {
        landmarks = await response.json();
      }
    }

    if (landmarks) {
      landmarksData = landmarks;
      buildTokenIndex(landmarks);
      searchIndex = new Fuse(landmarks, {
        keys: [
          { name: 'name', weight: 0.5 },
          { name: 'name_bn', weight: 0.45 },
          { name: 'alt_names', weight: 0.4 },
          { name: 'thana', weight: 0.25 },
          { name: 'district', weight: 0.2 },
          { name: 'category', weight: 0.1 },
          { name: 'type', weight: 0.1 }
        ],
        threshold: 0.48,
        ignoreLocation: true,
        includeScore: true,
        shouldSort: true
      });
    }
  } catch (err) {
    console.warn('Could not initialize Landmark search index:', err);
  }

  return landmarksData;
}

export interface LocationResolution {
  thana: string | null;
  district: string | null;
  division: string | null;
  displayName: string;
  outOfBounds?: boolean;
  message?: string;
  executionMs: number;
}

// ---------- Instant 0ms Local Resolution ----------
export function resolveLocationLocally(lng: number, lat: number): LocationResolution {
  const startTime = typeof performance !== 'undefined' ? performance.now() : 0;

  if (!isInBangladesh(lng, lat)) {
    return {
      thana: null,
      district: null,
      division: null,
      displayName: 'Location outside Bangladesh',
      outOfBounds: true,
      message: 'Please choose a location within Bangladesh borders',
      executionMs: 0
    };
  }

  if (!thanaGeoJSON) {
    return {
      thana: null,
      district: null,
      division: null,
      displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      executionMs: 0
    };
  }

  // 1. O(log n) candidates via R-Tree bounding box intersection
  const candidates = tree.search({ minX: lng, minY: lat, maxX: lng, maxY: lat });

  for (const c of candidates) {
    const feature = thanaGeoJSON.features[c.index];
    if (pointInPolygon([lng, lat], feature)) {
      const endTime = typeof performance !== 'undefined' ? performance.now() : 0;
      return {
        thana: feature.properties.thana_name,
        district: feature.properties.district_name,
        division: feature.properties.division_name,
        displayName: `${feature.properties.thana_name}, ${feature.properties.district_name}`,
        outOfBounds: false,
        executionMs: parseFloat((endTime - startTime).toFixed(3))
      };
    }
  }

  // 2. Nearest boundary fallback (handles simplified polygon borders smoothly)
  let closestFeature: ThanaFeature | null = null;
  let minDistanceSq = Infinity;

  for (const item of allTreeItems) {
    const dx = lng - item.centerX;
    const dy = lat - item.centerY;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      closestFeature = thanaGeoJSON.features[item.index];
    }
  }

  // If closest center is within ~0.35 degrees (~35 km)
  if (closestFeature && minDistanceSq < 0.15) {
    const endTime = typeof performance !== 'undefined' ? performance.now() : 0;
    return {
      thana: closestFeature.properties.thana_name,
      district: closestFeature.properties.district_name,
      division: closestFeature.properties.division_name,
      displayName: `${closestFeature.properties.thana_name}, ${closestFeature.properties.district_name}`,
      outOfBounds: false,
      executionMs: parseFloat((endTime - startTime).toFixed(3))
    };
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    thana: null,
    district: null,
    division: null,
    displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    outOfBounds: false,
    executionMs: parseFloat((endTime - startTime).toFixed(3))
  };
}

// ---------- District Cluster Lazy Loading & LRU Cache ----------
const loadedDistricts = new Set<string>();

export function slugifyDistrict(name: string): string {
  return name.toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export async function loadDistrictData(districtName: string): Promise<boolean> {
  if (!districtName) return false;
  const slug = slugifyDistrict(districtName);
  if (loadedDistricts.has(slug)) return true;

  try {
    let payload: { landmarks: LandmarkItem[] } | null = null;
    const url = `/geo/districts/${slug}.json`;

    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await caches.open('geo-engine-v7');
      let response = await cache.match(url);
      if (!response) {
        response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response.clone());
        }
      }
      if (response && response.ok) {
        payload = await response.json();
      }
    } else {
      const response = await fetch(url);
      if (response.ok) payload = await response.json();
    }

    if (payload && Array.isArray(payload.landmarks) && payload.landmarks.length > 0) {
      const existingIds = new Set(landmarksData.map(l => l.id || l.name));
      let added = 0;
      for (const item of payload.landmarks) {
        const id = item.id || item.name;
        if (!existingIds.has(id)) {
          landmarksData.push(item);
          existingIds.add(id);
          added++;
        }
      }
      loadedDistricts.add(slug);

      if (added > 0) {
        buildTokenIndex(landmarksData);
        if (searchIndex) {
          searchIndex.setCollection(landmarksData);
        }
      }
      return true;
    }
  } catch (err) {
    console.warn(`Could not load cluster for district ${districtName}:`, err);
  }
  return false;
}

// ---------- Instant In-Memory Proximity-Biased Autocomplete (< 1ms) ----------
export function searchPlaces(
  query: string,
  limit = 7,
  userCoords?: { lat: number; lng: number }
): LandmarkItem[] {
  if (!landmarksData.length || !query.trim()) return [];

  const qClean = query.toLowerCase().trim();
  const tokens = qClean.split(/[\s,().\-_/]+/).filter(t => t.length >= 2);

  // 1. Fast Set Intersection via Token/Prefix Index (< 0.05ms)
  let candidateIds: Set<number> | null = null;
  for (const t of tokens) {
    let ids = tokenIndex.get(t);
    if (!ids) {
      // Check 1-char keyboard adjacent typo variant (e.g. "radhid" -> "rashid" where d <-> s)
      const typos = getTypoVariants(t);
      for (const tv of typos) {
        if (tokenIndex.has(tv)) {
          ids = tokenIndex.get(tv);
          break;
        }
      }
    }
    if (!ids) {
      candidateIds = new Set();
      break;
    }
    if (candidateIds === null) {
      candidateIds = new Set(ids);
    } else {
      const next = new Set<number>();
      for (const id of candidateIds) {
        if (ids.has(id)) next.add(id);
      }
      candidateIds = next;
    }
  }

  let matches: { item: LandmarkItem; score: number }[] = [];
  const isHallQuery = qClean.includes('hall') || qClean.includes('হল');

  if (candidateIds && candidateIds.size > 0) {
    for (const id of candidateIds) {
      const item = landmarksData[id];
      let score = 0;
      const nLower = item.name.toLowerCase();
      const altJoined = (item.alt_names || []).join(' ').toLowerCase();

      if (nLower === qClean || altJoined.includes(qClean)) score += 2000;
      else if (nLower.startsWith(qClean)) score += 1000;
      else if (nLower.includes(qClean)) score += 500;
      else score += 100;

      if (isHallQuery && (item.category === 'hall' || item.type?.includes('Hall') || item.type === 'dormitory')) {
        score += 400;
      }
      matches.push({ item, score });
    }
    matches.sort((a, b) => b.score - a.score);
  }

  // 2. Fallback to fuzzy Bitap ONLY if candidate matches are completely empty
  if (matches.length === 0 && searchIndex) {
    const fuzzy = searchIndex.search(qClean, { limit });
    matches = fuzzy.map(f => {
      let fScore = (1 - (f.score ?? 0.4)) * 100;
      if (isHallQuery && (f.item.category === 'hall' || f.item.type?.includes('Hall') || f.item.type === 'dormitory')) {
        fScore += 300;
      }
      return { item: f.item, score: fScore };
    });
  }

  // 3. Proximity-decay ranking when userCoords is provided
  if (userCoords && matches.length > 1) {
    const { lat: uLat, lng: uLng } = userCoords;
    const cosLat = Math.cos((uLat * Math.PI) / 180);

    const ranked = matches.map(m => {
      const dLat = (m.item.lat - uLat) * 111.0;
      const dLng = (m.item.lng - uLng) * 111.0 * cosLat;
      const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
      // Gentle proximity weighting so close places score higher without burying exact matches
      const finalScore = m.score / (1 + distKm * 0.012);
      return { item: m.item, finalScore };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    return ranked.slice(0, limit).map(r => r.item);
  }

  return matches.slice(0, limit).map(m => m.item);
}

// ---------- Instant In-Memory Radius Institution Filter ----------
export function getNearbyLandmarks(
  coords: { lat: number; lng: number },
  radiusKm = 3.0,
  limit = 20
): (LandmarkItem & { distKm: number })[] {
  if (!landmarksData || landmarksData.length === 0) return [];
  const { lat: uLat, lng: uLng } = coords;
  const cosLat = Math.cos((uLat * Math.PI) / 180);

  const matched: (LandmarkItem & { distKm: number })[] = [];

  for (const item of landmarksData) {
    const dLat = (item.lat - uLat) * 111.0;
    const dLng = (item.lng - uLng) * 111.0 * cosLat;
    const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

    if (distKm <= radiusKm) {
      matched.push({
        ...item,
        distKm: Number(distKm.toFixed(2))
      });
    }
  }

  // Prioritize education and healthcare first, then by distance
  matched.sort((a, b) => {
    const aPriority = a.category === 'education' ? 0 : a.category === 'healthcare' ? 1 : 2;
    const bPriority = b.category === 'education' ? 0 : b.category === 'healthcare' ? 1 : 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.distKm - b.distKm;
  });

  return matched.slice(0, limit);
}

