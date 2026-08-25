import { Router } from 'express';
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

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
let sharedBrowser: any = null;
let browserStarting: Promise<any> | null = null;

async function getSharedBrowser() {
  // If browser is already running and connected, return it
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  // If a launch is already in progress (concurrent callers), await it
  if (browserStarting) {
    return await browserStarting;
  }

  // Auto-discover Chromium/Chrome binary if available
  const candidatePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean) as string[];

  let executablePath: string | undefined = undefined;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      executablePath = p;
      break;
    }
  }

  // Launch a new browser instance
  browserStarting = puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-dev-shm-usage',
      '--disable-gpu',
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
export async function warmBrowser(): Promise<void> {
  try {
    const t0 = Date.now();
    const browser = await getSharedBrowser();
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>', { waitUntil: 'domcontentloaded', timeout: 5000 });
    await page.close();
    console.log(`🔥 [Puppeteer Warm-Up] Browser ready in ${Date.now() - t0}ms`);
  } catch (err) {
    console.warn('[Puppeteer Warm-Up] Failed (non-fatal):', err);
  }
}

import { getProductFallbackEmoji, generateProductSvgFallback } from './products';

async function setupRenderPage(browser: any, width: number, scaleFactor = 2.5) {
  const page = await browser.newPage();
  const requestedWidth = Number(width) || 794;
  await page.setViewport({ width: requestedWidth, height: 1123, deviceScaleFactor: scaleFactor });

  await page.setRequestInterception(true);
  page.on('request', (req: any) => {
    const url = req.url();

    // ── Serve local assets (fonts + product images) from disk ─────────────────
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

    // ── Allow data: and blob: URIs ─────────────────────────────────────────────
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return req.continue();
    }

    // ── Block all external network requests & missing assets ────────────────────
    // Fonts and verified images are served from disk above. Missing images abort
    // immediately so their onerror handlers instantly show native HTML emojis.
    req.abort();
  });

  return page;
}

// ── In-Memory LRU Cache for Rendered JPGs / PNGs ──────────────────────────────
interface CachedImage {
  buffer: Buffer;
  contentType: string;
  createdAt: number;
}

const imageCache = new Map<string, CachedImage>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL
const CACHE_MAX_SIZE = 100;

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
  // LRU eviction: remove the oldest entry when at capacity
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

  // ── Fresh Render ────────────────────────────────────────────────────────────
  let page: any = null;
  const renderPromise = (async (): Promise<Buffer> => {
    const t_browser = Date.now();
    const browser = await getSharedBrowser();
    const browserMs = Date.now() - t_browser;

    const t_page = Date.now();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 2.5);
    const pageMs = Date.now() - t_page;

    const t_content = Date.now();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const contentMs = Date.now() - t_content;

    // Fast font & image readiness check with hard 400ms timeout
    const t_fonts = Date.now();
    await page.evaluate(async () => {
      const d = (globalThis as any).document;
      if (d?.fonts?.ready) {
        await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 400))]);
      }
      const images = Array.from(d.querySelectorAll('img'));
      await Promise.race([
        Promise.all(images.map((img: any) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })))),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    });
    const fontsMs = Date.now() - t_fonts;

    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: requestedWidth, height: bodyHeight + 10, deviceScaleFactor: 2.5 });

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
  })();

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
    if (page) {
      try { await page.close(); } catch {}
    }
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
  const renderPromise = (async (): Promise<Buffer> => {
    const browser = await getSharedBrowser();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 2.5);

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: requestedWidth, height: bodyHeight + 10, deviceScaleFactor: 2.5 });

    const screenshot = await page.screenshot({ type: 'png', fullPage: true, timeout: 15000 });
    console.log(`📸 [PNG Render] ${Date.now() - startTime}ms`);
    setCachedImage(cacheKey, screenshot, 'image/png');
    return screenshot;
  })();

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
    if (page) {
      try { await page.close(); } catch {}
    }
  }
});

// ── POST /api/render/pdf ── PDF Output Route ──────────────────────────────────
router.post('/pdf', async (req, res) => {
  const startTime = Date.now();
  const { html, width = 794 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  let page: any = null;
  try {
    const browser = await getSharedBrowser();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 2.0);

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const pdfBuffer = await page.pdf({
      format: 'A4' as any,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    console.log(`📄 [PDF Render] ${Date.now() - startTime}ms`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error('PDF render failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
});

// ── GET /api/render/warmup ── Keep-Alive / Render.com Free Tier Ping ─────────
// UptimeRobot should ping this every 2 minutes to prevent Render.com cold starts.
router.get('/warmup', async (_req, res) => {
  // Non-blocking — respond immediately, warm browser in background
  res.status(200).json({ success: true, status: 'warm' });
  warmBrowser().catch(() => {}); // fire-and-forget
});

export default router;
