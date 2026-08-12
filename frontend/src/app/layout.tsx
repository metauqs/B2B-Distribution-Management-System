import type { Metadata } from 'next';
import './globals.css';
import { StoreProvider } from '@/store/providers/StoreProvider';

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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
