'use client';

import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#090d16',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: '#f8fafc',
        fontFamily: 'var(--font-main)'
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          border: '3px solid rgba(56, 189, 248, 0.2)',
          borderTopColor: '#38bdf8',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }}
      />
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.3px' }}>
          Loading Zero-Cost Map Architecture
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: 4 }}>
          Mounting WebGL Vector Canvas & Client Spatial Engines...
        </p>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
});

export default function Home() {
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <h1 style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}>
        Tuition Media - High Scale Zero Cost Map Architecture
      </h1>
      <MapComponent />
    </main>
  );
}
