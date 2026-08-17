import type { NextConfig } from 'next';
import path from 'path';

const projectRoot = path.resolve(process.cwd(), '../');

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    optimizePackageImports: [
      '@mdi/js',
      '@mdi/react',
      'lucide-react',
      '@solar-icons/react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-toast',
    ],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
  },
  async headers() {
    return [
      {
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*.(png|avif|webp|svg|ico|woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
    return [
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      },
    ];
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.extensions = config.resolve.extensions || ['.js', '.jsx', '.ts', '.tsx', '.json'];
    if (!config.resolve.extensions.includes('.mjs')) config.resolve.extensions.push('.mjs');
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@solar-icons/react'] = path.resolve(process.cwd(), 'node_modules', '@solar-icons', 'react', 'dist', 'esm', 'index.mjs');
    return config;
  },
};

export default nextConfig;
