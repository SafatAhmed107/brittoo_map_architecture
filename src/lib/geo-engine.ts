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

// ---------- State & Indices ----------
let thanaGeoJSON: { features: ThanaFeature[] } | null = null;
const tree = new RBush<RBushItem>();
let allTreeItems: RBushItem[] = [];
let searchIndex: Fuse<LandmarkItem> | null = null;
let landmarksData: LandmarkItem[] = [];

// ---------- Initialize Spatial Geo Engine (Cache API + RBush) ----------
export async function initGeoEngine(): Promise<void> {
  if (thanaGeoJSON && allTreeItems.length > 0) return;

  try {
    let json: { features: ThanaFeature[] } | null = null;

    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await caches.open('geo-engine-v5');
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
      const cache = await caches.open('geo-engine-v5');
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
          { name: 'name', weight: 0.5 },
          { name: 'name_bn', weight: 0.45 },
          { name: 'alt_names', weight: 0.3 },
          { name: 'thana', weight: 0.25 },
          { name: 'district', weight: 0.2 },
          { name: 'category', weight: 0.1 },
          { name: 'type', weight: 0.1 }
        ],
        threshold: 0.38,
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
      const cache = await caches.open('geo-engine-v5');
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

      if (added > 0 && searchIndex) {
        searchIndex.setCollection(landmarksData);
      }
      return true;
    }
  } catch (err) {
    console.warn(`Could not load cluster for district ${districtName}:`, err);
  }
  return false;
}

// ---------- Instant In-Memory Proximity-Biased Autocomplete ----------
export function searchPlaces(
  query: string,
  limit = 7,
  userCoords?: { lat: number; lng: number }
): LandmarkItem[] {
  if (!searchIndex || !query.trim()) return [];

  const searchLimit = userCoords ? Math.min(limit * 3, 25) : limit;
  const results = searchIndex.search(query.trim(), { limit: searchLimit });

  if (!userCoords || results.length <= 1) {
    return results.slice(0, limit).map(r => r.item);
  }

  const { lat: uLat, lng: uLng } = userCoords;
  const cosLat = Math.cos((uLat * Math.PI) / 180);

  // Proximity-decay ranking: lower score is better in Fuse.js
  const ranked = results.map(r => {
    const dLat = (r.item.lat - uLat) * 111.0;
    const dLng = (r.item.lng - uLng) * 111.0 * cosLat;
    const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

    const baseScore = r.score ?? 0.4;
    const adjustedScore = baseScore * (1 + distKm * 0.035);

    return {
      item: r.item,
      adjustedScore,
      distKm
    };
  });

  ranked.sort((a, b) => a.adjustedScore - b.adjustedScore);
  return ranked.slice(0, limit).map(r => r.item);
}
