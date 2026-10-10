import { getConfig } from './config';

export interface InvalidationResult {
  purgedTiles: Array<{ z: number; x: number; y: number }>;
  urls: string[];
  success: boolean;
  message: string;
}

/**
 * Calculates the exact slippy map tile coordinates (z, x, y) for zoom levels 10-16
 * containing the given (lng, lat) and purges them from Cloudflare Edge cache.
 */
export async function invalidateAffectedTiles(
  lng: number,
  lat: number,
  baseUrl = 'https://api.tuitionmedia.com'
): Promise<InvalidationResult> {
  const config = getConfig();
  const tileUrls: string[] = [];
  const purgedTiles: Array<{ z: number; x: number; y: number }> = [];

  const latRad = (lat * Math.PI) / 180;

  for (let z = 10; z <= 16; z++) {
    const n = Math.pow(2, z);
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );

    purgedTiles.push({ z, x, y });
    tileUrls.push(`${baseUrl}/api/tiles/tuitions/${z}/${x}/${y}.pbf`);
  }

  // If Cloudflare credentials are not provided, log and return simulation status
  if (!config.cloudflareZoneId || !config.cloudflareApiToken) {
    console.info(
      `[Surgical Cache Purge Simulation] Invalidated ${purgedTiles.length} tiles for (${lat.toFixed(4)}, ${lng.toFixed(4)}) across z10-z16:`,
      purgedTiles
    );
    return {
      purgedTiles,
      urls: tileUrls,
      success: true,
      message: 'Simulated: Cloudflare credentials not set in keys.txt (local mode).'
    };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.cloudflareZoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.cloudflareApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ files: tileUrls })
      }
    );

    const json = await res.json();
    if (!res.ok || !json.success) {
      console.error('[Cloudflare Purge Error]', json);
      return {
        purgedTiles,
        urls: tileUrls,
        success: false,
        message: json.errors?.[0]?.message || 'Purge failed'
      };
    }

    console.info(`[Cloudflare Purge Success] Purged ${tileUrls.length} tiles.`);
    return {
      purgedTiles,
      urls: tileUrls,
      success: true,
      message: `Successfully purged ${tileUrls.length} edge tiles (z10-z16).`
    };
  } catch (error: unknown) {
    console.error('[Cloudflare Purge Exception]', error);
    return {
      purgedTiles,
      urls: tileUrls,
      success: false,
      message: error instanceof Error ? error.message : 'Unknown network error during purge'
    };
  }
}
