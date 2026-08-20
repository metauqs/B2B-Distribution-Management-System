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
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.gif': 'image/gif',
    };
    const contentType = mimeTypes[ext] || 'image/png';

    const searchDirs = [
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
        return { filePath: candidate, contentType };
      }
    }
  } catch (err) {
    console.warn('[resolveLocalAsset error]', err);
  }
  return null;
}

// ── Shared Singleton Puppeteer Browser Instance ────────────────────────────────
let sharedBrowser: any = null;

async function getSharedBrowser() {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
        '--enable-font-antialiasing',
        '--lang=en-GB',
      ],
    });
  }
  return sharedBrowser;
}

import { getProductFallbackEmoji, generateProductSvgFallback } from './products';

async function setupRenderPage(browser: any, width: number, scaleFactor = 2.5) {
  const page = await browser.newPage();
  const requestedWidth = Number(width) || 794;
  await page.setViewport({ width: requestedWidth, height: 1123, deviceScaleFactor: scaleFactor });

  await page.setRequestInterception(true);
  page.on('request', (req: any) => {
    const url = req.url();
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

    // If it's a product image URL that was not found on disk, return crisp SVG fallback
    if (url.includes('/api/products/image/') || url.includes('/uploads/products/')) {
      const filename = path.basename(url.split('?')[0]);
      const fallbackEmoji = getProductFallbackEmoji(filename);
      const svg = generateProductSvgFallback(fallbackEmoji);
      return req.respond({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(svg, 'utf-8'),
      });
    }

    req.continue();
  });

  return page;
}

// ── In-Memory Hash Cache for Rendered JPGs / PNGs ──────────────────────────────
interface CachedImage {
  buffer: Buffer;
  contentType: string;
  createdAt: number;
}

const imageCache = new Map<string, CachedImage>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL

function getCachedImage(html: string, optionsKey: string): Buffer | null {
  const hash = crypto.createHash('md5').update(`${html}_${optionsKey}`).digest('hex');
  const entry = imageCache.get(hash);
  if (entry && Date.now() - entry.createdAt < CACHE_TTL_MS) {
    return entry.buffer;
  }
  if (entry) imageCache.delete(hash);
  return null;
}

function setCachedImage(html: string, optionsKey: string, buffer: Buffer, contentType: string) {
  const hash = crypto.createHash('md5').update(`${html}_${optionsKey}`).digest('hex');
  if (imageCache.size > 100) {
    const firstKey = imageCache.keys().next().value;
    if (firstKey) imageCache.delete(firstKey);
  }
  imageCache.set(hash, { buffer, contentType, createdAt: Date.now() });
}

// ── POST /api/render/jpeg ── Direct High-Speed JPEG Screenshot ───────────────
router.post('/jpeg', async (req, res) => {
  const startTime = Date.now();
  const { html, width = 794, quality = 88 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  const optionsKey = `jpeg_${width}_${quality}`;
  const cachedBuffer = getCachedImage(html, optionsKey);
  if (cachedBuffer) {
    const durationMs = Date.now() - startTime;
    console.log(`⚡ [JPG Render Cache HIT] ${durationMs}ms`);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Render-Cache', 'HIT');
    return res.send(cachedBuffer);
  }

  let page: any = null;
  try {
    const bStart = Date.now();
    const browser = await getSharedBrowser();
    const browserTime = Date.now() - bStart;

    const pageStart = Date.now();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 2.5);

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Fast font & image readiness check with hard 400ms timeout
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

    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: requestedWidth, height: bodyHeight + 10, deviceScaleFactor: 2.5 });

    const genStart = Date.now();
    const jpegBuffer = await page.screenshot({
      type: 'jpeg',
      quality: Math.min(100, Math.max(50, Number(quality) || 88)),
      fullPage: true,
    });
    const genTime = Date.now() - genStart;

    setCachedImage(html, optionsKey, jpegBuffer, 'image/jpeg');

    const totalTime = Date.now() - startTime;
    console.log(`📸 [JPG Render MISS] Total: ${totalTime}ms (Browser: ${browserTime}ms, Page/Render: ${Date.now() - pageStart}ms, Screenshot: ${genTime}ms)`);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Render-Cache', 'MISS');
    return res.send(jpegBuffer);
  } catch (err: any) {
    console.error('JPEG render failed:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Image generation failed' });
  } finally {
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
  const cachedBuffer = getCachedImage(html, optionsKey);
  if (cachedBuffer) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Render-Cache', 'HIT');
    return res.send(cachedBuffer);
  }

  let page: any = null;
  try {
    const browser = await getSharedBrowser();
    const requestedWidth = Number(width) || 794;
    page = await setupRenderPage(browser, requestedWidth, 2.5);

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: requestedWidth, height: bodyHeight + 10, deviceScaleFactor: 2.5 });

    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    setCachedImage(html, optionsKey, screenshot, 'image/png');

    console.log(`📸 [PNG Render] ${Date.now() - startTime}ms`);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Render-Cache', 'MISS');
    return res.send(screenshot);
  } catch (err: any) {
    console.error('PNG render failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
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

export default router;
