import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { StoreProvider } from '@/store/providers/StoreProvider';

const lora = localFont({
  src: [
    {
      path: '../../public/fonts/Lora-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Lora-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Lora-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Lora-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Lora-Italic-Variable.woff2',
      weight: '400 700',
      style: 'italic',
    },
  ],
  variable: '--font-lora',
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
    <html lang="en" className={`${lora.variable} ${jameelKhushkhat.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
