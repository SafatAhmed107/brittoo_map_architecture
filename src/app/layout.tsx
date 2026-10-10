import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tuition Media - Zero-Cost Serverless Map Architecture',
  description: 'Ultra-scalable zero-cost spatial map architecture for tuition discovery with client-side reverse geocoding and edge-quantized MVT caching.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('[Service Worker] Registered for offline precache:', reg.scope))
                    .catch(err => console.warn('[Service Worker] Registration failed:', err));
                });
              }
            `
          }}
        />
      </body>
    </html>
  );
}
