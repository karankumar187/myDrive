import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Album } from '../models/Album.js';
import { File } from '../models/File.js';
import { Device } from '../models/Device.js';

export class AlbumController {
  /**
   * List all albums for the authenticated user with computed cover previews,
   * item counts, date ranges, and contributor devices.
   */
  static async listAlbums(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const albums = await Album.find({ userId })
        .sort({ isPinned: -1, updatedAt: -1 })
        .lean();

      // Collect all coverFileIds and preview fileIds for batch querying
      const allCoverIds: Types.ObjectId[] = [];
      const allDeviceIds = new Set<string>();

      for (const alb of albums) {
        if (alb.coverFileId) {
          allCoverIds.push(alb.coverFileId);
        }
        if (alb.fileIds && alb.fileIds.length > 0) {
          // Load up to 8 photos per album for dynamic rotating slideshow banner
          for (const fid of alb.fileIds.slice(0, 8)) {
            allCoverIds.push(fid);
          }
        }
      }

      // Batch load files for covers
      const coverFiles = await File.find({
        _id: { $in: allCoverIds },
        userId,
        isTrash: false,
        isVault: { $ne: true },
      })
        .select('_id filename mimeType metadata sizeBytes publicId isFavorite createdAt')
        .lean();

      const coverMap = new Map<string, any>();
      for (const f of coverFiles) {
        coverMap.set(String(f._id), f);
      }

      // Collect sample file IDs across ALL albums in a single batch query (No N+1!)
      const allSampleIds: Types.ObjectId[] = [];
      const albumFileSampleMap = new Map<string, Types.ObjectId[]>();
      for (const alb of albums) {
        if (alb.fileIds && alb.fileIds.length > 0) {
          const sample = alb.fileIds.slice(0, 30);
          albumFileSampleMap.set(String(alb._id), sample);
          sample.forEach((id) => allSampleIds.push(id));
        }
      }

      const fileDeviceMap = new Map<string, string[]>();
      const allDevIdSet = new Set<string>();

      if (allSampleIds.length > 0) {
        const sampleFiles = await File.find({
          _id: { $in: allSampleIds },
          isTrash: false,
          isVault: { $ne: true },
        })
          .select('_id sourceDeviceIds')
          .lean();

        for (const sf of sampleFiles) {
          if (sf.sourceDeviceIds && sf.sourceDeviceIds.length > 0) {
            fileDeviceMap.set(String(sf._id), sf.sourceDeviceIds);
            sf.sourceDeviceIds.forEach((devId: string) => allDevIdSet.add(devId));
          }
        }
      }

      // Batch query all unique devices in 1 single fast query
      const deviceMap = new Map<string, { deviceId: string; deviceName: string; platform: string }>();
      if (allDevIdSet.size > 0) {
        const devices = await Device.find({
          deviceId: { $in: Array.from(allDevIdSet) },
          userId,
        })
          .select('deviceId deviceName deviceType osVersion')
          .lean();

        for (const d of devices) {
          deviceMap.set(d.deviceId, {
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            platform: (d as any).deviceType || (d as any).osVersion || 'device',
          });
        }
      }

      // Fast synchronous mapping without any nested database queries
      const result = albums.map((alb) => {
        const validFileCount = alb.fileIds?.length || 0;
        let cover = alb.coverFileId ? coverMap.get(String(alb.coverFileId)) : null;
        if (!cover && alb.fileIds?.length) {
          cover = coverMap.get(String(alb.fileIds[0])) || null;
        }

        const albumSampleIds = albumFileSampleMap.get(String(alb._id)) || [];
        const albumDevIdSet = new Set<string>();
        for (const fid of albumSampleIds) {
          const devIds = fileDeviceMap.get(String(fid));
          if (devIds) devIds.forEach((id) => albumDevIdSet.add(id));
        }

        const contributors = Array.from(albumDevIdSet)
          .map((id) => deviceMap.get(id))
          .filter(Boolean) as { deviceId: string; deviceName: string; platform: string }[];

        const albumPreviewFiles = (alb.fileIds || [])
          .slice(0, 8)
          .map((id) => coverMap.get(String(id)))
          .filter(Boolean);

        return {
          _id: alb._id,
          title: alb.title,
          description: alb.description || '',
          destination: alb.destination || { name: '' },
          coverFile: cover || (albumPreviewFiles.length > 0 ? albumPreviewFiles[0] : null),
          previewFiles: albumPreviewFiles,
          fileCount: validFileCount,
          startDate: alb.startDate || null,
          endDate: alb.endDate || null,
          isPinned: alb.isPinned || false,
          isFavorite: alb.isFavorite || false,
          themeGradient: alb.themeGradient || 'from-purple-900/60 via-indigo-950/40 to-black',
          contributors,
          createdAt: alb.createdAt,
          updatedAt: alb.updatedAt,
        };
      });

      res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
      res.json({ albums: result });
    } catch (error) {
      console.error('[AlbumController.listAlbums] Error:', error);
      res.status(500).json({ error: 'Failed to list albums' });
    }
  }

  /**
   * Get single album with full populated media files in chronological order
   */
  static async getAlbum(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      const { id } = req.params;

      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid album ID' });
        return;
      }

      const album = await Album.findOne({ _id: id, userId }).lean();
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }

      // Fetch all files contained in album that are not trashed and not in secret vault
      const files = await File.find({
        _id: { $in: album.fileIds || [] },
        userId,
        isTrash: false,
        isVault: { $ne: true },
      })
        .select('_id filename mimeType sizeBytes metadata isFavorite currentVersion publicId isMediaApi sourceDeviceIds createdAt')
        .sort({ 'metadata.takenAt': 1, createdAt: 1 })
        .lean();

      // Resolve cover file
      let cover = null;
      if (album.coverFileId) {
        cover = files.find((f) => String(f._id) === String(album.coverFileId)) || null;
        if (!cover) {
          cover = await File.findOne({ _id: album.coverFileId, userId, isTrash: false, isVault: { $ne: true } }).lean();
        }
      }
      if (!cover && files.length > 0) {
        cover = files[0];
      }

      // Collect contributor devices
      const devIdSet = new Set<string>();
      let totalSizeBytes = 0;
      let minDate: Date | null = album.startDate ? new Date(album.startDate) : null;
      let maxDate: Date | null = album.endDate ? new Date(album.endDate) : null;

      for (const f of files) {
        totalSizeBytes += f.sizeBytes || 0;
        if (f.sourceDeviceIds) {
          f.sourceDeviceIds.forEach((id: string) => devIdSet.add(id));
        }
        const fileDate = f.metadata?.takenAt ? new Date(f.metadata.takenAt) : new Date(f.createdAt);
        if (!minDate || fileDate < minDate) minDate = fileDate;
        if (!maxDate || fileDate > maxDate) maxDate = fileDate;
      }

      let contributors: { deviceId: string; deviceName: string; platform: string }[] = [];
      if (devIdSet.size > 0) {
        const devices = await Device.find({
          deviceId: { $in: Array.from(devIdSet) },
          userId,
        })
          .select('deviceId deviceName deviceType osVersion')
          .lean();

        contributors = devices.map((d) => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          platform: (d as any).deviceType || (d as any).osVersion || 'device',
        }));
      }

      res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
      res.json({
        album: {
          ...album,
          coverFile: cover,
          files,
          totalSizeBytes,
          fileCount: files.length,
          startDate: minDate,
          endDate: maxDate,
          contributors,
        },
      });
    } catch (error) {
      console.error('[AlbumController.getAlbum] Error:', error);
      res.status(500).json({ error: 'Failed to retrieve album' });
    }
  }

  /**
   * Create a new trip/collection album
   */
  static async createAlbum(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      const { title, description, destination, coverFileId, fileIds, startDate, endDate, isPinned, themeGradient } = req.body;

      if (!title || typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'Album title is required' });
        return;
      }

      // Sanitize fileIds to valid ObjectIds
      const validFileIds: Types.ObjectId[] = Array.isArray(fileIds)
        ? fileIds
            .filter((id: string) => Types.ObjectId.isValid(id))
            .map((id: string) => new Types.ObjectId(id))
        : [];

      let verifiedCoverId: Types.ObjectId | null = null;
      if (coverFileId && Types.ObjectId.isValid(coverFileId)) {
        verifiedCoverId = new Types.ObjectId(coverFileId);
      } else if (validFileIds.length > 0) {
        verifiedCoverId = validFileIds[0];
      }

      const album = new Album({
        userId,
        title: title.trim(),
        description: description?.trim() || '',
        destination: {
          name: destination?.name?.trim() || '',
          latitude: destination?.latitude || null,
          longitude: destination?.longitude || null,
        },
        coverFileId: verifiedCoverId,
        fileIds: validFileIds,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isPinned: Boolean(isPinned),
        themeGradient: themeGradient || 'from-purple-900/60 via-indigo-950/40 to-black',
      });

      await album.save();

      res.status(201).json({
        message: 'Album created successfully',
        album,
      });
    } catch (error) {
      console.error('[AlbumController.createAlbum] Error:', error);
      res.status(500).json({ error: 'Failed to create album' });
    }
  }

  /**
   * Update album metadata, cover, or pinned status
   */
  static async updateAlbum(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      const { id } = req.params;
      const { title, description, destination, coverFileId, startDate, endDate, isPinned, isFavorite, themeGradient } = req.body;

      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid album ID' });
        return;
      }

      const album = await Album.findOne({ _id: id, userId });
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }

      if (title !== undefined && title.trim()) album.title = title.trim();
      if (description !== undefined) album.description = description.trim();
      if (destination !== undefined) {
        album.destination = {
          name: destination.name !== undefined ? destination.name.trim() : album.destination?.name || '',
          latitude: destination.latitude !== undefined ? destination.latitude : album.destination?.latitude,
          longitude: destination.longitude !== undefined ? destination.longitude : album.destination?.longitude,
        };
      }
      if (coverFileId !== undefined) {
        album.coverFileId = coverFileId && Types.ObjectId.isValid(coverFileId) ? new Types.ObjectId(coverFileId) : undefined;
      }
      if (startDate !== undefined) album.startDate = startDate ? new Date(startDate) : undefined;
      if (endDate !== undefined) album.endDate = endDate ? new Date(endDate) : undefined;
      if (isPinned !== undefined) album.isPinned = Boolean(isPinned);
      if (isFavorite !== undefined) album.isFavorite = Boolean(isFavorite);
      if (themeGradient !== undefined) album.themeGradient = themeGradient;

      await album.save();

      res.json({ message: 'Album updated successfully', album });
    } catch (error) {
      console.error('[AlbumController.updateAlbum] Error:', error);
      res.status(500).json({ error: 'Failed to update album' });
    }
  }

  /**
   * Add photos to album
   */
  static async addPhotos(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      const { id } = req.params;
      const { fileIds } = req.body;

      if (!Types.ObjectId.isValid(id) || !Array.isArray(fileIds)) {
        res.status(400).json({ error: 'Invalid album ID or file list' });
        return;
      }

      const album = await Album.findOne({ _id: id, userId });
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }

      const existingSet = new Set(album.fileIds.map((f) => String(f)));
      let addedCount = 0;

      for (const fid of fileIds) {
        if (Types.ObjectId.isValid(fid) && !existingSet.has(String(fid))) {
          album.fileIds.push(new Types.ObjectId(fid));
          existingSet.add(String(fid));
          addedCount++;
        }
      }

      // If no cover file was set, use the first photo
      if (!album.coverFileId && album.fileIds.length > 0) {
        album.coverFileId = album.fileIds[0];
      }

      await album.save();

      res.json({
        message: `Added ${addedCount} photo(s) to album`,
        fileCount: album.fileIds.length,
      });
    } catch (error) {
      console.error('[AlbumController.addPhotos] Error:', error);
      res.status(500).json({ error: 'Failed to add photos to album' });
    }
  }

  /**
   * Remove photos from album (does not delete original files)
   */
  static async removePhotos(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      const { id } = req.params;
      const { fileIds } = req.body;

      if (!Types.ObjectId.isValid(id) || !Array.isArray(fileIds)) {
        res.status(400).json({ error: 'Invalid album ID or file list' });
        return;
      }

      const album = await Album.findOne({ _id: id, userId });
      if (!album) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }

      const removeSet = new Set(fileIds.map((f: string) => String(f)));
      album.fileIds = album.fileIds.filter((fid) => !removeSet.has(String(fid)));

      // If current cover was removed, reset to first remaining photo
      if (album.coverFileId && removeSet.has(String(album.coverFileId))) {
        album.coverFileId = album.fileIds.length > 0 ? album.fileIds[0] : undefined;
      }

      await album.save();

      res.json({
        message: 'Photos removed from album',
        fileCount: album.fileIds.length,
      });
    } catch (error) {
      console.error('[AlbumController.removePhotos] Error:', error);
      res.status(500).json({ error: 'Failed to remove photos from album' });
    }
  }

  /**
   * Delete album entity (original files are left untouched)
   */
  static async deleteAlbum(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      const { id } = req.params;

      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid album ID' });
        return;
      }

      const result = await Album.deleteOne({ _id: id, userId });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Album not found' });
        return;
      }

      res.json({ message: 'Album deleted successfully' });
    } catch (error) {
      console.error('[AlbumController.deleteAlbum] Error:', error);
      res.status(500).json({ error: 'Failed to delete album' });
    }
  }

  /**
   * Smart trip suggestions: Automatically clusters media by timestamp gaps & GPS coordinates
   */
  static async suggestTrips(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.user as any)?._id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Fetch recent 200 media files with timestamps (excluding secret vault files)
      const files = await File.find({
        userId,
        isTrash: false,
        isVault: { $ne: true },
        mimeType: { $regex: '^(image/|video/)' },
      })
        .select('_id filename mimeType metadata sizeBytes createdAt')
        .sort({ 'metadata.takenAt': -1, createdAt: -1 })
        .limit(200)
        .lean();

      if (files.length < 3) {
        res.json({ suggestions: [] });
        return;
      }

      // Cluster by time intervals (media taken within 48h of each other)
      const clusters: Array<{
        files: any[];
        startDate: Date;
        endDate: Date;
        location?: { latitude: number; longitude: number };
      }> = [];

      let currentCluster: any[] = [];
      const MAX_GAP_MS = 48 * 60 * 60 * 1000; // 48 hours

      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const itemTime = new Date(item.metadata?.takenAt || item.createdAt).getTime();

        if (currentCluster.length === 0) {
          currentCluster.push(item);
        } else {
          const lastItem = currentCluster[currentCluster.length - 1];
          const lastTime = new Date(lastItem.metadata?.takenAt || lastItem.createdAt).getTime();

          if (Math.abs(lastTime - itemTime) <= MAX_GAP_MS) {
            currentCluster.push(item);
          } else {
            if (currentCluster.length >= 4) {
              const start = new Date(currentCluster[currentCluster.length - 1].metadata?.takenAt || currentCluster[currentCluster.length - 1].createdAt);
              const end = new Date(currentCluster[0].metadata?.takenAt || currentCluster[0].createdAt);
              const gpsItem = currentCluster.find((f) => f.metadata?.latitude && f.metadata?.longitude);
              clusters.push({
                files: currentCluster,
                startDate: start,
                endDate: end,
                location: gpsItem
                  ? { latitude: gpsItem.metadata.latitude, longitude: gpsItem.metadata.longitude }
                  : undefined,
              });
            }
            currentCluster = [item];
          }
        }
      }

      if (currentCluster.length >= 4) {
        const start = new Date(currentCluster[currentCluster.length - 1].metadata?.takenAt || currentCluster[currentCluster.length - 1].createdAt);
        const end = new Date(currentCluster[0].metadata?.takenAt || currentCluster[0].createdAt);
        const gpsItem = currentCluster.find((f) => f.metadata?.latitude && f.metadata?.longitude);
        clusters.push({
          files: currentCluster,
          startDate: start,
          endDate: end,
          location: gpsItem
            ? { latitude: gpsItem.metadata.latitude, longitude: gpsItem.metadata.longitude }
            : undefined,
        });
      }

      // Format suggestions for client
      const suggestions = clusters.slice(0, 5).map((cl, idx) => ({
        suggestedTitle: cl.location ? `Trip near (${cl.location.latitude.toFixed(2)}, ${cl.location.longitude.toFixed(2)})` : `Memories from ${cl.startDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`,
        startDate: cl.startDate,
        endDate: cl.endDate,
        fileCount: cl.files.length,
        coverFile: cl.files[0],
        sampleFileIds: cl.files.map((f) => String(f._id)),
      }));

      res.json({ suggestions });
    } catch (error) {
      console.error('[AlbumController.suggestTrips] Error:', error);
      res.status(500).json({ error: 'Failed to generate suggestions' });
    }
  }
}
