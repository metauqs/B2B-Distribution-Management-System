import { Router } from 'express';
import puppeteer from 'puppeteer';

const router = Router();

// ── Shared Puppeteer helper ────────────────────────────────────────────────────

async function renderPage(html: string, width: number) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--font-render-hinting=none',
      '--enable-font-antialiasing',
      '--lang=en-GB',
    ],
  });

  const page = await browser.newPage();

  // A4 at 96 DPI = 794px wide; honour caller's width preference
  await page.setViewport({ width: Number(width), height: 1123, deviceScaleFactor: 3 });

  // Inject HTML and wait for all network (fonts, images) to settle
  await page.setContent(html, { waitUntil: 'networkidle0' as any, timeout: 30000 });

  // Wait for web fonts (Noto Nastaliq Urdu, Inter, IBM Plex Mono) to fully load and shape
  await page.evaluate(async () => {
    const d = (globalThis as any).document;
    if (d?.fonts?.ready) await d.fonts.ready;
    // Extra tick for HarfBuzz text shaping to finalise RTL glyph runs
    await new Promise((r) => setTimeout(r, 600));
  });

  return { browser, page };
}

// ── POST /api/render/pdf ── Returns raw PDF bytes ─────────────────────────────
router.post('/pdf', async (req, res) => {
  const { html, width = 794 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  let browser;
  try {
    const result = await renderPage(html, Number(width));
    browser = result.browser;
    const page = result.page;

    const pdfBuffer = await page.pdf({
      format: 'A4' as any,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('PDF render failed:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// ── POST /api/render/png ── Returns high-res PNG screenshot ──────────────────
router.post('/png', async (req, res) => {
  const { html, width = 794 } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'HTML is required' });

  let browser;
  try {
    const result = await renderPage(html, Number(width));
    browser = result.browser;
    const page = result.page;

    // Resize viewport to full content height so screenshot captures the whole page
    const bodyHeight = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.scrollHeight || 1123;
    });
    await page.setViewport({ width: Number(width), height: bodyHeight + 20, deviceScaleFactor: 3 });

    const screenshot = await page.screenshot({ type: 'png', fullPage: true });

    res.setHeader('Content-Type', 'image/png');
    res.send(screenshot);
  } catch (err: any) {
    console.error('PNG render failed:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

export default router;
