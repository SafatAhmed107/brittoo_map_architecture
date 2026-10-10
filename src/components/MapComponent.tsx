'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';
import {
  initGeoEngine,
  initSearchIndex,
  resolveLocationLocally,
  searchPlaces,
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
  Layers
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

type MapTheme = 'dark' | 'light' | 'streets';

const MAP_STYLES: Record<MapTheme, string | maplibregl.StyleSpecification> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  streets: {
    version: 8,
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
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
  }
};

const QUICK_ZONES = [
  { name: 'BUET & DU', lng: 90.3924, lat: 23.7266, zoom: 15 },
  { name: 'Dhanmondi', lng: 90.3725, lat: 23.7533, zoom: 14.8 },
  { name: 'Mirpur 10', lng: 90.3697, lat: 23.8071, zoom: 14.8 },
  { name: 'Uttara', lng: 90.3980, lat: 23.8698, zoom: 14.5 },
  { name: 'Gulshan', lng: 90.4142, lat: 23.7942, zoom: 14.8 },
  { name: 'RUET (Rajshahi)', lng: 88.6285, lat: 24.3636, zoom: 14.5 },
  { name: 'GEC (Chittagong)', lng: 91.8215, lat: 22.3585, zoom: 14.5 },
  { name: 'SUST (Sylhet)', lng: 91.8315, lat: 24.9175, zoom: 14.5 }
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
  const [currentZoom, setCurrentZoom] = useState(14);
  const [currentTile, setCurrentTile] = useState({ z: 14, x: 12305, y: 7079 });
  const [currentTheme, setCurrentTheme] = useState<MapTheme>('dark');

  // Search & Suggestions
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LandmarkItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Tuitions & Filter State
  const [tuitions, setTuitions] = useState<TuitionItem[]>([]);
  const [selectedTuition, setSelectedTuition] = useState<TuitionItem | null>(null);
  const [activeTab, setActiveTab] = useState<'tutor' | 'guardian'>('tutor');
  const [radiusFilter, setRadiusFilter] = useState<number>(3000); // 3km default
  const [classFilter, setClassFilter] = useState<string>('ALL');

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
    postCount: 5,
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
        postCount: data.database?.postCount || 5,
        cfConfigured: data.cloudflare?.configured || false
      });
    } catch (e) {
      console.warn('Status check failed:', e);
    }
  }, []);

  // Update commute radius circle overlay on map
  const updateRadiusCircle = useCallback((map: maplibregl.Map, center: [number, number], radius: number) => {
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
          'line-opacity': 0.8
        }
      });
    }
  }, []);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // Register PMTiles protocol for zero-cost basemaps
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    // Initialize local geo assets
    initGeoEngine();
    initSearchIndex();
    fetchSystemStatus();

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES.dark,
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
        <div class="pulse-circle" style="position: absolute; width: 38px; height: 38px; border-radius: 50%; background: rgba(37,99,235,0.25);"></div>
        <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 4px 18px rgba(37,99,235,0.8); display: flex; align-items: center; justify-content: center; color: white;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div style="position: absolute; top: 100%; width: 2px; height: 10px; background: #3b82f6;"></div>
        <div style="position: absolute; top: calc(100% + 10px); width: 8px; height: 3px; background: rgba(0,0,0,0.4); border-radius: 50%;"></div>
      </div>
    `;

    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([selectedCoords.lng, selectedCoords.lat])
      .addTo(map);

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      handleLocationChange(lngLat.lng, lngLat.lat);
      updateRadiusCircle(map, [lngLat.lng, lngLat.lat], radiusFilter);
    });

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      marker.setLngLat(e.lngLat);
      handleLocationChange(e.lngLat.lng, e.lngLat.lat);
      updateRadiusCircle(map, [e.lngLat.lng, e.lngLat.lat], radiusFilter);
    });

    map.on('load', () => {
      updateRadiusCircle(map, [selectedCoords.lng, selectedCoords.lat], radiusFilter);
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
  }, [handleLocationChange, selectedCoords.lat, selectedCoords.lng, fetchSystemStatus, updateRadiusCircle, radiusFilter]);

  // Sync radius circle when radiusFilter changes
  useEffect(() => {
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      updateRadiusCircle(mapRef.current, [selectedCoords.lng, selectedCoords.lat], radiusFilter);
    }
  }, [radiusFilter, selectedCoords.lng, selectedCoords.lat, updateRadiusCircle]);

  // Load tuition posts whenever location or radius filter changes
  useEffect(() => {
    let isCancelled = false;
    const loadData = async () => {
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
    };
    loadData();
    return () => {
      isCancelled = true;
    };
  }, [selectedCoords.lat, selectedCoords.lng, radiusFilter]);

  // Render tuition markers on map
  useEffect(() => {
    if (!mapRef.current) return;

    tuitionMarkersRef.current.forEach(m => m.remove());
    tuitionMarkersRef.current = [];

    const filtered = tuitions.filter(t => {
      if (classFilter === 'ALL') return true;
      return t.class_level.toLowerCase().includes(classFilter.toLowerCase());
    });

    filtered.forEach(tuition => {
      const el = document.createElement('div');
      el.className = 'tuition-marker';
      el.innerHTML = `
        <div style="background: rgba(11, 17, 30, 0.95); border: 2px solid #10b981; border-radius: 12px; padding: 4px 8px; box-shadow: 0 6px 18px rgba(16,185,129,0.45); display: flex; align-items: center; gap: 5px; color: #ffffff; font-family: var(--font-main);">
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
  }, [tuitions, classFilter]);

  // Switch Map Theme
  const handleThemeChange = (theme: MapTheme) => {
    setCurrentTheme(theme);
    setShowStyleMenu(false);
    if (!mapRef.current) return;
    mapRef.current.setStyle(MAP_STYLES[theme]);
    mapRef.current.once('style.load', () => {
      if (mapRef.current) {
        updateRadiusCircle(mapRef.current, [selectedCoords.lng, selectedCoords.lat], radiusFilter);
      }
    });
  };

  // Search input handler
  const handleSearchInput = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    const results = searchPlaces(q, 7);
    setSuggestions(results);
    setIsSearching(true);
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

  const handleQuickJump = (zone: typeof QUICK_ZONES[0]) => {
    if (mapRef.current && markerRef.current) {
      mapRef.current.flyTo({ center: [zone.lng, zone.lat], zoom: zone.zoom, pitch: 30, duration: 1600 });
      markerRef.current.setLngLat([zone.lng, zone.lat]);
      handleLocationChange(zone.lng, zone.lat);
      updateRadiusCircle(mapRef.current, [zone.lng, zone.lat], radiusFilter);
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

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
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
          maxWidth: '620px',
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
            placeholder="Search landmark (e.g. BUET, Curzon, Dhanmondi, Mirpur 10)..."
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
            >
              <X size={16} />
            </button>
          )}

          {/* Mode Switcher */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '10px', gap: 2 }}>
            <button
              id="btn-tutor-mode"
              onClick={() => setActiveTab('tutor')}
              style={{
                background: activeTab === 'tutor' ? '#2563eb' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '5px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background 0.15s ease'
              }}
            >
              Tutor
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
                padding: '5px 12px',
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

        {/* Quick Jump Hotspot Chips */}
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
              maxHeight: '320px',
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
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {item.thana}, {item.district}
                  </div>
                </div>
                <span className="badge badge-cyan">{item.type || 'Landmark'}</span>
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Floating HUD: Real-time Telemetry & Edge Diagnostics */}
      <div
        style={{
          position: 'absolute',
          top: 104,
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
          <span>Reverse Geocoder: <strong style={{ color: '#34d399' }}>{locationInfo.executionMs.toFixed(3)} ms</strong></span>
          <span className="badge badge-emerald">0 Network</span>
          {showHud ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showHud && (
          <div
            className="glass-panel-elevated animate-fade-in"
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              width: '310px',
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              fontSize: '12px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Spatial Computation:</span>
              <strong style={{ color: '#38bdf8' }}>Inline Ray-Cast + RBush</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Landmark Search:</span>
              <strong style={{ color: '#a78bfa' }}>Fuse.js Client RAM</strong>
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
              <strong style={{ color: '#38bdf8' }}>s-maxage=300 (SWR)</strong>
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
          top: 104,
          right: 16,
          zIndex: 90,
          display: 'flex',
          gap: 6
        }}
      >
        {/* Commute Radius Filter */}
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
            <option value={1000} style={{ background: '#0b111e' }}>Radius: 1 km</option>
            <option value={2000} style={{ background: '#0b111e' }}>Radius: 2 km</option>
            <option value={3000} style={{ background: '#0b111e' }}>Radius: 3 km</option>
            <option value={5000} style={{ background: '#0b111e' }}>Radius: 5 km</option>
            <option value={10000} style={{ background: '#0b111e' }}>Radius: 10 km</option>
            <option value={15000} style={{ background: '#0b111e' }}>Radius: 15 km</option>
          </select>
        </div>

        {/* Class Filter */}
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
            <option value="ALL" style={{ background: '#0b111e' }}>All Curriculums</option>
            <option value="Admission" style={{ background: '#0b111e' }}>Admission Prep</option>
            <option value="HSC" style={{ background: '#0b111e' }}>HSC Level</option>
            <option value="SSC" style={{ background: '#0b111e' }}>SSC Level</option>
          </select>
        </div>

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
            <span style={{ textTransform: 'capitalize' }}>{currentTheme}</span>
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
                minWidth: '130px',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 100
              }}
            >
              {(['dark', 'light', 'streets'] as MapTheme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => handleThemeChange(t)}
                  style={{
                    background: currentTheme === t ? 'rgba(37,99,235,0.3)' : 'transparent',
                    color: currentTheme === t ? '#60a5fa' : 'var(--text-primary)',
                    border: 'none',
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    borderBottom: '1px solid rgba(255,255,255,0.06)'
                  }}
                >
                  {t} Mode
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Floating Bar: Selected Dropped Pin Info */}
      <footer
        className="glass-panel-elevated"
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '92%',
          maxWidth: '580px',
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
            <span style={{ fontWeight: 700, letterSpacing: '0.4px' }}>SELECTED PIN (DRAGGABLE)</span>
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
          style={{ padding: '10px 18px' }}
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
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '92%',
            maxWidth: '540px',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            zIndex: 95,
            border: '1px solid rgba(16, 185, 129, 0.4)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)'
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

      {/* "Post a Tuition" Modal Drawer */}
      {postFormOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
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
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#fff',
                    fontFamily: 'var(--font-main)'
                  }}
                >
                  {classLevels.map((lvl) => (
                    <option key={lvl} value={lvl} style={{ background: '#0b111e' }}>
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
                          background: isSelected ? '#2563eb' : 'rgba(255,255,255,0.06)',
                          color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                          border: isSelected ? '1px solid #60a5fa' : '1px solid rgba(255,255,255,0.12)',
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
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '8px',
                      padding: '10px 10px 10px 28px',
                      color: '#fff',
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
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: '#fff',
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
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: '#fff',
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
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    padding: '9px 12px',
                    color: '#fff',
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
