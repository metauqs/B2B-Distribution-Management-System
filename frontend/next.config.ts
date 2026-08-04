import type { NextConfig } from 'next';
import path from 'path';

const projectRoot = path.resolve(process.cwd(), '../');

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@solar-icons/react'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
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
