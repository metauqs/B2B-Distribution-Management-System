const path = require('path');

/**
 * Ensure Next resolves modules from the frontend folder and supports .mjs
 * This also sets the turbopack root to avoid incorrect workspace root inference warnings.
 */
module.exports = {
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.extensions = config.resolve.extensions || ['.js', '.jsx', '.ts', '.tsx', '.json'];
    if (!config.resolve.extensions.includes('.mjs')) config.resolve.extensions.push('.mjs');
    config.resolve.alias = config.resolve.alias || {};
    // Prefer the package's ESM build if webpack has trouble resolving via "exports"
    config.resolve.alias['@solar-icons/react'] = path.resolve(__dirname, 'node_modules', '@solar-icons', 'react', 'dist', 'esm', 'index.mjs');
    return config;
  },
};
