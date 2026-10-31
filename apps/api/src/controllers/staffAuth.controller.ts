import { Request, Response, NextFunction } from "express";
import { staffAuthService } from "../services/staffAuth.service";

export class StaffAuthController {
  /**
   * GET /api/auth/staff/sessions
   */
  public async listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const sessions = await staffAuthService.listActiveSessions(userId);

      res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/auth/staff/sessions/:id
   */
  public async revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const sessionId = req.params.id;
      const result = await staffAuthService.revokeSession(userId, sessionId);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/staff/sessions/revoke-all
   */
  public async revokeAllSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const result = await staffAuthService.revokeAllSessions(userId);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/staff/force-logout/:userId
   */
  public async forceLogoutStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminUserId = req.user!.userId;
      const targetUserId = req.params.userId;
      const reason = req.body?.reason;

      const result = await staffAuthService.forceLogoutStaff(adminUserId, targetUserId, reason);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/staff/devices
   */
  public async listTrustedDevices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const devices = await staffAuthService.listTrustedDevices(userId);

      res.status(200).json({
        success: true,
        data: devices,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/auth/staff/devices/:id
   */
  public async revokeTrustedDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const deviceId = req.params.id;
      const result = await staffAuthService.revokeTrustedDevice(userId, deviceId);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const staffAuthController = new StaffAuthController();

