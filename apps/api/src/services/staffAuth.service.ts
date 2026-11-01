import crypto from "crypto";
import { Types } from "mongoose";
import {
  User,
  TrustedDevice,
  StaffSession,
  AuditEvent,
} from "../models";
import { AppError } from "../utils/AppError";
import { eventEmitterService } from "./eventEmitter.service";
import { ApiErrorCode, UserRole } from "@vorldx/shared";

export class StaffAuthService {
  /**
   * List active sessions for the current staff user
   */
  public async listActiveSessions(userId: string, currentRefreshToken?: string) {
    const sessions = await StaffSession.find({
      user: new Types.ObjectId(userId),
      isActive: true,
      expiresAt: { $gt: new Date() },
    })
      .populate("deviceId")
      .sort({ lastActivityAt: -1 });

    const currentHash = currentRefreshToken
      ? crypto.createHash("sha256").update(currentRefreshToken).digest("hex")
      : null;

    return sessions.map((s) => ({
      id: s._id.toString(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      lastActivityAt: s.lastActivityAt,
      expiresAt: s.expiresAt,
      isCurrent: currentHash ? s.tokenHash === currentHash : false,
      device: s.deviceId,
    }));
  }

  /**
   * Revoke a single active staff session
   */
  public async revokeSession(userId: string, sessionId: string, reason = "USER_LOGOUT") {
    const session = await StaffSession.findOneAndUpdate(
      { _id: new Types.ObjectId(sessionId), user: new Types.ObjectId(userId), isActive: true },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!session) {
      throw AppError.notFound("Active session not found", ApiErrorCode.ERR_NOT_FOUND);
    }

    // Emit real-time revocation event
    eventEmitterService.emit("staff.session_revoked", {
      userId,
      sessionId,
      reason,
      timestamp: new Date().toISOString(),
    });

    await AuditEvent.create({
      entityType: "STAFF_SESSION",
      entityId: sessionId,
      performedBy: new Types.ObjectId(userId),
      action: "SESSION_REVOKED",
      reason,
      metadata: { sessionId, userId },
      timestamp: new Date(),
    });

    return { success: true, message: "Session revoked successfully" };
  }

  /**
   * Revoke all sessions for a staff user (e.g. security reset or full signout)
   */
  public async revokeAllSessions(userId: string, exceptSessionId?: string, reason = "LOGOUT_ALL") {
    const filter: Record<string, unknown> = {
      user: new Types.ObjectId(userId),
      isActive: true,
    };

    if (exceptSessionId) {
      filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
    }

    await StaffSession.updateMany(filter, { $set: { isActive: false } });

    if (!exceptSessionId) {
      await User.findByIdAndUpdate(userId, { $set: { refreshTokenHash: null } });
    }

    eventEmitterService.emit("staff.session_revoked", {
      userId,
      reason,
      timestamp: new Date().toISOString(),
    });

    await AuditEvent.create({
      entityType: "STAFF_SESSION",
      entityId: userId,
      performedBy: new Types.ObjectId(userId),
      action: "SESSION_REVOKED",
      reason,
      metadata: { userId, exceptSessionId },
      timestamp: new Date(),
    });

    return { success: true, message: "All sessions terminated successfully" };
  }

  /**
   * Force logout of an HR or staff user by a Super Administrator
   */
  public async forceLogoutStaff(adminUserId: string, targetUserId: string, rationale?: string) {
    const adminUser = await User.findById(adminUserId);
    if (!adminUser || adminUser.role !== UserRole.ADMIN) {
      throw AppError.forbidden("Only Super Administrators can force terminate staff sessions", ApiErrorCode.ERR_FORBIDDEN);
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      throw AppError.notFound("Target staff user not found", ApiErrorCode.ERR_NOT_FOUND);
    }

    // Invalidate all active sessions and refresh tokens
    await StaffSession.updateMany(
      { user: targetUser._id, isActive: true },
      { $set: { isActive: false } }
    );
    targetUser.refreshTokenHash = null;
    await targetUser.save();

    const reason = rationale || "Administrative force logout executed by Super Admin";

    // Broadcast real-time security events
    eventEmitterService.emit("staff:force_logout", {
      targetUserId,
      employeeId: targetUser.employeeId,
      adminId: adminUserId,
      reason,
      timestamp: new Date().toISOString(),
    });

    eventEmitterService.emit("staff.session_revoked", {
      userId: targetUserId,
      reason: "ADMIN_FORCE_LOGOUT",
      timestamp: new Date().toISOString(),
    });

    await AuditEvent.create({
      entityType: "USER",
      entityId: targetUserId,
      performedBy: new Types.ObjectId(adminUserId),
      performedByEmployeeId: adminUser.employeeId,
      action: "FORCE_LOGOUT",
      reason,
      metadata: { targetUserId, targetEmployeeId: targetUser.employeeId, adminId: adminUserId },
      timestamp: new Date(),
    });

    return {
      success: true,
      message: `Forced logout completed for staff user ${targetUser.employeeId}`,
    };
  }

  /**
   * List trusted devices for the staff user
   */
  public async listTrustedDevices(userId: string) {
    return TrustedDevice.find({
      user: new Types.ObjectId(userId),
      isRevoked: false,
      trustedUntil: { $gt: new Date() },
    }).sort({ lastUsedAt: -1 });
  }

  /**
   * Revoke a trusted device and disconnect its linked sessions
   */
  public async revokeTrustedDevice(userId: string, deviceId: string) {
    const device = await TrustedDevice.findOneAndUpdate(
      { _id: new Types.ObjectId(deviceId), user: new Types.ObjectId(userId) },
      { $set: { isRevoked: true } },
      { new: true }
    );

    if (!device) {
      throw AppError.notFound("Trusted device record not found", ApiErrorCode.ERR_NOT_FOUND);
    }

    // Terminate any active sessions linked to this hardware fingerprint
    await StaffSession.updateMany(
      { user: new Types.ObjectId(userId), deviceId: device._id, isActive: true },
      { $set: { isActive: false } }
    );

    await AuditEvent.create({
      entityType: "USER",
      entityId: userId,
      performedBy: new Types.ObjectId(userId),
      action: "SESSION_REVOKED",
      reason: `Trusted device revoked: ${device.deviceName} (${device.deviceFingerprint})`,
      metadata: { deviceId, fingerprint: device.deviceFingerprint },
      timestamp: new Date(),
    });

    return { success: true, message: "Device access revoked successfully" };
  }
}

export const staffAuthService = new StaffAuthService();
