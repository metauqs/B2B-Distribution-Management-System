const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to project-relative .cache/puppeteer
  // This guarantees build step and runtime look in the exact same directory on Render.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
