import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react', '@solar-icons/react'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
