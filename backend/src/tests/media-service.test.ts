import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { MediaTransformService } from '../services/media-transform.service.js';
import { extractApiCredentials } from '../middlewares/api-key.middleware.js';

describe('MediaTransformService (Cloudinary Image Transformation Engine)', () => {
  it('should accurately parse Cloudinary-style path transformation strings', () => {
    const parsed = MediaTransformService.parseTransformation('w_400,h_300,c_fill,q_80,f_webp,e_grayscale,r_max');

    expect(parsed.width).toBe(400);
    expect(parsed.height).toBe(300);
    expect(parsed.crop).toBe('fill');
    expect(parsed.quality).toBe(80);
    expect(parsed.format).toBe('webp');
    expect(parsed.grayscale).toBe(true);
    expect(parsed.radius).toBe('max');
  });

  it('should parse query parameters for transformations', () => {
    const query = {
      w: '600',
      h: '400',
      c: 'thumb',
      q: '90',
      f: 'png',
      blur: '3',
      r: '15',
    };
    const parsed = MediaTransformService.parseTransformation(undefined, query);

    expect(parsed.width).toBe(600);
    expect(parsed.height).toBe(400);
    expect(parsed.crop).toBe('thumb');
    expect(parsed.quality).toBe(90);
    expect(parsed.format).toBe('png');
    expect(parsed.blur).toBe(3);
    expect(parsed.radius).toBe(15);
  });

  it('should generate consistent and deterministic cache keys for image transformations', () => {
    const options1 = { width: 300, height: 200, format: 'webp' as const };
    const options2 = { format: 'webp' as const, height: 200, width: 300 };

    const key1 = MediaTransformService.getTransformationCacheKey('asset_123', options1);
    const key2 = MediaTransformService.getTransformationCacheKey('asset_123', options2);

    expect(key1).toBe(key2);
    expect(key1.startsWith('asset_123_')).toBe(true);
  });

  it('should transform a real image buffer into WebP with resized dimensions using Sharp', async () => {
    // Generate a clean 200x200 red square test image
    const sourceBuffer = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await MediaTransformService.transformImage(
      sourceBuffer,
      {
        width: 100,
        height: 100,
        crop: 'fill',
        format: 'webp',
        quality: 85,
      }
    );

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.contentType).toBe('image/webp');
    expect(result.format).toBe('webp');

    // Verify metadata of transformed output
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
    expect(meta.format).toBe('webp');
  });
});

describe('API Key Authentication Credentials Extraction', () => {
  it('should extract API credentials from X-API-Key and X-API-Secret headers', () => {
    const mockReq: any = {
      headers: {
        'x-api-key': 'cld_live_testkey123',
        'x-api-secret': 'sec_live_testsecret456',
      },
      query: {},
    };

    const creds = extractApiCredentials(mockReq);
    expect(creds.key).toBe('cld_live_testkey123');
    expect(creds.secret).toBe('sec_live_testsecret456');
  });

  it('should extract API credentials from Basic auth header', () => {
    const encoded = Buffer.from('cld_live_basic:sec_live_basicsecret').toString('base64');
    const mockReq: any = {
      headers: {
        authorization: `Basic ${encoded}`,
      },
      query: {},
    };

    const creds = extractApiCredentials(mockReq);
    expect(creds.key).toBe('cld_live_basic');
    expect(creds.secret).toBe('sec_live_basicsecret');
  });
});
