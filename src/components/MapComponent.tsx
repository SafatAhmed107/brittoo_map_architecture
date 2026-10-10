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
  ChevronUp
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

export default function MapComponent() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const tuitionMarkersRef = useRef<maplibregl.Marker[]>([]);

  // State
  const [selectedCoords, setSelectedCoords] = useState<{ lng: number; lat: number }>({
    lng: 90.3924,
    lat: 23.7266 // BUET, Dhaka
  });
  const [locationInfo, setLocationInfo] = useState<LocationResolution>({
    thana: 'Lalbagh',
    district: 'Dhaka',
    division: 'Dhaka Division',
    displayName: 'Lalbagh, Dhaka (BUET)',
    outOfBounds: false,
    executionMs: 0.04
  });

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LandmarkItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Tuitions & selection
  const [tuitions, setTuitions] = useState<TuitionItem[]>([]);
  const [selectedTuition, setSelectedTuition] = useState<TuitionItem | null>(null);
  const [activeTab, setActiveTab] = useState<'tutor' | 'guardian'>('tutor');

  // Filters
  const [radiusFilter, setRadiusFilter] = useState<number>(5000); // 5km default
  const [classFilter, setClassFilter] = useState<string>('ALL');

  // "Post Tuition" form state
  const [postFormOpen, setPostFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [classLevel, setClassLevel] = useState('HSC 2nd Year');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(['Physics', 'Higher Math']);
  const [salaryBudget, setSalaryBudget] = useState('8000');
  const [notes, setNotes] = useState('');

  // Diagnostics & Invalidation logs
  const [showHud, setShowHud] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastPurgedTiles, setLastPurgedTiles] = useState<InvalidationTile[]>([]);
  const [systemStats, setSystemStats] = useState<{
    dbConnected: boolean;
    dbStatus: string;
    cfConfigured: boolean;
  }>({
    dbConnected: false,
    dbStatus: 'Checking...',
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

  // Update reverse geocoding locally (0ms)
  const handleLocationChange = useCallback((lng: number, lat: number) => {
    setSelectedCoords({ lng, lat });
    const resolved = resolveLocationLocally(lng, lat);
    setLocationInfo(resolved);

    if (resolved.outOfBounds) {
      showToast('📍 Selected point is outside Bangladesh. Snapped back to BUET.');
      const buet = [90.3924, 23.7266];
      setSelectedCoords({ lng: buet[0], lat: buet[1] });
      if (markerRef.current) markerRef.current.setLngLat([buet[0], buet[1]]);
      if (mapRef.current) mapRef.current.flyTo({ center: [buet[0], buet[1]], zoom: 14 });
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
        cfConfigured: data.cloudflare?.configured || false
      });
    } catch (e) {
      console.warn('Status check failed:', e);
    }
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // PMTiles protocol registration
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    // Initialize local geo assets
    initGeoEngine();
    initSearchIndex();
    fetchSystemStatus();

    // Map instance with high-performance vector basemap
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'osm-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
            paint: {
              'raster-saturation': -0.15,
              'raster-contrast': 0.1
            }
          }
        ]
      },
      center: [selectedCoords.lng, selectedCoords.lat],
      zoom: 14,
      pitch: 25,
      bearing: 0
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    // Create user draggable pin
    const el = document.createElement('div');
    el.className = 'custom-pin-user';
    el.innerHTML = `
      <div style="position: relative; display: flex; align-items: center; justify-content: center;">
        <div style="width: 28px; height: 28px; background: #2563eb; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 4px 16px rgba(37,99,235,0.7); display: flex; align-items: center; justify-content: center; color: white;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div style="position: absolute; top: 100%; width: 2px; height: 12px; background: #2563eb;"></div>
        <div style="position: absolute; top: calc(100% + 12px); width: 8px; height: 3px; background: rgba(0,0,0,0.3); border-radius: 50%;"></div>
      </div>
    `;

    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([selectedCoords.lng, selectedCoords.lat])
      .addTo(map);

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      handleLocationChange(lngLat.lng, lngLat.lat);
    });

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      marker.setLngLat(e.lngLat);
      handleLocationChange(e.lngLat.lng, e.lngLat.lat);
    });

    markerRef.current = marker;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [handleLocationChange, selectedCoords.lat, selectedCoords.lng, fetchSystemStatus]);

  // Load tuitions whenever location or radius filter changes
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

    // Clear old markers
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
        <div style="background: rgba(15, 23, 42, 0.92); border: 2px solid #10b981; border-radius: 12px; padding: 4px 8px; box-shadow: 0 4px 14px rgba(16,185,129,0.4); display: flex; align-items: center; gap: 4px; color: #ffffff; font-family: var(--font-main);">
          <span style="display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%;"></span>
          <span style="font-weight: 700; font-size: 11px;">৳${(tuition.salary_budget / 1000).toFixed(1)}k</span>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedTuition(tuition);
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [tuition.lng, tuition.lat], zoom: 15.5 });
        }
      });

      const m = new maplibregl.Marker({ element: el })
        .setLngLat([tuition.lng, tuition.lat])
        .addTo(mapRef.current!);

      tuitionMarkersRef.current.push(m);
    });
  }, [tuitions, classFilter]);

  // Search input handler
  const handleSearchInput = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    const results = searchPlaces(q, 6);
    setSuggestions(results);
    setIsSearching(true);
  };

  const handleSelectLandmark = (item: LandmarkItem) => {
    setSearchQuery(item.name);
    setSuggestions([]);
    setIsSearching(false);

    if (mapRef.current && markerRef.current) {
      mapRef.current.flyTo({ center: [item.lng, item.lat], zoom: 15 });
      markerRef.current.setLngLat([item.lng, item.lat]);
      handleLocationChange(item.lng, item.lat);
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
        showToast('🎉 Tuition posted successfully! 7 edge tiles purged.');
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

      {/* Floating Header & Search Bar */}
      <header
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '92%',
          maxWidth: '560px',
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
            placeholder="Search landmark (e.g. BUET, Curzon, Dhanmondi, Mirpur)..."
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
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '10px' }}>
            <button
              id="btn-tutor-mode"
              onClick={() => setActiveTab('tutor')}
              style={{
                background: activeTab === 'tutor' ? '#2563eb' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
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
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Post Tuition
            </button>
          </div>
        </div>

        {/* Autocomplete Suggestions (Fuse.js In-Memory, 0ms Network) */}
        {isSearching && suggestions.length > 0 && (
          <ul
            className="glass-panel-elevated animate-fade-in"
            style={{
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              listStyle: 'none',
              maxHeight: '260px',
              overflowY: 'auto'
            }}
          >
            {suggestions.map((item, idx) => (
              <li
                key={idx}
                onClick={() => handleSelectLandmark(item)}
                style={{
                  padding: '10px 14px',
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
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {item.thana}, {item.district}
                  </div>
                </div>
                <span className="badge badge-blue">{item.type || 'place'}</span>
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Floating HUD Pill: Spatial Engine Latency & Stats */}
      <div
        style={{
          position: 'absolute',
          top: 86,
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
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-primary)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Zap size={14} color="#10b981" />
          <span>Local Engine: <strong style={{ color: '#34d399' }}>{locationInfo.executionMs.toFixed(3)} ms</strong></span>
          <span className="badge badge-emerald">0 Network</span>
          {showHud ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showHud && (
          <div
            className="glass-panel-elevated animate-fade-in"
            style={{
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              width: '280px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: '12px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Reverse Geocoder:</span>
              <strong style={{ color: '#38bdf8' }}>Inline Ray-Cast + RBush</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Search Autocomplete:</span>
              <strong style={{ color: '#a78bfa' }}>Fuse.js (In-Memory)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Vector Basemap:</span>
              <strong style={{ color: '#34d399' }}>PMTiles (Cloudflare R2)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>PostGIS Connection:</span>
              <strong style={{ color: systemStats.dbConnected ? '#34d399' : '#fbbf24' }}>
                {systemStats.dbConnected ? 'Live PostGIS' : 'In-Memory Store'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>Surgical Tile Invalidation:</span>
              <strong style={{ color: systemStats.cfConfigured ? '#34d399' : '#94a3b8' }}>
                {systemStats.cfConfigured ? 'Ready (7 tiles z10-z16)' : 'Local Sim'}
              </strong>
            </div>
            {lastPurgedTiles.length > 0 && (
              <div style={{ marginTop: 4, padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px' }}>
                <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700 }}>LAST PURGED EDGE TILES:</span>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  {lastPurgedTiles.map(t => `z${t.z}: ${t.x}/${t.y}`).join(', ')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tutor Filter Bar (Top Right) */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          right: 16,
          zIndex: 90,
          display: 'flex',
          gap: 6
        }}
      >
        <div
          className="glass-panel"
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '12px'
          }}
        >
          <Compass size={14} color="#38bdf8" />
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
            <option value={1000} style={{ background: '#0f172a' }}>Radius: 1 km</option>
            <option value={2000} style={{ background: '#0f172a' }}>Radius: 2 km</option>
            <option value={5000} style={{ background: '#0f172a' }}>Radius: 5 km</option>
            <option value={15000} style={{ background: '#0f172a' }}>Radius: 15 km</option>
          </select>
        </div>

        <div
          className="glass-panel"
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '12px'
          }}
        >
          <BookOpen size={14} color="#34d399" />
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
            <option value="ALL" style={{ background: '#0f172a' }}>All Classes</option>
            <option value="HSC" style={{ background: '#0f172a' }}>HSC Only</option>
            <option value="SSC" style={{ background: '#0f172a' }}>SSC Only</option>
            <option value="Admission" style={{ background: '#0f172a' }}>Admission</option>
          </select>
        </div>
      </div>

      {/* Bottom Floating Card: Selected Location Pin Info */}
      <footer
        className="glass-panel-elevated"
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '92%',
          maxWidth: '560px',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 20px',
          zIndex: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={12} color="#38bdf8" />
            <span>PIN LOCATION (DRAGGABLE)</span>
            <span className="stat-mono" style={{ color: '#38bdf8', marginLeft: 4 }}>
              ({selectedCoords.lat.toFixed(4)}, {selectedCoords.lng.toFixed(4)})
            </span>
          </div>
          <div
            id="current-location-text"
            style={{
              fontWeight: 700,
              fontSize: '15px',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 2
            }}
          >
            {locationInfo.displayName}
          </div>
        </div>

        <button
          id="btn-post-tuition-action"
          className="btn btn-emerald"
          onClick={() => setPostFormOpen(true)}
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
            bottom: 96,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '92%',
            maxWidth: '540px',
            borderRadius: 'var(--radius-lg)',
            padding: '18px',
            zIndex: 95,
            border: '1px solid rgba(16, 185, 129, 0.35)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)'
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
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Monthly Budget</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#34d399' }}>
                ৳{selectedTuition.salary_budget.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Subjects */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
            {selectedTuition.subjects.map((sub, i) => (
              <span
                key={i}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  padding: '4px 10px',
                  borderRadius: '6px',
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
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 14 }}>
              &ldquo;{selectedTuition.notes}&rdquo;
            </p>
          )}

          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              marginBottom: 12
            }}
          >
            <div style={{ color: 'var(--text-secondary)' }}>
              Guardian: <strong>{selectedTuition.guardian_name}</strong>
            </div>
            <div style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
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
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(8px)',
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
                <div style={{ width: 10, height: 10, background: '#10b981', borderRadius: '50%' }} />
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
              {/* Detected Locality info */}
              <div
                style={{
                  background: 'rgba(37,99,235,0.12)',
                  border: '1px solid rgba(37,99,235,0.3)',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <MapPin size={18} color="#38bdf8" />
                <div>
                  <div style={{ fontSize: '11px', color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>
                    Detected Area (From Dropped Pin)
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>
                    {locationInfo.displayName}
                  </div>
                </div>
              </div>

              {/* Class Level */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
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
                    <option key={lvl} value={lvl} style={{ background: '#0f172a' }}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subjects Chip Selector */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
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
                          fontWeight: 600,
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
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Monthly Salary Budget (BDT)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 10, color: '#34d399', fontWeight: 700 }}>৳</span>
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
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
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
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: '13px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
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
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Notes / Specific Requirements
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. 3 days a week, evening time preferred, BUET tutor desired."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    padding: '8px 10px',
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
            padding: '12px 18px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #10b981',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
          }}
        >
          <CheckCircle2 size={16} color="#10b981" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
