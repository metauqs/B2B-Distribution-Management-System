import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HALAL VEGG SUPPLIES',
  description: 'Vegetable supply ledger for sales, purchases, clients, inventory, and collections',
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
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
