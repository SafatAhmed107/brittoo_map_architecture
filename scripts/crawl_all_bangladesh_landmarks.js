const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Slugify helper
function slugify(name) {
  if (!name) return 'unknown';
  return name.toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
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

// Distance helper in meters
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getCentroid(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  if (geometry.type === 'Point') {
    return [geometry.coordinates[0], geometry.coordinates[1]];
  }
  let sumLng = 0, sumLat = 0, count = 0;
  function walk(c) {
    if (typeof c[0] === 'number') {
      sumLng += c[0];
      sumLat += c[1];
      count++;
    } else if (Array.isArray(c)) {
      c.forEach(walk);
    }
  }
  walk(geometry.coordinates);
  if (count === 0) return null;
  return [sumLng / count, sumLat / count];
}

async function run() {
  console.log('🚀 Starting Comprehensive Bangladesh Landmark Harvesting Pipeline...');

  // 1. Load 544 Thanas
  const thanasPath = path.join(__dirname, '../public/geo/bd_thanas.min.geojson');
  if (!fs.existsSync(thanasPath)) {
    console.error('Missing bd_thanas.min.geojson');
    process.exit(1);
  }
  const thanasGeo = JSON.parse(fs.readFileSync(thanasPath, 'utf8'));
  const thanaFeatures = thanasGeo.features;
  console.log(`✓ Loaded ${thanaFeatures.length} Thana polygon boundaries.`);

  // Prepare District maps
  const districtMap = new Map();
  thanaFeatures.forEach(f => {
    const dName = f.properties.district_name ? f.properties.district_name.trim() : 'Dhaka';
    const slug = slugify(dName);
    if (!districtMap.has(slug)) {
      districtMap.set(slug, {
        district_name: dName,
        district_bn_name: f.properties.district_bn_name || '',
        slug,
        division: f.properties.division_name || '',
        division_bn_name: f.properties.division_bn_name || '',
        thanas: [],
        landmarks: []
      });
    }
    const d = districtMap.get(slug);
    d.thanas.push({
      thana_name: f.properties.thana_name,
      thana_bn_name: f.properties.thana_bn_name,
      center: f.properties.center,
      bbox: f.properties.bbox
    });
  });
  console.log(`✓ Initialized ${districtMap.size} District containers.`);

  // Spatial deduplication index: 0.005 degree grid (~500m buckets)
  const spatialGrid = new Map();
  function getGridKey(lat, lng) {
    const gx = Math.floor(lat / 0.005);
    const gy = Math.floor(lng / 0.005);
    return `${gx}_${gy}`;
  }

  const allHarvested = [];
  let duplicateCount = 0;

  function tryAddLandmark(item) {
    if (!item.name || item.name.trim().length < 2) return false;
    if (typeof item.lat !== 'number' || typeof item.lng !== 'number') return false;
    if (item.lat < 20.6 || item.lat > 26.6 || item.lng < 88.0 || item.lng > 92.7) return false;

    const normName = item.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const gKey = getGridKey(item.lat, item.lng);

    // Check neighbouring grid cells
    const [gxStr, gyStr] = gKey.split('_');
    const gx = parseInt(gxStr, 10);
    const gy = parseInt(gyStr, 10);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${gx + dx}_${gy + dy}`;
        const existingList = spatialGrid.get(neighborKey);
        if (existingList) {
          for (const existing of existingList) {
            const dist = distanceMeters(item.lat, item.lng, existing.lat, existing.lng);
            if (dist < 120) {
              const exNorm = existing.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
              if (exNorm === normName || exNorm.includes(normName) || normName.includes(exNorm)) {
                // Duplicate! Merge attributes if candidate is richer
                if (!existing.name_bn && item.name_bn) existing.name_bn = item.name_bn;
                duplicateCount++;
                return false;
              }
            }
          }
        }
      }
    }

    // Add to spatial grid
    if (!spatialGrid.has(gKey)) spatialGrid.set(gKey, []);
    spatialGrid.get(gKey).push(item);
    allHarvested.push(item);
    return true;
  }

  // 2. Add ALL 544 Thana Centers / Sadars (Guaranteed baseline hubs)
  console.log('🏛️ Adding 544 Thana Sadars...');
  thanaFeatures.forEach((tf, idx) => {
    const p = tf.properties;
    tryAddLandmark({
      id: `thana-${idx + 1}`,
      name: `${p.thana_name} Sadar`,
      name_bn: p.thana_bn_name ? `${p.thana_bn_name} সদর` : '',
      category: 'hub',
      lat: Number(p.center[1].toFixed(4)),
      lng: Number(p.center[0].toFixed(4)),
      thana: p.thana_name,
      district: p.district_name,
      division: p.division_name,
      isCore: true
    });
  });

  // 3. Add Existing Curated High-Profile Landmarks (Universities, BUET, Medical Colleges)
  const existingPath = path.join(__dirname, '../public/geo/bd_landmarks.json');
  if (fs.existsSync(existingPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      console.log(`📚 Ingesting existing curated landmarks (${existing.length})...`);
      existing.forEach(e => {
        tryAddLandmark({
          ...e,
          isCore: true
        });
      });
    } catch (e) {
      console.warn('Could not read existing landmarks:', e.message);
    }
  }

  // 4. Ingest 14,052 HDX Education Facilities (Universities, Colleges, High Schools, Madrasas)
  const eduPath = path.join(__dirname, '../scratch/hdx_edu/education_facilities.geojson');
  if (fs.existsSync(eduPath)) {
    console.log('🎓 Ingesting HDX Bangladesh Education Facilities...');
    const edu = JSON.parse(fs.readFileSync(eduPath, 'utf8'));
    let eduAdded = 0;
    edu.features.forEach(f => {
      const p = f.properties || {};
      const name = (p.name || p.name_latin || p.name_en || p.name_bn || '').trim();
      if (!name || name.length < 2) return;

      const centroid = getCentroid(f.geometry);
      if (!centroid) return;
      const [lng, lat] = centroid;
      let category = 'education';
      const amenity = (p.amenity || '').toLowerCase();
      const isHigherEd = amenity === 'university' || amenity === 'college' || name.toLowerCase().includes('university') || name.toLowerCase().includes('college');

      let district = p.adm2_name || '';
      let thana = p.adm3_name || '';
      let division = p.adm1_name || '';

      if (!district || !thana) {
        const matched = findThanaForPoint(lng, lat, thanaFeatures);
        if (matched) {
          thana = matched.thana_name;
          district = matched.district_name;
          division = matched.division_name;
        }
      }

      const added = tryAddLandmark({
        id: `edu-${p.id ? p.id.replace(/\//g, '_') : eduAdded}`,
        name,
        name_bn: p.name_bn || '',
        category,
        type: amenity || 'school',
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
        thana,
        district,
        division,
        isCore: isHigherEd
      });
      if (added) eduAdded++;
    });
    console.log(`✓ Added ${eduAdded} educational institutions.`);
  }

  // 5. Ingest HDX Points of Interest (Hospitals, Bazars, Transit, Banks)
  const poiPath = path.join(__dirname, '../scratch/hdx_poi/points_of_interest.geojson');
  if (fs.existsSync(poiPath)) {
    console.log('🏥 Ingesting HDX Bangladesh Points of Interest...');
    const poi = JSON.parse(fs.readFileSync(poiPath, 'utf8'));
    let poiAdded = 0;

    const allowedAmenities = new Set([
      'hospital', 'clinic', 'pharmacy', 'marketplace',
      'bus_station', 'ferry_terminal', 'railway_station',
      'bank', 'townhall', 'police', 'fire_station'
    ]);

    poi.features.forEach(f => {
      const p = f.properties || {};
      const name = (p.name || p.name_latin || p.name_en || p.name_bn || '').trim();
      if (!name || name.length < 3) return;

      const amenity = (p.amenity || '').toLowerCase();
      const shop = (p.shop || '').toLowerCase();
      const tourism = (p.tourism || '').toLowerCase();

      let category = null;
      let isCore = false;

      if (amenity === 'hospital' || amenity === 'clinic') {
        category = 'healthcare';
        isCore = amenity === 'hospital';
      } else if (amenity === 'marketplace' || shop === 'supermarket' || shop === 'mall') {
        category = 'commercial';
        isCore = true;
      } else if (amenity === 'bus_station' || amenity === 'ferry_terminal' || amenity === 'railway_station') {
        category = 'transit';
        isCore = true;
      } else if (amenity === 'bank') {
        category = 'financial';
      } else if (tourism === 'attraction' || tourism === 'museum') {
        category = 'cultural';
        isCore = true;
      }

      if (!category) return;

      const centroid = getCentroid(f.geometry);
      if (!centroid) return;
      const [lng, lat] = centroid;
      let district = p.adm2_name || '';
      let thana = p.adm3_name || '';
      let division = p.adm1_name || '';

      if (!district || !thana) {
        const matched = findThanaForPoint(lng, lat, thanaFeatures);
        if (matched) {
          thana = matched.thana_name;
          district = matched.district_name;
          division = matched.division_name;
        }
      }

      const added = tryAddLandmark({
        id: `poi-${p.id ? p.id.replace(/\//g, '_') : poiAdded}`,
        name,
        name_bn: p.name_bn || '',
        category,
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
        thana,
        district,
        division,
        isCore
      });
      if (added) poiAdded++;
    });
    console.log(`✓ Added ${poiAdded} verified points of interest.`);
  }

  // 6. Ingest GeoNames (Villages, Unions, Stations, Bazars)
  const geonamesPath = path.join(__dirname, '../scratch/BD.txt');
  if (fs.existsSync(geonamesPath)) {
    console.log('📍 Ingesting GeoNames Bangladesh entities (Villages, Unions, Stations)...');
    const rl = readline.createInterface({
      input: fs.createReadStream(geonamesPath),
      crlfDelay: Infinity
    });

    const bnRegex = /[\u0980-\u09FF]+/;
    let gnAdded = 0;

    for await (const line of rl) {
      const parts = line.split('\t');
      const fcode = parts[6] + '.' + parts[7];

      // We harvest: Unions (A.ADM4), Villages/Localities (P.PPL, L.LCTY), Stations (S.RSTN), Markets (S.MKT)
      let category = null;
      let isCore = false;

      if (fcode === 'A.ADM4') {
        category = 'hub';
        isCore = false;
      } else if (fcode === 'P.PPL' || fcode === 'L.LCTY') {
        category = 'locality';
      } else if (fcode === 'S.RSTN') {
        category = 'transit';
        isCore = true;
      } else if (fcode === 'S.MKT') {
        category = 'commercial';
        isCore = true;
      }

      if (!category) continue;

      const name = (parts[1] || parts[2] || '').trim();
      if (!name || name.length < 2) continue;

      const lat = parseFloat(parts[4]);
      const lng = parseFloat(parts[5]);
      if (isNaN(lat) || isNaN(lng)) continue;

      // Extract Bengali script if present in alternatenames
      const altNames = parts[3] ? parts[3].split(',') : [];
      let name_bn = '';
      for (const alt of altNames) {
        if (bnRegex.test(alt)) {
          name_bn = alt.trim();
          break;
        }
      }

      const matched = findThanaForPoint(lng, lat, thanaFeatures);

      const added = tryAddLandmark({
        id: `gn-${parts[0]}`,
        name,
        name_bn,
        category,
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
        thana: matched ? matched.thana_name : '',
        district: matched ? matched.district_name : '',
        division: matched ? matched.division_name : '',
        isCore
      });
      if (added) gnAdded++;
    }
    console.log(`✓ Added ${gnAdded} GeoNames verified entities.`);
  }

  console.log(`\n🎉 Total Harvested Landmarks: ${allHarvested.length} (Deduplicated ${duplicateCount} nearby duplicates)`);

  // 7. Partition Landmarks into 64 District Clusters
  console.log('📦 Partitioning landmarks into 64 District Clusters...');
  const outDistrictsDir = path.join(__dirname, '../public/geo/districts');
  if (!fs.existsSync(outDistrictsDir)) {
    fs.mkdirSync(outDistrictsDir, { recursive: true });
  }

  // Distribute
  allHarvested.forEach(l => {
    let slug = slugify(l.district);
    let target = districtMap.get(slug);

    if (!target && l.thana) {
      for (const d of districtMap.values()) {
        if (d.thanas.some(t => t.thana_name.toLowerCase() === l.thana.toLowerCase())) {
          target = d;
          l.district = d.district_name;
          slug = d.slug;
          break;
        }
      }
    }

    if (!target) {
      // Point-in-polygon fallback
      const matched = findThanaForPoint(l.lng, l.lat, thanaFeatures);
      if (matched) {
        l.thana = matched.thana_name;
        l.district = matched.district_name;
        l.division = matched.division_name;
        slug = slugify(matched.district_name);
        target = districtMap.get(slug);
      }
    }

    if (target) {
      target.landmarks.push(l);
    } else {
      // Default to Dhaka
      const dhaka = districtMap.get('dhaka');
      if (dhaka) {
        l.district = 'Dhaka';
        dhaka.landmarks.push(l);
      }
    }
  });

  // Write all 64 District files
  const manifest = {};
  let totalSavedInDistricts = 0;

  for (const [slug, data] of districtMap.entries()) {
    const filePath = path.join(outDistrictsDir, `${slug}.json`);
    const payload = {
      district: data.district_name,
      district_bn: data.district_bn_name,
      slug: data.slug,
      division: data.division,
      thanaCount: data.thanas.length,
      landmarkCount: data.landmarks.length,
      landmarks: data.landmarks
    };

    fs.writeFileSync(filePath, JSON.stringify(payload));
    totalSavedInDistricts += data.landmarks.length;
    manifest[slug] = {
      district: data.district_name,
      division: data.division,
      landmarks: data.landmarks.length,
      file: `/geo/districts/${slug}.json`
    };
  }

  fs.writeFileSync(path.join(outDistrictsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`✅ Generated all 64 District Clusters (${totalSavedInDistricts} total district landmarks).`);

  // 8. Generate Core Nationwide Landmarks for Instant Autocomplete
  // Filter for: Core high-profile items + top institutions + at least 15 items per district
  console.log('⭐ Generating Core Nationwide Autocomplete Dataset (bd_landmarks.json)...');
  const coreLandmarks = [];
  const coreSet = new Set();

  // First: all marked isCore
  allHarvested.filter(l => l.isCore).forEach(l => {
    coreLandmarks.push(l);
    coreSet.add(l.id || l.name);
  });

  // Second: ensure every district has at least 25 landmarks in core
  for (const [slug, data] of districtMap.entries()) {
    const existingInCore = coreLandmarks.filter(l => slugify(l.district) === slug).length;
    if (existingInCore < 25) {
      const candidates = data.landmarks.filter(l => !coreSet.has(l.id || l.name));
      const needed = 25 - existingInCore;
      candidates.slice(0, needed).forEach(l => {
        coreLandmarks.push(l);
        coreSet.add(l.id || l.name);
      });
    }
  }

  const corePath = path.join(__dirname, '../public/geo/bd_landmarks.json');
  fs.writeFileSync(corePath, JSON.stringify(coreLandmarks));
  const coreKb = (fs.statSync(corePath).size / 1024).toFixed(1);
  console.log(`✅ Saved Core Autocomplete Index: ${coreLandmarks.length} landmarks (${coreKb} KB) to ${corePath}`);

  // 9. Generate Native WebGL MapLibre Clustered Layer GeoJSON (landmarks_layer.geojson)
  // Contains key institutions, healthcare, bazars, and hubs across Bangladesh
  console.log('🗺️ Generating WebGL Clustered Landmarks GeoJSON layer (landmarks_layer.geojson)...');
  const layerFeatures = [];

  // We include educational institutes, hospitals, transit, hubs, and markets
  allHarvested.forEach(l => {
    if (l.category === 'education' || l.category === 'healthcare' || l.category === 'transit' || l.category === 'commercial' || l.category === 'hub') {
      layerFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [l.lng, l.lat]
        },
        properties: {
          id: l.id,
          name: l.name,
          name_bn: l.name_bn || '',
          category: l.category,
          thana: l.thana || '',
          district: l.district || ''
        }
      });
    }
  });

  const layerGeoJSON = {
    type: 'FeatureCollection',
    features: layerFeatures
  };

  const layerPath = path.join(__dirname, '../public/geo/landmarks_layer.geojson');
  fs.writeFileSync(layerPath, JSON.stringify(layerGeoJSON));
  const layerKb = (fs.statSync(layerPath).size / 1024).toFixed(1);
  console.log(`✅ Saved WebGL Clustered Landmarks Layer: ${layerFeatures.length} features (${layerKb} KB) to ${layerPath}`);

  console.log('🎉 PIPELINE COMPLETE! Nationwide coverage achieved with zero cost.');
}

run().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
