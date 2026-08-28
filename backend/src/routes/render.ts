import { Router } from 'express';
import puppeteer, { Browser } from 'puppeteer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { findImageFile } from './products';

const router = Router();

// ── Local Asset Resolver for Puppeteer Headless Rendering ──────────────────────
function resolveLocalAsset(urlStr: string): { filePath: string; contentType: string } | null {
  try {
    const cleanUrl = urlStr.split('?')[0].split('#')[0];
    const filename = path.basename(cleanUrl);
    if (!filename) return null;

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png':   'image/png',
      '.jpg':   'image/jpeg',
      '.jpeg':  'image/jpeg',
      '.webp':  'image/webp',
      '.svg':   'image/svg+xml',
      '.gif':   'image/gif',
      // ── Fonts (critical: Puppeteer must serve these from disk) ──────────────
      '.woff2': 'font/woff2',
      '.woff':  'font/woff',
      '.ttf':   'font/ttf',
      '.otf':   'font/otf',
    };
    const contentType = mimeTypes[ext];
    if (!contentType) return null; // Unknown extension — abort rather than continue

    const searchDirs = [
      // ── Font search paths ───────────────────────────────────────────────────
      path.resolve(__dirname, '../../../frontend/public/fonts'),
      path.resolve(process.cwd(), '../frontend/public/fonts'),
      path.resolve(process.cwd(), 'public/fonts'),
      // ── Product image search paths ──────────────────────────────────────────
      path.resolve(__dirname, '../../uploads/products'),
      path.resolve(__dirname, '../uploads/products'),
      path.resolve(process.cwd(), 'uploads/products'),
      path.resolve(__dirname, '../../../frontend/public/uploads/products'),
      path.resolve(__dirname, '../../../frontend/public'),
      path.resolve(process.cwd(), '../frontend/public'),
      path.resolve(process.cwd(), 'public'),
    ];

    // ── Check product upload directories via findImageFile ──────────────────
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.svg' || ext === '.gif') {
      const productImageFile = findImageFile(filename);
      if (productImageFile && fs.existsSync(productImageFile)) {
        return { filePath: productImageFile, contentType };
      }
    }

    for (const dir of searchDirs) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) {
        try {
          const stats = fs.statSync(candidate);
          if (ext !== '.woff2' && ext !== '.woff' && ext !== '.ttf' && ext !== '.otf' && stats.size < 200) {
            continue;
          }
          return { filePath: candidate, contentType };
        } catch {
          return { filePath: candidate, contentType };
        }
      }
    }
  } catch (err) {
    console.warn('[resolveLocalAsset error]', err);
  }
  return null;
}

// ── Shared Singleton Puppeteer Browser Instance ────────────────────────────────
let sharedBrowser: Browser | null = null;
let idleCloseTimer: NodeJS.Timeout | null = null;
const IDLE_BROWSER_TIMEOUT_MS = 15000; // 15s after last render, close browser to free 100% RAM
let browserStarting: Promise<any> | null = null;

export function scheduleBrowserIdleClose() {
  if (idleCloseTimer) clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(async () => {
    if (sharedBrowser) {
      try {
        console.log('💤 [Puppeteer Idle] Closing browser to reclaim server RAM');
        await sharedBrowser.close();
      } catch {}
      sharedBrowser = null;
    }
  }, IDLE_BROWSER_TIMEOUT_MS);
  if (idleCloseTimer.unref) idleCloseTimer.unref();
}

/**
 * Returns a reusable Puppeteer Browser instance.
 * Launches on-demand with ultra-low memory flags and auto-closes when idle.
 */
async function getSharedBrowser(): Promise<Browser> {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }

  // If we already have a healthy browser, reuse it
  if (sharedBrowser && (sharedBrowser.connected || (sharedBrowser as any).isConnected?.())) {
    return sharedBrowser;
  }

  // If a launch is already in progress (concurrent callers), await it
  if (browserStarting) {
    return await browserStarting;
  }

  // Auto-discover Chromium/Chrome binary if available
  let executablePath: string | undefined = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    try {
      executablePath = await (puppeteer as any).executablePath();
    } catch {
      const candidatePaths = [
        path.resolve(process.cwd(), '.cache/puppeteer'),
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          executablePath = p;
          break;
        }
      }
    }
  }

  console.log(`🚀 [Puppeteer] Launching Chrome executable: ${executablePath || 'default-managed'}`);

  // Launch a new browser instance with low-memory single-process flags
  browserStarting = puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-threaded-scrolling',
      '--disable-accelerated-2d-canvas',
      '--disable-features=IsolateOrigins,site-per-process,AudioServiceOutOfProcess',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--no-zygote',
      '--single-process', // Low-memory and low-CPU single process mode
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-default-apps',
      '--mute-audio',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--font-render-hinting=none',
      '--enable-font-antialiasing',
      '--lang=en-GB',
      '--js-flags="--max-old-space-size=64"', // Bound Chromium V8 heap to 64MB
    ],
  }).then(browser => {
    sharedBrowser = browser;
    browserStarting = null;

    // Automatically relaunch if Chromium crashes
    browser.on('disconnected', () => {
      console.warn('[Puppeteer] Browser disconnected — will relaunch on next request');
      sharedBrowser = null;
      browserStarting = null;
    });

    return browser;
  }).catch(err => {
    browserStarting = null;
    throw err;
  });

  return await browserStarting;
}

/**
 * Pre-warms the Puppeteer browser + renders a tiny blank sentinel page.
 * Call this once at server startup so the first real user render is instant.
 */
export async function warmBrowser(): Promise<boolean> {
  const t0 = Date.now();
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>', { waitUntil: 'domcontentloaded', timeout: 5000 });
  await page.close();
  console.log(`🔥 [Puppeteer Warm-Up] Browser ready in ${Date.now() - t0}ms`);
  return true;
}

import { getProductFallbackEmoji, generateProductSvgFallback } from './products';

async function closePageSafely(page: any) {
  if (!page) return;
  try {
    if (typeof page.removeAllListeners === 'function') {
      page.removeAllListeners();
    }
    if (typeof page.isClosed !== 'function' || !page.isClosed()) {
      await page.close();
    }
  } catch {}
}

async function setupRenderPage(browser: any, width: number, scaleFactor = 1.2) {
  const page = await browser.newPage();
  const requestedWidth = Number(width) || 794;
  await page.setViewport({ width: requestedWidth, height: 1123, deviceScaleFactor: scaleFactor });

  await page.setRequestInterception(true);
  page.on('request', (req: any) => {
    const url = req.url();

    // ── 1. Serve local assets (fonts + product images) from disk ───────────────
    const asset = resolveLocalAsset(url);
    if (asset) {
      try {
        const body = fs.readFileSync(asset.filePath);
        return req.respond({
          status: 200,
          contentType: asset.contentType,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body,
        });
      } catch (e) {
        console.warn(`[Puppeteer Intercept] Failed to read ${asset.filePath}:`, e);
      }
    }

    // ── 2. Allow data: and blob: URIs ──────────────────────────────────────────
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return req.continue();
    }

    // ── 4. Allow Cloudinary CDN images and fonts to fetch via network ─────────
    const resourceType = req.resourceType();
    if (resourceType === 'image' || resourceType === 'font') {
      return req.continue();
    }

    // ── 5. Abort unnecessary resources (media, websockets, analytics) ──────────
    req.abort();
  });

  return page;
}

// ── In-Memory LRU Cache for Rendered JPGs / PNGs (Capped at 10 items) ─────────
interface CachedImage {
  buffer: Buffer;
  contentType: string;
  createdAt: number;
}

const imageCache = new Map<string, CachedImage>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL
const CACHE_MAX_SIZE = 10; // Strict cap of 10 renders max to keep RAM < 200MB

export function clearRenderCache(): void {
  imageCache.clear();
  inFlightRenders.clear();
}

function getCacheKey(html: string, optionsKey: string): string {
  return crypto.createHash('md5').update(`${html}_${optionsKey}`).digest('hex');
}

function getCachedImage(cacheKey: string): Buffer | null {
  const entry = imageCache.get(cacheKey);
  if (entry && Date.now() - entry.createdAt < CACHE_TTL_MS) {
    return entry.buffer;
  }
  if (entry) imageCache.delete(cacheKey);
  return null;
}

function setCachedImage(cacheKey: string, buffer: Buffer, contentType: string) {
  if (imageCache.size >= CACHE_MAX_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of imageCache.entries()) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) imageCache.delete(oldestKey);
  }
  imageCache.set(cacheKey, { buffer, contentType, createdAt: Date.now() });
}

// ── Sequential Render Queue Mutex ──────────────────────────────────────────────
// Ensures at most 1 heavy render occurs in Chromium at any moment, eliminating memory spikes
let renderQueueMutex = Promise.resolve();

function runInRenderQueue<T>(task: () => Promise<T>): Promise<T> {
  const next = renderQueueMutex.then(task, task);
  renderQueueMutex = next.then(() => {}, () => {});
  return next;
}

// ── In-Flight Deduplication — prevents rendering the same HTML twice concurrently ──
const inFlightRenders = new Map<string, Promise<Buffer>>();

// ── POST /api/render/jpeg ── Direct High-Speed JPEG Screenshot ───────────────
router.post('/jpeg', async (req, res) => {
  const startTime = Date.now();
  const { html, width = 794, quality = 88 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  const optionsKey = `jpeg_${width}_${quality}`;
  const cacheKey = getCacheKey(html, optionsKey);

  // ── Cache HIT ───────────────────────────────────────────────────────────────
  const cachedBuffer = getCachedImage(cacheKey);
  if (cachedBuffer) {
    console.log(`⚡ [JPG Render Cache HIT] ${Date.now() - startTime}ms`);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Render-Cache', 'HIT');
    return res.send(cachedBuffer);
  }

  // ── In-Flight Deduplication ─────────────────────────────────────────────────
  const existing = inFlightRenders.get(cacheKey);
  if (existing) {
    try {
      const buffer = await existing;
      console.log(`⚡ [JPG Render Deduplicated] ${Date.now() - startTime}ms`);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('X-Render-Cache', 'DEDUP');
      return res.send(buffer);
    } catch {
      // Fall through to render fresh
    }
  }

  // ── Fresh Render (Serialized to prevent concurrent Chromium memory spikes) ──
  let page: any = null;
  const renderPromise = runInRenderQueue(async (): Promise<Buffer> => {
    const t_browser = Date.now();
    const browser = await getSharedBrowser();
    const browserMs = Date.now() - t_browser;

    const t_page = Date.now();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 1.2);
    const pageMs = Date.now() - t_page;

    const t_content = Date.now();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const contentMs = Date.now() - t_content;

    // Robust font & image readiness check with decode() and natural dimension verification
    const t_fonts = Date.now();
    await page.evaluate(async () => {
      const d = (globalThis as any).document;
      if (d?.fonts?.ready) {
        await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 300))]);
      }
      const images = Array.from(d.querySelectorAll('img')) as any[];
      if (images.length > 0) {
        await Promise.race([
          Promise.all(images.map((img: any) => {
            img.loading = 'eager';
            const done = async () => {
              if (typeof img.decode === 'function') {
                try { await img.decode(); } catch {}
              }
              if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                img.style.display = 'none';
                const sibling = img.nextElementSibling;
                if (sibling) sibling.style.display = 'inline-flex';
              }
            };
            if (img.complete && img.naturalWidth > 0) return done();
            return new Promise<void>((r) => {
              img.onload = () => { done().then(() => r()); };
              img.onerror = () => {
                img.style.display = 'none';
                const sibling = img.nextElementSibling;
                if (sibling) sibling.style.display = 'inline-flex';
                r();
              };
            });
          })),
          new Promise((r) => setTimeout(r, 600)),
        ]);
      }
    });
    const fontsMs = Date.now() - t_fonts;

    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: requestedWidth, height: bodyHeight + 10, deviceScaleFactor: 1.2 });

    const t_shot = Date.now();
    const jpegBuffer = await page.screenshot({
      type: 'jpeg',
      quality: Math.min(100, Math.max(50, Number(quality) || 88)),
      fullPage: true,
      timeout: 15000,
    });
    const shotMs = Date.now() - t_shot;

    const totalMs = Date.now() - startTime;
    console.log(`📸 [JPG Render MISS] browser:${browserMs}ms page:${pageMs}ms content:${contentMs}ms fonts:${fontsMs}ms screenshot:${shotMs}ms | total:${totalMs}ms`);

    setCachedImage(cacheKey, jpegBuffer, 'image/jpeg');
    return jpegBuffer;
  });

  inFlightRenders.set(cacheKey, renderPromise);

  try {
    const jpegBuffer = await renderPromise;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Render-Cache', 'MISS');
    return res.send(jpegBuffer);
  } catch (err: any) {
    console.error('JPEG render failed:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Image generation failed' });
  } finally {
    inFlightRenders.delete(cacheKey);
    await closePageSafely(page);
    scheduleBrowserIdleClose();
  }
});

// ── POST /api/render/png ── Direct PNG Screenshot ───────────────────────────
router.post('/png', async (req, res) => {
  const startTime = Date.now();
  const { html, width = 794 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  const optionsKey = `png_${width}`;
  const cacheKey = getCacheKey(html, optionsKey);

  const cachedBuffer = getCachedImage(cacheKey);
  if (cachedBuffer) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Render-Cache', 'HIT');
    return res.send(cachedBuffer);
  }

  const existing = inFlightRenders.get(cacheKey);
  if (existing) {
    try {
      const buffer = await existing;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Render-Cache', 'DEDUP');
      return res.send(buffer);
    } catch {}
  }

  let page: any = null;
  const renderPromise = runInRenderQueue(async (): Promise<Buffer> => {
    const browser = await getSharedBrowser();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 1.2);

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Robust font & image readiness check with decode() and natural dimension verification
    await page.evaluate(async () => {
      const d = (globalThis as any).document;
      if (d?.fonts?.ready) {
        await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 300))]);
      }
      const images = Array.from(d.querySelectorAll('img')) as any[];
      if (images.length > 0) {
        await Promise.race([
          Promise.all(images.map((img: any) => {
            img.loading = 'eager';
            const done = async () => {
              if (typeof img.decode === 'function') {
                try { await img.decode(); } catch {}
              }
              if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                img.style.display = 'none';
                const sibling = img.nextElementSibling;
                if (sibling) sibling.style.display = 'inline-flex';
              }
            };
            if (img.complete && img.naturalWidth > 0) return done();
            return new Promise<void>((r) => {
              img.onload = () => { done().then(() => r()); };
              img.onerror = () => {
                img.style.display = 'none';
                const sibling = img.nextElementSibling;
                if (sibling) sibling.style.display = 'inline-flex';
                r();
              };
            });
          })),
          new Promise((r) => setTimeout(r, 600)),
        ]);
      }
    });

    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: requestedWidth, height: bodyHeight + 10, deviceScaleFactor: 1.2 });

    const screenshot = await page.screenshot({ type: 'png', fullPage: true, timeout: 15000 });
    console.log(`📸 [PNG Render] ${Date.now() - startTime}ms`);
    setCachedImage(cacheKey, screenshot, 'image/png');
    return screenshot;
  });

  inFlightRenders.set(cacheKey, renderPromise);

  try {
    const screenshot = await renderPromise;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Render-Cache', 'MISS');
    return res.send(screenshot);
  } catch (err: any) {
    console.error('PNG render failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    inFlightRenders.delete(cacheKey);
    await closePageSafely(page);
    scheduleBrowserIdleClose();
  }
});

// ── POST /api/render/pdf ── PDF Output Route ──────────────────────────────────
router.post('/pdf', async (req, res) => {
  const startTime = Date.now();
  const { html, width = 794 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  let page: any = null;
  try {
    const pdfBuffer = await runInRenderQueue(async () => {
      const browser = await getSharedBrowser();
      const requestedWidth = Number(width) || 794;
      page = await setupRenderPage(browser, requestedWidth, 1.2);

      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

      const buffer = await page.pdf({
        format: 'A4' as any,
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });
      return buffer;
    });

    console.log(`📄 [PDF Render] ${Date.now() - startTime}ms`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error('PDF render failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    await closePageSafely(page);
    scheduleBrowserIdleClose();
  }
});

// ── GET /api/render/warmup ── Keep-Alive / Render.com Free Tier Ping ─────────
// UptimeRobot pings this to verify renderer readiness and prevent cold starts.
router.get('/warmup', async (_req, res) => {
  try {
    await warmBrowser();
    return res.status(200).json({ success: true, status: 'warm', renderer: 'READY' });
  } catch (err: any) {
    console.error('❌ [Puppeteer Warm-Up Failed]:', err.message);
    return res.status(503).json({ success: false, status: 'error', renderer: 'UNAVAILABLE', error: err.message });
  }
});

export default router;
