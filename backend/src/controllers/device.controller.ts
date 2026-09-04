import { Request, Response } from 'express';
import { Device } from '../models/Device.js';
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
   * Fetches personalized policy for the calling device and lists all paired devices.
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
      const pairedDevices = await Device.find({ userId: req.user!._id, deviceId: { $ne: deviceId } })
        .select('deviceId deviceName deviceType status lastSeenAt')
        .sort({ lastSeenAt: -1 });

      res.json({ success: true, policy: device.policy, device, pairedDevices });
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
}
