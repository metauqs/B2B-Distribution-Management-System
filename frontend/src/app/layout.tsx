import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Halal Vegg Supplies',
  description: 'Vegetable supply ledger for sales, purchases, clients, inventory, and collections',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
