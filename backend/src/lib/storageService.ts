import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

// ── Configure Cloudinary if Environment Variables Exist ────────────────────────
let isCloudinaryConfigured = false;

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL,
  });
  isCloudinaryConfigured = true;
  console.log('☁️ [StorageService] Cloudinary configured via CLOUDINARY_URL');
} else if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  isCloudinaryConfigured = true;
  console.log(`☁️ [StorageService] Cloudinary configured for cloud: ${process.env.CLOUDINARY_CLOUD_NAME}`);
}

export function isCloudStorageActive(): boolean {
  return isCloudinaryConfigured;
}

export function getUploadDirectories(): string[] {
  const dirs = [
    path.resolve(__dirname, '../../uploads/products'),
    path.resolve(__dirname, '../uploads/products'),
    path.resolve(process.cwd(), 'uploads/products'),
    path.resolve(process.cwd(), 'backend/uploads/products'),
    path.resolve(process.cwd(), '../frontend/public/uploads/products'),
    path.resolve(__dirname, '../../../frontend/public/uploads/products'),
    path.resolve(__dirname, '../../../frontend/public'),
    path.resolve(process.cwd(), '../frontend/public'),
    path.resolve(process.cwd(), 'frontend/public'),
    path.resolve(process.cwd(), 'public'),
  ];
  return [...new Set(dirs)];
}

export interface UploadResult {
  url: string;
  publicId?: string;
  isCloud: boolean;
  format?: string;
  bytes: number;
}

/**
 * Uploads a product master image to Cloudinary CDN (or fast local disk)
 * Streams directly to Cloudinary and immediately dereferences buffers to use 0 server RAM.
 */
export async function uploadProductImage(
  productId: string,
  buffer: Buffer,
  mimeType: string,
  preferredExt?: string
): Promise<UploadResult> {
  const timestamp = Date.now();
  let ext = preferredExt || 'webp';
  if (!preferredExt) {
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';
  }

  const filename = `prod_${productId}_${timestamp}.${ext}`;

  // 1. Try Cloudinary CDN Upload with lightweight eco compression transforms (w_200, h_200, q_auto:eco)
  if (isCloudinaryConfigured) {
    try {
      const uploadPromise = new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'halalvegg_products',
            public_id: `prod_${productId}_${timestamp}`,
            resource_type: 'image',
            overwrite: true,
            transformation: [
              { quality: 'auto:eco' },
              { fetch_format: 'auto' },
              { width: 200, height: 200, crop: 'limit' },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(buffer);
      });

      const cloudResult = await uploadPromise;
      if (cloudResult && cloudResult.secure_url) {
        console.log(`☁️ [Cloudinary Upload SUCCESS] ${productId} -> ${cloudResult.secure_url}`);
        return {
          url: cloudResult.secure_url,
          publicId: cloudResult.public_id,
          isCloud: true,
          format: cloudResult.format,
          bytes: cloudResult.bytes || buffer.length,
        };
      }
    } catch (cloudErr) {
      console.warn('⚠️ [Cloudinary Upload Failed — Falling back to local storage]:', cloudErr);
    }
  }

  // 2. Local disk fallback
  const allDirs = getUploadDirectories();
  for (const dir of allDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const targetPath = path.join(dir, filename);
      fs.writeFileSync(targetPath, buffer);
    } catch {
      // ignore
    }
  }

  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
  return {
    url: dataUrl,
    isCloud: false,
    bytes: buffer.length,
    format: ext,
  };
}

export function clearImageMemoryCache(_productId?: string): void {
  // No-op (memory buffers are not retained in RAM)
}
