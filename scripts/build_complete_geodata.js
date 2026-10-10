const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function roundCoord(c) {
  if (typeof c[0] === 'number') {
    return [Number(c[0].toFixed(4)), Number(c[1].toFixed(4))];
  }
  return c.map(roundCoord);
}

function computeBboxAndCenter(coords) {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  let sumLng = 0, sumLat = 0, count = 0;

  function walk(c) {
    if (typeof c[0] === 'number') {
      const lng = c[0], lat = c[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      sumLng += lng;
      sumLat += lat;
      count++;
    } else {
      c.forEach(walk);
    }
  }
  walk(coords);

  return {
    bbox: [
      Number(minLng.toFixed(4)),
      Number(minLat.toFixed(4)),
      Number(maxLng.toFixed(4)),
      Number(maxLat.toFixed(4))
    ],
    center: [
      Number((sumLng / count).toFixed(4)),
      Number((sumLat / count).toFixed(4))
    ]
  };
}

// Point-in-polygon test (ray casting)
function isPointInPoly(pt, poly) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findThanaForPoint(lng, lat, thanaFeatures) {
  for (const f of thanaFeatures) {
    const [minX, minY, maxX, maxY] = f.properties.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;

    const geom = f.geometry;
    if (geom.type === 'Polygon') {
      if (isPointInPoly([lng, lat], geom.coordinates[0])) {
        return f.properties;
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (isPointInPoly([lng, lat], poly[0])) {
          return f.properties;
        }
      }
    }
  }
  return null;
}

async function run() {
  console.log('🚀 Starting Nationwide Geospatial Data Pipeline...');

  // 1. Fetch Official 544 Thanas / Upazilas
  console.log('📥 Fetching official Bangladesh Upazila boundaries...');
  const upazilaGeo = await fetchJson('https://raw.githubusercontent.com/ifahimreza/bangladesh-geojson/master/src/data/bangladesh.geojson');
  console.log(`✓ Fetched ${upazilaGeo.features.length} administrative boundaries.`);

  const thanaFeatures = upazilaGeo.features.map(f => {
    const p = f.properties || {};
    const { bbox, center } = computeBboxAndCenter(f.geometry.coordinates);
    const divName = p.division_name ? (p.division_name.endsWith('Division') ? p.division_name : `${p.division_name} Division`) : 'Dhaka Division';

    return {
      type: 'Feature',
      properties: {
        thana_name: p.name || 'Unknown',
        thana_bn_name: p.bn_name || '',
        district_name: p.district_name || 'Dhaka',
        district_bn_name: p.district_bn_name || '',
        division_name: divName,
        division_bn_name: p.division_bn_name || '',
        center,
        bbox
      },
      geometry: {
        type: f.geometry.type,
        coordinates: roundCoord(f.geometry.coordinates)
      }
    };
  });

  const thanasOutput = {
    type: 'FeatureCollection',
    features: thanaFeatures
  };

  const thanasPath = path.join(__dirname, '../public/geo/bd_thanas.min.geojson');
  fs.writeFileSync(thanasPath, JSON.stringify(thanasOutput));
  const thanasKb = (fs.statSync(thanasPath).size / 1024).toFixed(1);
  console.log(`✅ Saved ${thanaFeatures.length} Thanas to ${thanasPath} (${thanasKb} KB)`);

  // 2. Fetch OpenStreetMap Bazars across Bangladesh
  console.log('📥 Fetching OpenStreetMap marketplace/bazar landmarks...');
  const bazarsGeo = await fetchJson('https://raw.githubusercontent.com/ifahimreza/bangladesh-geojson/master/src/data/bd-bazars.geojson');
  console.log(`✓ Fetched ${bazarsGeo.features.length} commercial points.`);

  // 3. Assemble Nationwide Landmark Dataset
  const landmarkMap = new Map();

  function addLandmark(item) {
    if (!item.name || !item.lat || !item.lng) return;
    const key = `${item.name.toLowerCase().trim()}_${item.lat.toFixed(3)}_${item.lng.toFixed(3)}`;
    if (landmarkMap.has(key)) return;
    landmarkMap.set(key, {
      id: item.id || `lm-${landmarkMap.size + 1}`,
      name: item.name.trim(),
      name_bn: item.name_bn || '',
      category: item.category || 'landmark',
      lat: Number(item.lat.toFixed(4)),
      lng: Number(item.lng.toFixed(4)),
      thana: item.thana || '',
      district: item.district || '',
      division: item.division || ''
    });
  }

  // 3.1 Existing curated high-priority landmarks (BUET, DMC, universities, colleges)
  const existingPath = path.join(__dirname, '../public/geo/bd_landmarks.json');
  if (fs.existsSync(existingPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      if (Array.isArray(existing)) {
        existing.forEach(addLandmark);
        console.log(`✓ Preserved ${existing.length} existing high-profile institutions.`);
      }
    } catch (e) {
      console.warn('Could not read existing landmarks:', e.message);
    }
  }

  // 3.2 Add ALL 544 Thana Centers / Sadars (Guarantees every Upazila is searchable!)
  thanaFeatures.forEach((tf, idx) => {
    const p = tf.properties;
    addLandmark({
      id: `thana-${idx + 1}`,
      name: `${p.thana_name} Sadar`,
      name_bn: p.thana_bn_name ? `${p.thana_bn_name} সদর` : '',
      category: 'hub',
      lat: p.center[1],
      lng: p.center[0],
      thana: p.thana_name,
      district: p.district_name,
      division: p.division_name
    });
  });

  // 3.3 Add all 3,478 OpenStreetMap Bazars with spatial matching
  console.log('📍 Spatially indexing and linking OpenStreetMap bazars...');
  let bazarAdded = 0;
  for (const bf of bazarsGeo.features) {
    if (!bf.geometry || !bf.geometry.coordinates) continue;
    const [lng, lat] = bf.geometry.coordinates;
    const name = bf.properties.name || bf.properties.bn_name;
    if (!name || name.length < 2) continue;

    const matchedThana = findThanaForPoint(lng, lat, thanaFeatures);

    addLandmark({
      id: `osm-bazar-${bf.id || bazarAdded}`,
      name: bf.properties.name || name,
      name_bn: bf.properties.bn_name || '',
      category: 'commercial',
      lat,
      lng,
      thana: matchedThana ? matchedThana.thana_name : (bf.properties.upazila || ''),
      district: matchedThana ? matchedThana.district_name : (bf.properties.district || ''),
      division: matchedThana ? matchedThana.division_name : ''
    });
    bazarAdded++;
  }
  console.log(`✓ Added ${bazarAdded} OpenStreetMap commercial centers.`);

  // 4. Save Final Nationwide Landmark Dataset
  const allLandmarks = Array.from(landmarkMap.values());
  fs.writeFileSync(existingPath, JSON.stringify(allLandmarks, null, 2));
  const landmarksKb = (fs.statSync(existingPath).size / 1024).toFixed(1);
  console.log(`🎉 Nationwide landmarks successfully built: ${allLandmarks.length} items (${landmarksKb} KB)`);
}

run().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
