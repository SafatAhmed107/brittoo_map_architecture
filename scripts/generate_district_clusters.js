const fs = require('fs');
const path = require('path');

function slugify(name) {
  return name.toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const outDir = path.join(__dirname, '../public/geo/districts');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const thanasGeo = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/geo/bd_thanas.min.geojson'), 'utf8'));
const allLandmarks = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/geo/bd_landmarks.json'), 'utf8'));

// Group landmarks by district
const districtMap = new Map();

// Initialize all 64 districts from thanas GeoJSON
thanasGeo.features.forEach(f => {
  const dName = f.properties.district_name ? f.properties.district_name.trim() : 'Dhaka';
  const slug = slugify(dName);
  if (!districtMap.has(slug)) {
    districtMap.set(slug, {
      district_name: dName,
      slug,
      division: f.properties.division_name || '',
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

// Distribute all 4,097 landmarks into their corresponding district
allLandmarks.forEach(l => {
  const dName = l.district ? l.district.trim() : '';
  const slug = slugify(dName);
  let target = districtMap.get(slug);
  
  if (!target) {
    // Fallback: try matching through thana name
    for (const d of districtMap.values()) {
      if (d.thanas.some(t => t.thana_name.toLowerCase() === (l.thana || '').toLowerCase())) {
        target = d;
        break;
      }
    }
  }

  if (target) {
    target.landmarks.push(l);
  } else {
    // Default to Dhaka if unspecified
    const dhaka = districtMap.get('dhaka');
    if (dhaka) dhaka.landmarks.push(l);
  }
});

// Write each district cluster
let totalFiles = 0;
let totalLandmarksStored = 0;
const indexManifest = {};

for (const [slug, data] of districtMap.entries()) {
  const filePath = path.join(outDir, `${slug}.json`);
  const payload = {
    district: data.district_name,
    slug: data.slug,
    division: data.division,
    thanaCount: data.thanas.length,
    landmarkCount: data.landmarks.length,
    landmarks: data.landmarks
  };

  fs.writeFileSync(filePath, JSON.stringify(payload));
  totalFiles++;
  totalLandmarksStored += data.landmarks.length;
  indexManifest[slug] = {
    district: data.district_name,
    division: data.division,
    landmarks: data.landmarks.length,
    file: `/geo/districts/${slug}.json`
  };
}

// Write master manifest
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(indexManifest, null, 2));

console.log(`✅ Successfully generated ${totalFiles} District Clusters in ${outDir}`);
console.log(`📦 Stored ${totalLandmarksStored} landmarks across 64 districts.`);
