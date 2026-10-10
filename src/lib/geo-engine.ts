import RBush from 'rbush';
import Fuse from 'fuse.js';

export interface ThanaFeature {
  type: 'Feature';
  properties: {
    thana_name: string;
    district_name: string;
    division_name: string;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface LandmarkItem {
  name: string;
  alt_names?: string[];
  thana: string;
  district: string;
  division?: string;
  lat: number;
  lng: number;
  type?: string;
}

interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  index: number;
}

// ---------- Bounds Check for Bangladesh ----------
export const BD_BOUNDS = { minLng: 88.0, maxLng: 92.7, minLat: 20.6, maxLat: 26.6 };

export function isInBangladesh(lng: number, lat: number): boolean {
  return lng >= BD_BOUNDS.minLng && lng <= BD_BOUNDS.maxLng &&
         lat >= BD_BOUNDS.minLat && lat <= BD_BOUNDS.maxLat;
}

export function pointInPolygon(
  [x, y]: [number, number],
  polygon: ThanaFeature | { type?: string; geometry?: { coordinates: number[][][] }; coordinates?: number[][][] }
): boolean {
  const geomCoords = (polygon as ThanaFeature).geometry?.coordinates?.[0];
  const directCoords = (polygon as { coordinates?: number[][][] }).coordinates?.[0];
  const ring = geomCoords || directCoords || (Array.isArray(polygon) ? polygon[0] : null);
  if (!ring || !ring.length) return false;

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

// ---------- State & Indices ----------
let thanaGeoJSON: { features: ThanaFeature[] } | null = null;
const tree = new RBush<RBushItem>();
let searchIndex: Fuse<LandmarkItem> | null = null;
let landmarksData: LandmarkItem[] = [];

// ---------- Initialize Spatial Geo Engine (Cache API + RBush) ----------
export async function initGeoEngine(): Promise<void> {
  if (thanaGeoJSON) return;

  try {
    let json: { features: ThanaFeature[] } | null = null;

    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await caches.open('geo-engine-v1');
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
      const items: RBushItem[] = thanaGeoJSON.features.map((f, i) => {
        const coords = f.geometry.coordinates[0];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of coords) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        return { minX, minY, maxX, maxY, index: i };
      });
      tree.clear();
      tree.load(items);
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
      const cache = await caches.open('geo-engine-v1');
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
      searchIndex = new Fuse(landmarks, {
        keys: [
          { name: 'name', weight: 0.6 },
          { name: 'alt_names', weight: 0.3 },
          { name: 'thana', weight: 0.1 }
        ],
        threshold: 0.35,
        includeScore: true
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

  // O(log n) candidates
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

// ---------- Instant In-Memory Autocomplete ----------
export function searchPlaces(query: string, limit = 6): LandmarkItem[] {
  if (!searchIndex || !query.trim()) return [];
  const results = searchIndex.search(query.trim(), { limit });
  return results.map(r => r.item);
}
