import type { Metadata } from 'next';
import { IBM_Plex_Sans, Fraunces, IBM_Plex_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { StoreProvider } from '@/store/providers/StoreProvider';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const jameelKhushkhat = localFont({
  src: '../../public/fonts/jameel-khushkhat.woff2',
  variable: '--font-urdu',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'HALAL VEGG SUPPLIES',
  description: 'Vegetable supply ledger for sales, purchases, clients, inventory, and collections',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon.png', type: 'image/png' },
    ],
    shortcut: '/icon.svg',
    apple: '/icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${fraunces.variable} ${ibmPlexMono.variable} ${jameelKhushkhat.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
