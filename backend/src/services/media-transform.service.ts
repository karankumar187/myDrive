import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { ITransformationOptions } from '../types/index.js';

const MEDIA_CACHE_DIR = path.resolve(process.cwd(), 'uploads', 'media_cache');
if (!fs.existsSync(MEDIA_CACHE_DIR)) {
  fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
}

export class MediaTransformService {
  /**
   * Parses Cloudinary-style transformation string or query parameters into ITransformationOptions.
   * Examples:
   *  "w_500,h_300,c_fill,q_80,f_webp"
   *  "w_200,h_200,c_thumb,r_max"
   *  "e_grayscale,e_blur:5"
   */
  static parseTransformation(input?: string, queryParams?: Record<string, any>): ITransformationOptions {
    const options: ITransformationOptions = {};

    // 1. Parse comma-separated path string if present (e.g. w_300,h_200,c_fill)
    if (input) {
      const parts = input.split(/[,/]/).map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.startsWith('w_')) {
          const val = parseInt(part.substring(2), 10);
          if (!isNaN(val) && val > 0) options.width = val;
        } else if (part.startsWith('h_')) {
          const val = parseInt(part.substring(2), 10);
          if (!isNaN(val) && val > 0) options.height = val;
        } else if (part.startsWith('c_')) {
          const mode = part.substring(2).toLowerCase();
          if (['fill', 'fit', 'crop', 'scale', 'thumb'].includes(mode)) {
            options.crop = mode as any;
          }
        } else if (part.startsWith('q_')) {
          const qVal = part.substring(2).toLowerCase();
          if (qVal === 'auto') {
            options.quality = 82;
          } else {
            const val = parseInt(qVal, 10);
            if (!isNaN(val) && val >= 1 && val <= 100) options.quality = val;
          }
        } else if (part.startsWith('f_')) {
          const fmt = part.substring(2).toLowerCase();
          if (['auto', 'webp', 'avif', 'png', 'jpeg', 'jpg'].includes(fmt)) {
            options.format = fmt === 'jpg' ? 'jpeg' : (fmt as any);
          }
        } else if (part === 'e_grayscale' || part === 'grayscale') {
          options.grayscale = true;
        } else if (part.startsWith('e_blur')) {
          const blurVal = part.includes(':') ? parseFloat(part.split(':')[1]) : 5;
          options.blur = isNaN(blurVal) ? 5 : Math.min(100, Math.max(0.3, blurVal));
        } else if (part.startsWith('r_')) {
          const rVal = part.substring(2).toLowerCase();
          if (rVal === 'max') {
            options.radius = 'max';
          } else {
            const val = parseInt(rVal, 10);
            if (!isNaN(val) && val >= 0) options.radius = val;
          }
        } else if (part.startsWith('a_')) {
          const val = parseInt(part.substring(2), 10);
          if (!isNaN(val)) options.rotate = val;
        }
      }
    }

    // 2. Query parameter overrides (e.g. ?w=300&h=200&c=fill&q=80&f=webp)
    if (queryParams) {
      if (queryParams.w || queryParams.width) {
        const val = parseInt(queryParams.w || queryParams.width, 10);
        if (!isNaN(val) && val > 0) options.width = val;
      }
      if (queryParams.h || queryParams.height) {
        const val = parseInt(queryParams.h || queryParams.height, 10);
        if (!isNaN(val) && val > 0) options.height = val;
      }
      if (queryParams.c || queryParams.crop || queryParams.fit) {
        const mode = (queryParams.c || queryParams.crop || queryParams.fit).toLowerCase();
        if (['fill', 'fit', 'crop', 'scale', 'thumb'].includes(mode)) {
          options.crop = mode as any;
        }
      }
      if (queryParams.q || queryParams.quality) {
        const qVal = (queryParams.q || queryParams.quality).toString().toLowerCase();
        if (qVal === 'auto') {
          options.quality = 82;
        } else {
          const val = parseInt(qVal, 10);
          if (!isNaN(val) && val >= 1 && val <= 100) options.quality = val;
        }
      }
      if (queryParams.f || queryParams.format) {
        const fmt = (queryParams.f || queryParams.format).toLowerCase();
        if (['auto', 'webp', 'avif', 'png', 'jpeg', 'jpg'].includes(fmt)) {
          options.format = fmt === 'jpg' ? 'jpeg' : (fmt as any);
        }
      }
      if (queryParams.grayscale === 'true' || queryParams.e_grayscale === 'true') {
        options.grayscale = true;
      }
      if (queryParams.blur) {
        const blurVal = parseFloat(queryParams.blur);
        if (!isNaN(blurVal)) options.blur = Math.min(100, Math.max(0.3, blurVal));
      }
      if (queryParams.r || queryParams.radius) {
        const rVal = (queryParams.r || queryParams.radius).toString().toLowerCase();
        if (rVal === 'max') {
          options.radius = 'max';
        } else {
          const val = parseInt(rVal, 10);
          if (!isNaN(val) && val >= 0) options.radius = val;
        }
      }
      if (queryParams.rotate) {
        const val = parseInt(queryParams.rotate, 10);
        if (!isNaN(val)) options.rotate = val;
      }
    }

    return options;
  }

  /**
   * Hashes transformation options for determinism and caching.
   */
  static getTransformationCacheKey(assetId: string, options: ITransformationOptions): string {
    const serialized = JSON.stringify(options, Object.keys(options).sort());
    const hash = crypto.createHash('sha256').update(`${assetId}:${serialized}`).digest('hex').substring(0, 24);
    return `${assetId}_${hash}`;
  }

  /**
   * Checks if an image transformation is already cached on disk.
   */
  static getCachedTransformedImage(assetId: string, options: ITransformationOptions): { buffer: Buffer; contentType: string } | null {
    const key = this.getTransformationCacheKey(assetId, options);
    const ext = options.format && options.format !== 'auto' ? options.format : 'webp';
    const filePath = path.join(MEDIA_CACHE_DIR, `${key}.${ext}`);

    if (fs.existsSync(filePath)) {
      try {
        const buffer = fs.readFileSync(filePath);
        const contentType = ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        return { buffer, contentType };
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Writes transformed image buffer to cache.
   */
  static cacheTransformedImage(assetId: string, options: ITransformationOptions, buffer: Buffer, format: string): void {
    try {
      const key = this.getTransformationCacheKey(assetId, options);
      const ext = format === 'jpeg' || format === 'jpg' ? 'jpeg' : format;
      const filePath = path.join(MEDIA_CACHE_DIR, `${key}.${ext}`);
      fs.writeFileSync(filePath, buffer);
    } catch (err) {
      console.warn('Failed to cache transformed image:', err);
    }
  }

  /**
   * Reads image dimensions, format, and metadata using Sharp.
   */
  static async extractImageMetadata(buffer: Buffer): Promise<{
    width?: number;
    height?: number;
    format?: string;
    space?: string;
    channels?: number;
  }> {
    try {
      const meta = await sharp(buffer).metadata();
      return {
        width: meta.width,
        height: meta.height,
        format: meta.format,
        space: meta.space,
        channels: meta.channels,
      };
    } catch {
      return {};
    }
  }

  /**
   * Applies the requested transformations to an image Buffer using Sharp.
   */
  static async transformImage(
    sourceBuffer: Buffer,
    options: ITransformationOptions,
    clientAcceptHeader?: string
  ): Promise<{ buffer: Buffer; contentType: string; format: string }> {
    // Check cache first
    let pipeline = sharp(sourceBuffer);

    // 1. Rotation
    if (typeof options.rotate === 'number') {
      pipeline = pipeline.rotate(options.rotate);
    } else {
      // Auto-orient based on EXIF
      pipeline = pipeline.rotate();
    }

    // 2. Resizing & Cropping
    if (options.width || options.height) {
      let fitMode: keyof sharp.FitEnum = 'cover';
      let position: string | number = 'centre';

      if (options.crop === 'fit') {
        fitMode = 'inside';
      } else if (options.crop === 'scale') {
        fitMode = 'fill';
      } else if (options.crop === 'thumb') {
        fitMode = 'cover';
        position = 'entropy'; // Smart focal point
      } else if (options.crop === 'crop') {
        fitMode = 'cover';
      }

      pipeline = pipeline.resize({
        width: options.width,
        height: options.height,
        fit: fitMode,
        position,
        withoutEnlargement: false,
      });
    }

    // 3. Effects: Grayscale
    if (options.grayscale) {
      pipeline = pipeline.grayscale();
    }

    // 4. Effects: Blur
    if (options.blur) {
      pipeline = pipeline.blur(options.blur);
    }

    // 5. Rounded corners / circular avatar
    if (options.radius) {
      const meta = await pipeline.metadata();
      const w = meta.width || options.width || 200;
      const h = meta.height || options.height || 200;
      const r = options.radius === 'max' ? Math.min(w, h) / 2 : Math.min(options.radius, Math.min(w, h) / 2);

      const circleSvg = Buffer.from(
        `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff" /></svg>`
      );

      pipeline = pipeline.composite([
        {
          input: circleSvg,
          blend: 'dest-in',
        },
      ]);
    }

    // 6. Target format and quality
    let targetFormat = options.format || 'auto';
    if (targetFormat === 'auto') {
      if (clientAcceptHeader?.includes('image/avif')) {
        targetFormat = 'avif';
      } else if (clientAcceptHeader?.includes('image/webp')) {
        targetFormat = 'webp';
      } else {
        targetFormat = 'webp'; // Default modern web format
      }
    }

    const quality = options.quality || 82;

    if (targetFormat === 'webp') {
      pipeline = pipeline.webp({ quality });
    } else if (targetFormat === 'avif') {
      pipeline = pipeline.avif({ quality });
    } else if (targetFormat === 'png') {
      pipeline = pipeline.png({ compressionLevel: 8 });
    } else if (targetFormat === 'jpeg') {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else {
      pipeline = pipeline.webp({ quality });
      targetFormat = 'webp';
    }

    const resultBuffer = await pipeline.toBuffer();
    const contentType = targetFormat === 'jpeg' ? 'image/jpeg' : `image/${targetFormat}`;

    return {
      buffer: resultBuffer,
      contentType,
      format: targetFormat,
    };
  }
}
