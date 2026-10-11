'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';
import {
  initGeoEngine,
  initSearchIndex,
  resolveLocationLocally,
  searchPlaces,
  loadDistrictData,
  getNearbyLandmarks,
  LocationResolution,
  LandmarkItem
} from '@/lib/geo-engine';
import {
  Search,
  MapPin,
  Compass,
  PlusCircle,
  X,
  CheckCircle2,
  Zap,
  BookOpen,
  Send,
  RefreshCw,
  Phone,
  ChevronDown,
  ChevronUp,
  Layers,
  GraduationCap,
  Building2,
  Train,
  Sliders,
  Eye,
  EyeOff
} from 'lucide-react';

interface TuitionItem {
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
  distance_meters?: number;
  status: string;
  created_at: string;
}

interface InvalidationTile {
  z: number;
  x: number;
  y: number;
}

type MapTheme = 'streets' | 'dark' | 'light' | 'satellite';

const OSM_TILES = [
  'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
];

const MAP_STYLES: Record<MapTheme, maplibregl.StyleSpecification> = {
  streets: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: OSM_TILES,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-layer',
        type: 'raster',
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  },
  dark: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: OSM_TILES,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-layer',
        type: 'raster',
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  },
  light: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: OSM_TILES,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-layer',
        type: 'raster',
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  },
  satellite: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: '© Esri, Maxar, Earthstar Geographics'
      }
    },
    layers: [
      {
        id: 'esri-satellite-layer',
        type: 'raster',
        source: 'esri-satellite',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  }
};

const QUICK_ZONES = [
  { name: 'BUET & DU', lng: 90.3924, lat: 23.7266, zoom: 15 },
  { name: 'Dhanmondi', lng: 90.3725, lat: 23.7533, zoom: 14.8 },
  { name: 'Mirpur 10', lng: 90.3697, lat: 23.8071, zoom: 14.8 },
  { name: 'Uttara', lng: 90.3980, lat: 23.8698, zoom: 14.5 },
  { name: 'GEC (Ctg)', lng: 91.8215, lat: 22.3585, zoom: 14.5 },
  { name: 'RUET (Rajshahi)', lng: 88.6285, lat: 24.3636, zoom: 14.5 },
  { name: 'SUST (Sylhet)', lng: 91.8315, lat: 24.9175, zoom: 14.5 },
  { name: 'KUET (Khulna)', lng: 89.5024, lat: 22.8996, zoom: 14.5 },
  { name: 'BM College (Barisal)', lng: 90.3548, lat: 22.7092, zoom: 14.5 },
  { name: 'Rangpur Sadar', lng: 89.2605, lat: 25.7224, zoom: 14.5 },
  { name: 'BAU (Mymensingh)', lng: 90.4345, lat: 24.7262, zoom: 14.5 }
];

// Helper to generate a geodesic circle polygon for commute radius
function createGeoJSONCircle(center: [number, number], radiusInMeters: number, points = 64) {
  const [lng, lat] = center;
  const coords: [number, number][] = [];
  const distanceX = radiusInMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  const distanceY = radiusInMeters / 110540;

  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([lng + x, lat + y]);
  }

  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [coords]
    },
    properties: {}
  };
}

// Helper to calculate slippy tile coordinates for telemetry HUD
function getSlippyTile(lng: number, lat: number, zoom: number) {
  const z = Math.floor(zoom);
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { z, x, y };
}

export default function MapComponent() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const tuitionMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Selected Pin Coordinates & Location
  const [selectedCoords, setSelectedCoords] = useState<{ lng: number; lat: number }>({
    lng: 90.3924,
    lat: 23.7266 // BUET Palashi Gate, Dhaka
  });

  const [locationInfo, setLocationInfo] = useState<LocationResolution>({
    thana: 'Lalbagh',
    district: 'Dhaka',
    division: 'Dhaka Division',
    displayName: 'Lalbagh, Dhaka (BUET Campus)',
    outOfBounds: false,
    executionMs: 0.038
  });

  // Current Viewport Telemetry
  const [currentZoom, setCurrentZoom] = useState(14.5);
  const [currentTile, setCurrentTile] = useState({ z: 14, x: 12305, y: 7079 });
  const [currentTheme, setCurrentTheme] = useState<MapTheme>('streets');

  // Search & Suggestions
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LandmarkItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(-1);

  // Tuitions & Filter State
  const [tuitions, setTuitions] = useState<TuitionItem[]>([]);
  const [selectedTuition, setSelectedTuition] = useState<TuitionItem | null>(null);
  const [activeTab, setActiveTab] = useState<'tutor' | 'guardian'>('tutor');
  const [radiusFilter, setRadiusFilter] = useState<number>(3000); // 3km default
  const selectedCoordsRef = useRef(selectedCoords);
  selectedCoordsRef.current = selectedCoords;
  const radiusFilterRef = useRef(radiusFilter);
  radiusFilterRef.current = radiusFilter;
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [showDeck, setShowDeck] = useState(true);
  const [showLandmarksLayer, setShowLandmarksLayer] = useState(true);
  const [showNearbyDrawer, setShowNearbyDrawer] = useState(false);
  const [districtLandmarksLoaded, setDistrictLandmarksLoaded] = useState(0);

  // Instant in-memory institutions within tutor's commute radius
  const nearbyInstitutions = useMemo(() => {
    return getNearbyLandmarks(selectedCoords, radiusFilter / 1000, 20);
  }, [selectedCoords, radiusFilter, districtLandmarksLoaded]);

  // "Post a Tuition" Modal State
  const [postFormOpen, setPostFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [classLevel, setClassLevel] = useState('HSC 2nd Year');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(['Physics', 'Higher Math']);
  const [salaryBudget, setSalaryBudget] = useState('8500');
  const [notes, setNotes] = useState('');

  // Diagnostic HUD & Notification
  const [showHud, setShowHud] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastPurgedTiles, setLastPurgedTiles] = useState<InvalidationTile[]>([]);
  const [systemStats, setSystemStats] = useState<{
    dbConnected: boolean;
    dbStatus: string;
    postCount: number;
    cfConfigured: boolean;
  }>({
    dbConnected: true,
    dbStatus: 'Supabase PostGIS Live',
    postCount: 6,
    cfConfigured: false
  });

  const availableSubjects = [
    'Physics',
    'Higher Math',
    'Chemistry',
    'Biology',
    'General Math',
    'English',
    'ICT',
    'Science'
  ];

  const classLevels = [
    'Admission (BUET/Medical)',
    'HSC 2nd Year',
    'HSC 1st Year',
    'SSC (Class 10)',
    'Class 9',
    'Class 8 (JSC)',
    'English Medium (O/A Level)'
  ];

  const showToast = useCallback((msg: string, duration = 3500) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, duration);
  }, []);

  // Update reverse geocoding locally in browser memory (0ms)
  const handleLocationChange = useCallback((lng: number, lat: number) => {
    setSelectedCoords({ lng, lat });
    const resolved = resolveLocationLocally(lng, lat);
    setLocationInfo(resolved);

    if (resolved.district) {
      loadDistrictData(resolved.district).then((loaded) => {
        if (loaded) setDistrictLandmarksLoaded(prev => prev + 1);
      });
    }

    if (resolved.outOfBounds) {
      showToast('📍 Selected location is outside Bangladesh. Snapped back to BUET.');
      const buet = [90.3924, 23.7266];
      setSelectedCoords({ lng: buet[0], lat: buet[1] });
      if (markerRef.current) markerRef.current.setLngLat([buet[0], buet[1]]);
      if (mapRef.current) mapRef.current.flyTo({ center: [buet[0], buet[1]], zoom: 14.5 });
      const resetResolved = resolveLocationLocally(buet[0], buet[1]);
      setLocationInfo(resetResolved);
    }
  }, [showToast]);

  // Fetch tuition posts from API
  const fetchTuitions = useCallback(async () => {
    try {
      const url = `/api/tuitions?lat=${selectedCoords.lat}&lng=${selectedCoords.lng}&radius=${radiusFilter}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && Array.isArray(json.posts)) {
        setTuitions(json.posts);
      }
    } catch (err) {
      console.warn('Failed to load tuitions:', err);
    }
  }, [selectedCoords.lat, selectedCoords.lng, radiusFilter]);

  // Fetch system diagnostics
  const fetchSystemStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/system-status');
      const data = await res.json();
      setSystemStats({
        dbConnected: data.database?.connected || false,
        dbStatus: data.database?.status || 'Active (Local Spatial Engine)',
        postCount: data.database?.postCount || 6,
        cfConfigured: data.cloudflare?.configured || false
      });
    } catch (e) {
      console.warn('Status check failed:', e);
    }
  }, []);

  // Update commute radius circle overlay on map canvas
  const updateRadiusCircle = useCallback((map: maplibregl.Map, center: [number, number], radius: number) => {
    if (!map.isStyleLoaded()) return;
    const circleData = createGeoJSONCircle(center, radius);
    const source = map.getSource('commute-radius') as maplibregl.GeoJSONSource | undefined;

    if (source) {
      source.setData(circleData);
    } else {
      map.addSource('commute-radius', {
        type: 'geojson',
        data: circleData
      });

      map.addLayer({
        id: 'commute-radius-fill',
        type: 'fill',
        source: 'commute-radius',
        paint: {
          'fill-color': '#10b981',
          'fill-opacity': 0.12
        }
      });

      map.addLayer({
        id: 'commute-radius-line',
        type: 'line',
        source: 'commute-radius',
        paint: {
          'line-color': '#34d399',
          'line-width': 2,
          'line-dasharray': [2, 2],
          'line-opacity': 0.85
        }
      });
    }
  }, []);

  // Breakthrough 5: Attach PostGIS MVT Vector Tile Layer directly to MapLibre Canvas
  const setupMvtLayer = useCallback((map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) return;

    if (!map.getSource('tuitions-mvt')) {
      const tileOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      map.addSource('tuitions-mvt', {
        type: 'vector',
        tiles: [`${tileOrigin}/api/tiles/tuitions/{z}/{x}/{y}.pbf`],
        minzoom: 10,
        maxzoom: 16
      });

      map.addLayer({
        id: 'tuitions-mvt-circles',
        type: 'circle',
        source: 'tuitions-mvt',
        'source-layer': 'tuition_layer',
        paint: {
          'circle-color': '#10b981',
          'circle-radius': 7.5,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });
    }
  }, []);

  // Breakthrough 6: Native WebGL Clustered Landmarks Layer (24,000+ points at 60 FPS)
  const setupLandmarksLayer = useCallback((map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) return;

    if (!map.getSource('bd-landmarks-cluster')) {
      map.addSource('bd-landmarks-cluster', {
        type: 'geojson',
        data: '/geo/landmarks_layer.geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 45
      });

      // 1. Cluster background circles with 3-tier count colors
      map.addLayer({
        id: 'landmarks-clusters',
        type: 'circle',
        source: 'bd-landmarks-cluster',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#0284c7', // < 25: Sky Cyan
            25,
            '#059669', // 25 - 99: Emerald Green
            100,
            '#7c3aed'  // >= 100: Royal Purple
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            25,
            22,
            100,
            28
          ],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });

      // 2. Cluster count text
      map.addLayer({
        id: 'landmarks-cluster-count',
        type: 'symbol',
        source: 'bd-landmarks-cluster',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold'],
          'text-size': 12
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      // 3. Individual unclustered landmark points
      map.addLayer({
        id: 'landmarks-unclustered-point',
        type: 'circle',
        source: 'bd-landmarks-cluster',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match',
            ['get', 'category'],
            'hall', '#10b981',        // Emerald Green for University Residential Halls
            'education', '#14b8a6',   // Teal
            'healthcare', '#ef4444',  // Rose Red
            'commercial', '#f59e0b',  // Amber Gold
            'transit', '#3b82f6',     // Electric Blue
            'hub', '#8b5cf6',         // Purple
            '#06b6d4'                 // Default Cyan
          ],
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 4,
            14, 6.5,
            17, 9
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95
        }
      });

      // Cluster click: smooth expansion flyTo
      map.on('click', 'landmarks-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['landmarks-clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        const source = map.getSource('bd-landmarks-cluster') as maplibregl.GeoJSONSource;
        if (source && typeof (source as any).getClusterExpansionZoom === 'function') {
          (source as any).getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
            if (err) return;
            const geom = features[0].geometry as any;
            map.easeTo({
              center: geom.coordinates,
              zoom: Math.min(zoom + 0.5, 16),
              duration: 600
            });
          });
        }
      });

      // Unclustered point click: Open popup & allow instant pin move
      map.on('click', 'landmarks-unclustered-point', (e) => {
        if (!e.features || !e.features[0]) return;
        const feat = e.features[0];
        const geom = feat.geometry as any;
        const p = feat.properties as any;
        const coords: [number, number] = geom.coordinates;

        const catEmoji = p.category === 'hall' ? '🏛️' : p.category === 'education' ? '🎓' : p.category === 'healthcare' ? '🏥' : p.category === 'commercial' ? '🛒' : p.category === 'transit' ? '🚆' : '📍';
        const catLabel = p.category === 'hall' ? 'Residential Hall' : (p.category || 'Landmark');

        const popup = new maplibregl.Popup({ offset: 12, closeButton: true, className: 'glass-landmark-popup' })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family: system-ui, -apple-system, sans-serif; padding: 4px 2px; min-width: 190px;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 7px; border-radius: 4px;">
                  ${catEmoji} ${catLabel}
                </span>
              </div>
              <div style="font-weight: 700; font-size: 14px; color: #f8fafc; margin-bottom: 2px; line-height: 1.3;">
                ${p.name || 'Landmark'}
              </div>
              ${p.name_bn ? '<div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">' + p.name_bn + '</div>' : ''}
              <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 10px;">
                📍 ${p.thana ? p.thana + ', ' : ''}${p.district || ''}
              </div>
              <button id="btn-pin-landmark-${p.id || 'target'}" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);">
                🎯 Set Commute Pin Here
              </button>
            </div>
          `)
          .addTo(map);

        setTimeout(() => {
          const btn = document.getElementById(`btn-pin-landmark-${p.id || 'target'}`);
          if (btn) {
            btn.onclick = () => {
              if (markerRef.current) markerRef.current.setLngLat(coords);
              handleLocationChange(coords[0], coords[1]);
              updateRadiusCircle(map, coords, radiusFilterRef.current);
              map.flyTo({ center: coords, zoom: 15.2, duration: 1200 });
              popup.remove();
            };
          }
        }, 60);
      });

      // Cursor pointers
      map.on('mouseenter', 'landmarks-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'landmarks-clusters', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'landmarks-unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'landmarks-unclustered-point', () => { map.getCanvas().style.cursor = ''; });
    }
  }, [handleLocationChange, updateRadiusCircle]);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // Register PMTiles protocol for zero-cost basemaps
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    // Initialize local geo assets
    initGeoEngine();
    initSearchIndex();
    loadDistrictData('Dhaka').then(() => {
      setDistrictLandmarksLoaded(prev => prev + 1);
    });
    fetchSystemStatus();

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES.streets,
      center: [selectedCoords.lng, selectedCoords.lat],
      zoom: 14.5,
      pitch: 28,
      bearing: -5,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    // Create user draggable pin with pulse ripple
    const el = document.createElement('div');
    el.className = 'custom-pin-user';
    el.innerHTML = `
      <div style="position: relative; display: flex; align-items: center; justify-content: center;">
        <div class="pulse-circle" style="position: absolute; width: 42px; height: 42px; border-radius: 50%; background: rgba(37,99,235,0.3);"></div>
        <div style="width: 30px; height: 30px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 4px 20px rgba(37,99,235,0.9); display: flex; align-items: center; justify-content: center; color: white;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div style="position: absolute; top: 100%; width: 2.5px; height: 10px; background: #3b82f6;"></div>
        <div style="position: absolute; top: calc(100% + 10px); width: 10px; height: 3px; background: rgba(0,0,0,0.5); border-radius: 50%;"></div>
      </div>
    `;

    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([selectedCoords.lng, selectedCoords.lat])
      .addTo(map);

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      handleLocationChange(lngLat.lng, lngLat.lat);
      updateRadiusCircle(map, [lngLat.lng, lngLat.lat], radiusFilterRef.current);
    });

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      marker.setLngLat(e.lngLat);
      handleLocationChange(e.lngLat.lng, e.lngLat.lat);
      updateRadiusCircle(map, [e.lngLat.lng, e.lngLat.lat], radiusFilterRef.current);
    });

    map.on('load', () => {
      updateRadiusCircle(map, [selectedCoordsRef.current.lng, selectedCoordsRef.current.lat], radiusFilterRef.current);
      setupMvtLayer(map);
      setupLandmarksLayer(map);
    });

    map.on('move', () => {
      const center = map.getCenter();
      const z = map.getZoom();
      setCurrentZoom(parseFloat(z.toFixed(1)));
      setCurrentTile(getSlippyTile(center.lng, center.lat, z));
    });

    markerRef.current = marker;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // Mount strictly once

  // Sync radius circle when radiusFilter changes
  useEffect(() => {
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      updateRadiusCircle(mapRef.current, [selectedCoords.lng, selectedCoords.lat], radiusFilter);
    }
  }, [radiusFilter, selectedCoords.lng, selectedCoords.lat, updateRadiusCircle]);

  // Load tuition posts whenever location or radius filter changes (Debounced by 250ms)
  useEffect(() => {
    let isCancelled = false;
    const timer = setTimeout(async () => {
      try {
        const url = `/api/tuitions?lat=${selectedCoords.lat}&lng=${selectedCoords.lng}&radius=${radiusFilter}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!isCancelled && json.success && Array.isArray(json.posts)) {
          setTuitions(json.posts);
        }
      } catch (err) {
        console.warn('Failed to load tuitions:', err);
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [selectedCoords.lat, selectedCoords.lng, radiusFilter]);

  // Filtered tuition items based on curriculum
  const filteredTuitions = useMemo(() => {
    return tuitions.filter(t => {
      if (classFilter === 'ALL') return true;
      return t.class_level.toLowerCase().includes(classFilter.toLowerCase());
    });
  }, [tuitions, classFilter]);

  // Render tuition markers on map
  useEffect(() => {
    if (!mapRef.current) return;

    tuitionMarkersRef.current.forEach(m => m.remove());
    tuitionMarkersRef.current = [];

    filteredTuitions.forEach(tuition => {
      const el = document.createElement('div');
      el.className = 'tuition-marker';
      const isSelected = selectedTuition?.id === tuition.id;
      el.innerHTML = `
        <div style="background: rgba(11, 17, 30, 0.96); border: ${isSelected ? '2.5px solid #34d399' : '2px solid #10b981'}; border-radius: 12px; padding: 4px 8px; box-shadow: 0 6px 20px ${isSelected ? 'rgba(52,211,153,0.7)' : 'rgba(16,185,129,0.45)'}; display: flex; align-items: center; gap: 5px; color: #ffffff; font-family: var(--font-main);">
          <span style="display: inline-block; width: 7px; height: 7px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981;"></span>
          <span style="font-weight: 800; font-size: 11px; letter-spacing: -0.3px;">৳${(tuition.salary_budget / 1000).toFixed(1)}k</span>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedTuition(tuition);
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [tuition.lng, tuition.lat], zoom: 15.5, pitch: 35, duration: 1200 });
        }
      });

      const m = new maplibregl.Marker({ element: el })
        .setLngLat([tuition.lng, tuition.lat])
        .addTo(mapRef.current!);

      tuitionMarkersRef.current.push(m);
    });
  }, [filteredTuitions, selectedTuition]);

  // Switch Map Theme
  const handleThemeChange = (theme: MapTheme) => {
    const prevTheme = currentTheme;
    setCurrentTheme(theme);
    setShowStyleMenu(false);
    if (!mapRef.current) return;

    // streets, dark, and light share OSM tiles with CSS filter themes; only swap style for satellite
    const needsStyleSwap = (theme === 'satellite' && prevTheme !== 'satellite') ||
                           (theme !== 'satellite' && prevTheme === 'satellite');

    if (needsStyleSwap) {
      mapRef.current.setStyle(MAP_STYLES[theme]);
      mapRef.current.once('style.load', () => {
        if (mapRef.current) {
          updateRadiusCircle(mapRef.current, [selectedCoords.lng, selectedCoords.lat], radiusFilter);
          setupMvtLayer(mapRef.current);
          setupLandmarksLayer(mapRef.current);
        }
      });
    }
  };

  // Synchronize Landmarks Layer Visibility
  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
    const visibility = showLandmarksLayer ? 'visible' : 'none';
    ['landmarks-clusters', 'landmarks-cluster-count', 'landmarks-unclustered-point'].forEach(id => {
      if (mapRef.current?.getLayer(id)) {
        mapRef.current.setLayoutProperty(id, 'visibility', visibility);
      }
    });
  }, [showLandmarksLayer]);

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Search input handler with Dual-Stream Hybrid Merging:
  // Stream 1 (Edge): 0.05ms instant local seed response
  // Stream 2 (Server/Crawler): deep lookup for all 500K+ landmarks across Bangladesh
  const handleSearchInput = (q: string) => {
    setSearchQuery(q);
    setSelectedSearchIndex(-1);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }

    if (!q.trim()) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    // 1. Stream 1 (Local Edge): Instant 0.05ms response
    const localResults = searchPlaces(q, 8, selectedCoordsRef.current);
    setSuggestions(localResults);
    setIsSearching(true);

    // If local results already provide 2+ strong matches (e.g. university halls, sadars, thanas),
    // DO NOT make any server call! 100,000 users will make ZERO network requests for 99% of queries.
    if (localResults.length >= 2) {
      return;
    }

    // 2. Stream 2 (Server & Autonomous Crawler): Deep lookup ONLY for rare/obscure landscapes
    searchDebounceRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      searchAbortRef.current = abortController;

      try {
        const uCoords = selectedCoordsRef.current;
        const res = await fetch(
          `/api/geo/search?q=${encodeURIComponent(q)}&lat=${uCoords.lat}&lng=${uCoords.lng}&limit=8`,
          { signal: abortController.signal }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results) && data.results.length > 0) {
            setSuggestions(prev => {
              const combined = [...prev];
              const seen = new Set(combined.map(item => item.id || `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`));
              for (const r of data.results) {
                const key = r.id || `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
                if (!seen.has(key)) {
                  combined.push(r);
                  seen.add(key);
                }
              }
              return combined.slice(0, 10);
            });
            setIsSearching(true);
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          // Graceful fallback to local results
        }
      }
    }, 120);
  };

  const handleSelectLandmark = (item: LandmarkItem) => {
    setSearchQuery(item.name);
    setSuggestions([]);
    setIsSearching(false);

    if (mapRef.current && markerRef.current) {
      mapRef.current.flyTo({ center: [item.lng, item.lat], zoom: 15.5, pitch: 32, duration: 1500 });
      markerRef.current.setLngLat([item.lng, item.lat]);
      handleLocationChange(item.lng, item.lat);
      updateRadiusCircle(mapRef.current, [item.lng, item.lat], radiusFilter);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isSearching || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSearchIndex >= 0 && selectedSearchIndex < suggestions.length) {
        handleSelectLandmark(suggestions[selectedSearchIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsSearching(false);
      setSuggestions([]);
    }
  };

  const handleQuickJump = (zone: typeof QUICK_ZONES[0]) => {
    if (mapRef.current && markerRef.current) {
      mapRef.current.flyTo({ center: [zone.lng, zone.lat], zoom: zone.zoom, pitch: 30, duration: 1600 });
      markerRef.current.setLngLat([zone.lng, zone.lat]);
      handleLocationChange(zone.lng, zone.lat);
      updateRadiusCircle(mapRef.current, [zone.lng, zone.lat], radiusFilter);
    }
  };

  const handleSelectTuitionCard = (tuition: TuitionItem) => {
    setSelectedTuition(tuition);
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [tuition.lng, tuition.lat], zoom: 15.8, pitch: 35, duration: 1300 });
    }
  };

  // Submit Tuition Post
  const handleCreateTuition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSubjects.length === 0) {
      showToast('⚠️ Please select at least one subject');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        guardian_name: guardianName || 'Guardian',
        contact_number: contactNumber || '01700-000000',
        class_level: classLevel,
        subjects: selectedSubjects,
        salary_budget: parseFloat(salaryBudget),
        notes,
        thana_name: locationInfo.thana || 'Dhaka',
        district_name: locationInfo.district || 'Dhaka',
        lat: selectedCoords.lat,
        lng: selectedCoords.lng
      };

      const res = await fetch('/api/tuitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (json.success) {
        setPostFormOpen(false);
        showToast('🎉 Tuition requirement posted! Edge tiles purged surgically.');
        if (json.invalidation?.purgedTiles) {
          setLastPurgedTiles(json.invalidation.purgedTiles);
        }
        await fetchTuitions();
        if (json.post) {
          setSelectedTuition(json.post);
        }
      } else {
        showToast(`❌ Error: ${json.error || 'Failed to post'}`);
      }
    } catch (err: unknown) {
      showToast(`❌ Network error: ${err instanceof Error ? err.message : 'Failed to post'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSubject = (sub: string) => {
    if (selectedSubjects.includes(sub)) {
      setSelectedSubjects(selectedSubjects.filter(s => s !== sub));
    } else {
      setSelectedSubjects([...selectedSubjects, sub]);
    }
  };

  const getLandmarkBadge = (type?: string) => {
    if (!type) return <span className="badge badge-cyan">Landmark</span>;
    if (type === 'hall' || type === 'dormitory' || type.toLowerCase().includes('hall')) {
      return (
        <span className="badge badge-emerald" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(16, 185, 129, 0.22)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
          🏛️ Residential Hall
        </span>
      );
    }
    if (type === 'osm_crawler') {
      return (
        <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          🌐 Landmark
        </span>
      );
    }
    if (type.includes('University')) {
      return (
        <span className="badge badge-emerald" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <GraduationCap size={11} /> {type}
        </span>
      );
    }
    if (type.includes('College')) {
      return (
        <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Building2 size={11} /> {type}
        </span>
      );
    }
    if (type.includes('Metro')) {
      return (
        <span className="badge badge-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Train size={11} /> {type}
        </span>
      );
    }
    if (type === 'hub') {
      return <span className="badge badge-amber">Upazila Sadar</span>;
    }
    if (type === 'commercial') {
      return <span className="badge badge-blue">Bazar / Hub</span>;
    }
    return <span className="badge badge-cyan">{type}</span>;
  };

  return (
    <div
      data-theme={currentTheme === 'light' ? 'light' : 'dark'}
      data-map-theme={currentTheme}
      style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#0b111e' }}
    >
      {/* Map Canvas */}
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* Top Floating Control Bar & Autocomplete */}
      <header
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '94%',
          maxWidth: '680px',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div
          className="glass-panel-elevated"
          style={{
            padding: '10px 16px',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <Search size={18} color="#38bdf8" />
          <input
            id="search-landmark-input"
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search landmark or hall (e.g. Rashid Hall, SM Hall, BUET, DU, Dhanmondi)..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              fontFamily: 'var(--font-main)'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSuggestions([]);
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}

          {/* Mode Switcher */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.45)', padding: '3px', borderRadius: '10px', gap: 2 }}>
            <button
              id="btn-tutor-mode"
              onClick={() => setActiveTab('tutor')}
              style={{
                background: activeTab === 'tutor' ? '#2563eb' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background 0.15s ease'
              }}
            >
              Tutor Mode
            </button>
            <button
              id="btn-guardian-mode"
              onClick={() => {
                setActiveTab('guardian');
                setPostFormOpen(true);
              }}
              style={{
                background: activeTab === 'guardian' ? '#10b981' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background 0.15s ease'
              }}
            >
              Post Tuition
            </button>
          </div>
        </div>

        {/* Quick Jump Hotspot Chips across all 8 Divisions */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 4,
            scrollbarWidth: 'none'
          }}
        >
          {QUICK_ZONES.map((zone) => (
            <button
              key={zone.name}
              className="quick-chip"
              onClick={() => handleQuickJump(zone)}
            >
              {zone.name}
            </button>
          ))}
        </div>

        {/* Autocomplete Suggestions Dropdown (Fuse.js In-Memory, 0ms Network) */}
        {isSearching && suggestions.length > 0 && (
          <ul
            className="glass-panel-elevated animate-fade-in"
            style={{
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              listStyle: 'none',
              maxHeight: '340px',
              overflowY: 'auto'
            }}
          >
            {suggestions.map((item, idx) => (
              <li
                key={idx}
                onClick={() => handleSelectLandmark(item)}
                style={{
                  padding: '11px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: selectedSearchIndex === idx ? 'rgba(37,99,235,0.22)' : 'transparent',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={() => setSelectedSearchIndex(idx)}
              >
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{item.name}</span>
                    {item.name_bn && item.name_bn !== item.name && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                        ({item.name_bn})
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {item.thana ? `${item.thana}, ` : ''}{item.district} {item.division ? `(${item.division})` : ''}
                  </div>
                </div>
                {getLandmarkBadge(item.category || item.type)}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Floating HUD: Real-time Telemetry & Edge Diagnostics */}
      <div
        style={{
          position: 'absolute',
          top: 114,
          left: 16,
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        <button
          id="btn-toggle-hud"
          onClick={() => setShowHud(!showHud)}
          className="glass-panel"
          style={{
            padding: '7px 14px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-primary)',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Zap size={14} color="#10b981" />
          <span>Ray-Cast: <strong style={{ color: '#34d399' }}>{locationInfo.executionMs.toFixed(3)} ms</strong></span>
          <span className="badge badge-emerald">0 Network</span>
          {showHud ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showHud && (
          <div
            className="glass-panel-elevated animate-fade-in"
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              width: '320px',
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              fontSize: '12px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Spatial Computation:</span>
              <strong style={{ color: '#38bdf8' }}>Inline Ray-Cast + RBush R-tree</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Landmark Search:</span>
              <strong style={{ color: '#a78bfa' }}>Fuse.js (123 Landmarks RAM)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Active Tile Index:</span>
              <strong style={{ color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>
                z{currentTile.z}/{currentTile.x}/{currentTile.y}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Current Zoom:</span>
              <strong style={{ color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>{currentZoom}x</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>PostGIS Spatial DB:</span>
              <strong style={{ color: '#34d399' }}>Live Supabase ({systemStats.postCount} posts)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Edge Cache Policy:</span>
              <strong style={{ color: '#38bdf8' }}>s-maxage=300 (SWR 600s)</strong>
            </div>
            {lastPurgedTiles.length > 0 && (
              <div style={{ marginTop: 4, padding: '8px', background: 'rgba(0,0,0,0.35)', borderRadius: '6px' }}>
                <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 800 }}>LAST SURGICAL PURGE (Z10-Z16):</span>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                  {lastPurgedTiles.map(t => `z${t.z}:${t.x}/${t.y}`).join(', ')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Basemap Style Switcher & Tutor Controls (Top Right) */}
      <div
        style={{
          position: 'absolute',
          top: 114,
          right: 16,
          zIndex: 90,
          display: 'flex',
          gap: 6
        }}
      >
        {/* Commute Radius Filter Pill */}
        <div
          className="glass-panel"
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '12px'
          }}
        >
          <Compass size={14} color="#34d399" />
          <select
            value={radiusFilter}
            onChange={(e) => setRadiusFilter(Number(e.target.value))}
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: 'none',
              outline: 'none',
              fontSize: '12px',
              fontFamily: 'var(--font-main)',
              cursor: 'pointer'
            }}
          >
            <option value={1000} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Radius: 1 km</option>
            <option value={2000} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Radius: 2 km</option>
            <option value={3000} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Radius: 3 km</option>
            <option value={5000} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Radius: 5 km</option>
            <option value={10000} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Radius: 10 km</option>
            <option value={15000} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Radius: 15 km</option>
          </select>
        </div>

        {/* Class Curriculum Filter */}
        <div
          className="glass-panel"
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '12px'
          }}
        >
          <BookOpen size={14} color="#38bdf8" />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            style={{
              background: 'transparent',
              color: 'var(--text-primary)',
              border: 'none',
              outline: 'none',
              fontSize: '12px',
              fontFamily: 'var(--font-main)',
              cursor: 'pointer'
            }}
          >
            <option value="ALL" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>All Curriculums</option>
            <option value="Admission" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>Admission Prep</option>
            <option value="HSC" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>HSC Level</option>
            <option value="SSC" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>SSC Level</option>
          </select>
        </div>

        {/* Landmark Cluster Layer Toggle */}
        <button
          onClick={() => setShowLandmarksLayer(!showLandmarksLayer)}
          className="glass-panel"
          title="Toggle 24,000+ Nationwide Schools, Colleges, Bazars & Hospitals"
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: showLandmarksLayer ? '#34d399' : 'var(--text-muted)',
            border: showLandmarksLayer ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(255,255,255,0.1)',
            background: showLandmarksLayer ? 'rgba(16, 185, 129, 0.12)' : 'rgba(0,0,0,0.3)',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <GraduationCap size={14} color={showLandmarksLayer ? '#34d399' : '#94a3b8'} />
          <span>Landmarks</span>
          <span style={{ fontSize: '10px', background: 'rgba(52, 211, 153, 0.25)', color: '#10b981', padding: '1px 5px', borderRadius: '4px' }}>
            24k
          </span>
        </button>

        {/* Nearby Commute Hubs Explorer Button */}
        <button
          onClick={() => setShowNearbyDrawer(!showNearbyDrawer)}
          className="glass-panel"
          title="Explore Schools & Institutions within Commute Radius"
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: showNearbyDrawer ? '#38bdf8' : 'var(--text-primary)',
            border: showNearbyDrawer ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.1)',
            background: showNearbyDrawer ? 'rgba(56, 189, 248, 0.12)' : 'rgba(0,0,0,0.3)',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Building2 size={14} color="#38bdf8" />
          <span>Nearby Hubs</span>
          {nearbyInstitutions.length > 0 && (
            <span style={{ fontSize: '10px', background: 'rgba(56, 189, 248, 0.25)', color: '#38bdf8', padding: '1px 5px', borderRadius: '4px' }}>
              {nearbyInstitutions.length}
            </span>
          )}
        </button>

        {/* Basemap Style Switcher */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowStyleMenu(!showStyleMenu)}
            className="glass-panel"
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-full)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <Layers size={14} color="#a78bfa" />
            <span style={{ textTransform: 'capitalize' }}>
              {currentTheme === 'streets' ? 'Street View' : currentTheme}
            </span>
          </button>

          {showStyleMenu && (
            <div
              className="glass-panel-elevated animate-fade-in"
              style={{
                position: 'absolute',
                top: '110%',
                right: 0,
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                minWidth: '170px',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 100
              }}
            >
              {[
                { id: 'streets' as MapTheme, name: 'Street View (Standard)', desc: 'OpenStreetMap Live' },
                { id: 'dark' as MapTheme, name: 'Midnight High-Contrast', desc: 'Dark Cartography' },
                { id: 'light' as MapTheme, name: 'Daylight Voyager', desc: 'Bright & Crisp' },
                { id: 'satellite' as MapTheme, name: 'Satellite Aerial', desc: 'Esri World Imagery' }
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleThemeChange(item.id)}
                  style={{
                    background: currentTheme === item.id ? 'rgba(37,99,235,0.25)' : 'transparent',
                    color: currentTheme === item.id ? '#38bdf8' : 'var(--text-primary)',
                    border: 'none',
                    padding: '9px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    borderBottom: '1px solid rgba(255,255,255,0.06)'
                  }}
                >
                  <span>{item.name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{item.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Breakthrough 1.2: Commute Radius Ribbon & Deck (Tutors Browse Cards) */}
      {activeTab === 'tutor' && showDeck && filteredTuitions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 106,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '94%',
            maxWidth: '880px',
            zIndex: 85,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {/* Deck Header & Counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', color: '#94a3b8' }}>
              <span className="badge badge-emerald">
                🎯 {filteredTuitions.length} Tuitions within {(radiusFilter / 1000).toFixed(1)} km
              </span>
              <span>of {locationInfo.thana || 'Selected Pin'}</span>
            </div>
            <button
              onClick={() => setShowDeck(!showDeck)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px' }}
            >
              <EyeOff size={13} /> Hide Deck
            </button>
          </div>

          {/* Horizontal Scrollable Tuition Cards Ribbon */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              overflowX: 'auto',
              padding: '4px 2px 8px 2px',
              scrollbarWidth: 'none'
            }}
          >
            {filteredTuitions.map((t) => {
              const isSelected = selectedTuition?.id === t.id;
              return (
                <div
                  key={t.id}
                  className={`tuition-card ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectTuitionCard(t)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className="badge badge-emerald" style={{ fontSize: '10px' }}>
                      {t.distance_meters !== undefined ? `${(t.distance_meters / 1000).toFixed(1)} km away` : 'Nearby'}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#34d399', letterSpacing: '-0.3px' }}>
                      ৳{(t.salary_budget / 1000).toFixed(1)}k
                    </span>
                  </div>

                  <div style={{ fontWeight: 800, fontSize: '13.5px', marginTop: 6, color: '#fff' }}>
                    {t.class_level}
                  </div>

                  <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: 2 }}>
                    📍 {t.thana_name}, {t.district_name}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                    {t.subjects.slice(0, 2).map((s, idx) => (
                      <span
                        key={idx}
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          color: '#e2e8f0'
                        }}
                      >
                        {s}
                      </span>
                    ))}
                    {t.subjects.length > 2 && (
                      <span style={{ fontSize: '10px', color: '#64748b', alignSelf: 'center' }}>
                        +{t.subjects.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Button to restore deck if hidden */}
      {activeTab === 'tutor' && !showDeck && (
        <button
          onClick={() => setShowDeck(true)}
          className="glass-panel"
          style={{
            position: 'absolute',
            bottom: 104,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 85,
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            fontSize: '12px',
            color: '#34d399',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer'
          }}
        >
          <Eye size={14} /> Show {filteredTuitions.length} Nearby Tuitions
        </button>
      )}

      {/* Bottom Floating Bar: Selected Dropped Pin Info */}
      <footer
        className="glass-panel-elevated"
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '92%',
          maxWidth: '620px',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 22px',
          zIndex: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <MapPin size={12} color="#38bdf8" />
            <span style={{ fontWeight: 700, letterSpacing: '0.4px' }}>SELECTED LOCATION</span>
            <span className="stat-mono" style={{ color: '#38bdf8', marginLeft: 4 }}>
              ({selectedCoords.lat.toFixed(4)}, {selectedCoords.lng.toFixed(4)})
            </span>
          </div>
          <div
            id="current-location-text"
            style={{
              fontWeight: 800,
              fontSize: '16px',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 3,
              letterSpacing: '-0.3px'
            }}
          >
            {locationInfo.displayName}
          </div>
        </div>

        <button
          id="btn-post-tuition-action"
          className="btn btn-emerald"
          onClick={() => setPostFormOpen(true)}
          style={{ padding: '10px 20px', fontWeight: 700 }}
        >
          <PlusCircle size={16} />
          <span>Post Tuition</span>
        </button>
      </footer>

      {/* Selected Tuition Detail Drawer */}
      {selectedTuition && (
        <aside
          className="glass-panel-elevated animate-slide-up"
          style={{
            position: 'absolute',
            bottom: 104,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '92%',
            maxWidth: '540px',
            borderRadius: 'var(--radius-lg)',
            padding: '22px',
            zIndex: 95,
            border: '1px solid rgba(16, 185, 129, 0.4)',
            boxShadow: '0 16px 44px rgba(0,0,0,0.65)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="badge badge-emerald">OPEN TUITION</span>
                {selectedTuition.distance_meters !== undefined && (
                  <span className="badge badge-blue">
                    {(selectedTuition.distance_meters / 1000).toFixed(1)} km away
                  </span>
                )}
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
                {selectedTuition.class_level}
              </h2>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>
                📍 {selectedTuition.thana_name}, {selectedTuition.district_name}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Monthly Budget</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#34d399', letterSpacing: '-0.5px' }}>
                ৳{selectedTuition.salary_budget.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Subjects */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '14px 0' }}>
            {selectedTuition.subjects.map((sub, i) => (
              <span
                key={i}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-primary)'
                }}
              >
                {sub}
              </span>
            ))}
          </div>

          {selectedTuition.notes && (
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 14 }}>
              &ldquo;{selectedTuition.notes}&rdquo;
            </p>
          )}

          <div
            style={{
              padding: '11px 16px',
              background: 'rgba(0,0,0,0.35)',
              borderRadius: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12.5px',
              marginBottom: 14
            }}
          >
            <div style={{ color: 'var(--text-secondary)' }}>
              Guardian: <strong style={{ color: '#fff' }}>{selectedTuition.guardian_name}</strong>
            </div>
            <div style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
              <Phone size={13} />
              <span>{selectedTuition.contact_number}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => showToast(`📞 Calling guardian: ${selectedTuition.contact_number}`)}
            >
              <Phone size={15} />
              <span>Apply for Tuition</span>
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedTuition(null)}
            >
              Close
            </button>
          </div>
        </aside>
      )}

      {/* Nearby Commute Institutions Slide Drawer */}
      {showNearbyDrawer && (
        <aside
          className="glass-panel-elevated animate-slide-up"
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '24px',
            width: '390px',
            maxHeight: '480px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 90,
            padding: '18px',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 20px 45px rgba(0,0,0,0.65)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: 'rgba(56, 189, 248, 0.2)', padding: '6px', borderRadius: '8px' }}>
                <Building2 size={18} color="#38bdf8" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Institutions in Commute Radius
                </h3>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>
                  Within {(radiusFilter / 1000).toFixed(1)} km of your commute center
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowNearbyDrawer(false)}
              className="btn btn-secondary btn-sm"
              style={{ padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={15} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
            {nearbyInstitutions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--text-muted)', fontSize: '13px' }}>
                No institutions found within {(radiusFilter / 1000).toFixed(1)} km.<br />
                Try increasing your commute radius slider.
              </div>
            ) : (
              nearbyInstitutions.map((item, idx) => {
                const catEmoji = item.category === 'hall' ? '🏛️' : item.category === 'education' ? '🎓' : item.category === 'healthcare' ? '🏥' : item.category === 'commercial' ? '🛒' : item.category === 'transit' ? '🚆' : '📍';
                const catColor = item.category === 'hall' ? '#10b981' : item.category === 'education' ? '#34d399' : item.category === 'healthcare' ? '#f43f5e' : item.category === 'commercial' ? '#fbbf24' : '#38bdf8';

                return (
                  <div
                    key={item.id || idx}
                    onClick={() => {
                      if (markerRef.current) markerRef.current.setLngLat([item.lng, item.lat]);
                      handleLocationChange(item.lng, item.lat);
                      if (mapRef.current) {
                        updateRadiusCircle(mapRef.current, [item.lng, item.lat], radiusFilterRef.current);
                        mapRef.current.flyTo({ center: [item.lng, item.lat], zoom: 15.2, duration: 1200 });
                      }
                      showToast(`📍 Centered on ${item.name}`);
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: '18px', flexShrink: 0 }}>{catEmoji}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {item.thana ? `${item.thana}, ` : ''}{item.district}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0, marginLeft: 8 }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: catColor }}>
                        {item.distKm} km
                      </span>
                      <span style={{ fontSize: '10px', textTransform: 'capitalize', color: 'var(--text-muted)' }}>
                        {item.category === 'hall' ? 'Residential Hall' : item.category}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* "Post a Tuition" Modal Drawer */}
      {postFormOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(10px)',
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPostFormOpen(false);
          }}
        >
          <div
            className="glass-panel-elevated animate-slide-up"
            style={{
              width: '100%',
              maxWidth: '520px',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, background: '#10b981', borderRadius: '50%', boxShadow: '0 0 10px #10b981' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Post a Tuition Requirement</h3>
              </div>
              <button
                onClick={() => setPostFormOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateTuition} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Detected Locality info from Dropped Pin */}
              <div
                style={{
                  background: 'rgba(37,99,235,0.14)',
                  border: '1px solid rgba(37,99,235,0.35)',
                  padding: '11px 16px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <MapPin size={18} color="#38bdf8" />
                <div>
                  <div style={{ fontSize: '11px', color: '#93c5fd', textTransform: 'uppercase', fontWeight: 700 }}>
                    Detected Area (From Pin Location)
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#ffffff', marginTop: 1 }}>
                    {locationInfo.displayName}
                  </div>
                </div>
              </div>

              {/* Class Level */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Class / Curriculum
                </label>
                <select
                  value={classLevel}
                  onChange={(e) => setClassLevel(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--bg-glass-border)',
                    borderRadius: '8px',
                    padding: '10px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-main)'
                  }}
                >
                  {classLevels.map((lvl) => (
                    <option key={lvl} value={lvl} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subjects Chip Selector */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Select Subjects (Click to toggle)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {availableSubjects.map((sub) => {
                    const isSelected = selectedSubjects.includes(sub);
                    return (
                      <button
                        type="button"
                        key={sub}
                        onClick={() => toggleSubject(sub)}
                        style={{
                          background: isSelected ? '#2563eb' : 'var(--bg-tertiary)',
                          color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                          border: isSelected ? '1px solid #60a5fa' : '1px solid var(--bg-glass-border)',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {sub}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Salary Budget */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Monthly Salary Budget (BDT)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 10, color: '#34d399', fontWeight: 800 }}>৳</span>
                  <input
                    type="number"
                    step="500"
                    value={salaryBudget}
                    onChange={(e) => setSalaryBudget(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--bg-glass-border)',
                      borderRadius: '8px',
                      padding: '10px 10px 10px 28px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-main)',
                      fontSize: '15px'
                    }}
                  />
                </div>
              </div>

              {/* Contact info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    Guardian Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Engr. Tanvir"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--bg-glass-border)',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    placeholder="017xxxxxxxx"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--bg-glass-border)',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Notes / Specific Requirements
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. 3 days a week, evening time preferred, BUET engineering tutor desired."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--bg-glass-border)',
                    borderRadius: '8px',
                    padding: '9px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    resize: 'none'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn btn-emerald"
                style={{ padding: '12px', fontSize: '15px', marginTop: 6 }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="pulse-circle" />
                    <span>Publishing & Invalidating Edge Cache...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>Publish Tuition Pin</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Toast Alert */}
      {toastMessage && (
        <div
          className="glass-panel-elevated animate-fade-in"
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 200,
            padding: '12px 20px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(11, 17, 30, 0.96)',
            border: '1px solid #10b981',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}
        >
          <CheckCircle2 size={16} color="#10b981" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
