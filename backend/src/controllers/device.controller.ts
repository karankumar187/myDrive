import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Device } from '../models/Device.js';
import { DeviceFileState } from '../models/DeviceFileState.js';
import { File } from '../models/File.js';
import { CryptoService } from '../services/crypto.service.js';
import { getSocketIoInstance } from '../server.js';

export class DeviceController {
  /**
   * Lists all physical devices registered to the user with live status.
   */
  static async listDevices(req: Request, res: Response): Promise<void> {
    try {
      const devices = await Device.find({ userId: req.user!._id })
        .select('-apiKeyHash')
        .sort({ lastSeenAt: -1 });

      res.json({ devices });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Registers a new physical device (Android app or iPhone Shortcut).
   * Generates a device API key, hashes it with SHA-256, and returns the raw key once.
   */
  static async registerDevice(req: Request, res: Response): Promise<void> {
    try {
      const { deviceName, deviceType, osVersion, appVersion } = req.body;

      if (!deviceName || !deviceType) {
        res.status(400).json({ error: 'deviceName and deviceType are required' });
        return;
      }

      const deviceId = req.body.deviceId || `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const { key, hash, prefix } = CryptoService.generateDeviceKey(`dkey_${deviceType}`);

      const device = await Device.create({
        userId: req.user!._id,
        deviceId,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        deviceName,
        deviceType,
        osVersion,
        appVersion,
        status: 'online',
        lastSeenAt: new Date(),
        policy: {
          uploadFolders: ['Camera', 'Screenshots', 'WhatsApp'],
          wifiOnly: true,
          chargingOnly: false,
          autoDeleteLocalAfterBackup: false,
          downloadMode: 'cloud_only',
          autoDownloadFolders: [],
          deletionMode: 'keep_in_cloud',
          syncPhotos: true,
          syncVideos: true,
          syncDocuments: true,
          syncOthers: false,
          pairedDeviceRules: [],
        },
      });

      res.json({
        success: true,
        device: {
          id: device._id,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
          policy: device.policy,
        },
        rawApiKey: key, // Shown only once during pairing!
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Fetches personalized policy for the calling device, lists paired devices,
   * and calculates an intelligent, collision-free auto-sync schedule so paired devices never sync simultaneously.
   */
  static async getMyPolicy(req: Request, res: Response): Promise<void> {
    try {
      const deviceId = req.device?.deviceId || (req.headers['x-device-id'] as string) || (req.query.deviceId as string);
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId is required' });
        return;
      }
      const device = await Device.findOne({ deviceId, userId: req.user!._id }).select('-apiKeyHash');
      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }

      // Fetch all registered physical devices for this user
      const allDevices = await Device.find({ userId: req.user!._id })
        .select('deviceId deviceName deviceType status lastSeenAt currentSyncActivity syncLogs lastSyncStartedAt lastSyncCompletedAt createdAt')
        .sort({ createdAt: 1 });

      const totalDevices = allDevices.length;
      const deviceIndex = Math.max(0, allDevices.findIndex((d) => d.deviceId === deviceId));
      const intervalHours = device.policy?.syncIntervalHours || 2;
      const intervalMinutes = intervalHours * 60;
      // Stagger auto-sync: evenly distribute sync slots across devices so they never collide
      const staggerOffsetMinutes = totalDevices > 1 ? Math.round((deviceIndex * intervalMinutes) / totalDevices) : 0;

      const schedule = {
        intervalHours,
        intervalMinutes,
        staggerOffsetMinutes,
        totalDevices,
        deviceSlot: deviceIndex + 1,
      };

      const pairedDevices = allDevices.filter((d) => d.deviceId !== deviceId);

      res.json({
        success: true,
        policy: device.policy,
        schedule,
        device,
        pairedDevices,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates live sync status (e.g. syncing, online), current activity message,
   * and appends to syncLogs for real-time visibility across web and connected devices.
   */
  static async updateSyncStatus(req: Request, res: Response): Promise<void> {
    try {
      const deviceId = req.device?.deviceId || (req.headers['x-device-id'] as string) || req.body.deviceId;
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId is required' });
        return;
      }

      const { status, activity, logMessage } = req.body;
      const updateFields: any = {
        lastSeenAt: new Date(),
      };

      if (status) {
        updateFields.status = status;
        if (status === 'syncing') {
          updateFields.lastSyncStartedAt = new Date();
        } else if (status === 'online') {
          updateFields.lastSyncCompletedAt = new Date();
        }
      }

      if (activity !== undefined) {
        updateFields.currentSyncActivity = activity;
      }

      const pushOps: any = {};
      if (logMessage) {
        pushOps.syncLogs = {
          $each: [{ timestamp: new Date(), message: logMessage }],
          $slice: -20, // Keep last 20 logs
        };
      }

      const query: any = { $set: updateFields };
      if (pushOps.syncLogs) {
        query.$push = pushOps;
      }

      const device = await Device.findOneAndUpdate(
        { deviceId, userId: req.user!._id },
        query,
        { new: true }
      ).select('-apiKeyHash');

      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }

      // Broadcast real-time sync status via Socket.IO if available
      try {
        const io = getSocketIoInstance();
        if (io) {
          io.emit('device:sync_status', {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            status: device.status,
            currentSyncActivity: device.currentSyncActivity,
            syncLogs: device.syncLogs,
            timestamp: Date.now(),
          });
        }
      } catch (_: any) {}

      res.json({ success: true, device });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates personalized policy for the calling device.
   */
  static async updateMyPolicy(req: Request, res: Response): Promise<void> {
    try {
      const deviceId = req.device?.deviceId || (req.headers['x-device-id'] as string) || (req.body.deviceId as string);
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId is required' });
        return;
      }
      const device = await Device.findOneAndUpdate(
        { deviceId, userId: req.user!._id },
        { policy: req.body.policy },
        { new: true }
      ).select('-apiKeyHash');

      if (!device) {
        res.status(404).json({ error: 'Device not found or access denied' });
        return;
      }
      res.json({ success: true, policy: device.policy, device });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates per-device sync policies by ID or deviceId.
   */
  static async updatePolicy(req: Request, res: Response): Promise<void> {
    try {
      const isIdValid = req.params.id && req.params.id.length === 24;
      const query: any = { userId: req.user!._id };
      if (isIdValid) {
        query._id = req.params.id;
      } else {
        query.deviceId = req.params.id;
      }

      const device = await Device.findOneAndUpdate(
        query, // Strict IDOR protection
        { policy: req.body.policy },
        { new: true }
      ).select('-apiKeyHash');

      if (!device) {
        res.status(404).json({ error: 'Device not found or access denied' });
        return;
      }

      res.json({ success: true, device });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Revokes a device's access immediately (e.g. if phone was lost or stolen).
   */
  static async revokeDevice(req: Request, res: Response): Promise<void> {
    try {
      const device = await Device.findOneAndDelete({
        _id: req.params.id,
        userId: req.user!._id, // Strict IDOR protection
      });

      if (!device) {
        res.status(404).json({ error: 'Device not found or access denied' });
        return;
      }

      res.json({ success: true, message: `Device ${device.deviceName} access has been revoked.` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Sends a real-time remote command to a specific device (e.g., Force Download, Trigger Sync).
   */
  static async sendRemoteCommand(req: Request, res: Response): Promise<void> {
    try {
      const { command, payload } = req.body;
      const device = await Device.findOne({ _id: req.params.id, userId: req.user!._id });

      if (!device) {
        res.status(404).json({ error: 'Device not found or access denied' });
        return;
      }

      const io = getSocketIoInstance();
      if (io) {
        io.to(`device:${device.deviceId}`).emit('remote:command', {
          command,
          payload,
          timestamp: Date.now(),
        });
      }

      res.json({ success: true, message: `Command '${command}' dispatched to ${device.deviceName}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Forces download of specific files to a paired device from the Web dashboard.
   */
  static async forceDownloadToDevice(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!._id;
      const targetDeviceId = req.params.deviceId || req.body.targetDeviceId;
      const { fileIds } = req.body;

      if (!targetDeviceId || !fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({ error: 'targetDeviceId and non-empty fileIds array are required' });
        return;
      }

      // Verify target device belongs to this user
      const isObjectId = Types.ObjectId.isValid(targetDeviceId);
      const query: any = { userId };
      if (isObjectId && targetDeviceId.length === 24) {
        query.$or = [{ deviceId: targetDeviceId }, { _id: new Types.ObjectId(targetDeviceId) }];
      } else {
        query.deviceId = targetDeviceId;
      }

      const device = await Device.findOne(query);
      if (!device) {
        res.status(404).json({ error: 'Target device not found or access denied' });
        return;
      }

      // Verify files belong to user
      const objectIds = fileIds
        .filter((id: string) => Types.ObjectId.isValid(id))
        .map((id: string) => new Types.ObjectId(id));

      const validFiles = await File.find({ _id: { $in: objectIds }, userId, isTrash: false }).select('_id filename mimeType sizeBytes');
      if (validFiles.length === 0) {
        res.status(404).json({ error: 'No valid files found for download' });
        return;
      }

      // Queue force download in DeviceFileState
      for (const file of validFiles) {
        await DeviceFileState.findOneAndUpdate(
          { userId, deviceId: device.deviceId, fileId: file._id },
          {
            forceDownloadRequested: true,
            forceDownloadRequestedAt: new Date(),
            isLocallyPresent: false,
          },
          { upsert: true, new: true }
        );
      }

      // Realtime notification via Socket.IO if available
      const io = getSocketIoInstance();
      if (io) {
        io.to(`device:${device.deviceId}`).emit('remote:force-download', {
          targetDeviceId: device.deviceId,
          fileIds: validFiles.map((f) => f._id.toString()),
          files: validFiles.map((f) => ({ id: f._id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        message: `Direct download of ${validFiles.length} file(s) queued for ${device.deviceName}`,
        count: validFiles.length,
        targetDeviceId: device.deviceId,
        targetDeviceName: device.deviceName,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
