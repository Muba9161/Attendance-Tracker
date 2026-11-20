import { Types } from "mongoose";
import { Notification, NotificationType, User } from "../models";
import { UserRole } from "@vorldx/shared";
import { logger } from "../utils/logger";

/**
 * Persist one notification per user and business event. The partial unique index
 * also protects concurrent retries; legacy notifications without eventId remain valid.
 */
export async function createNotificationOnce(input: {
  userId: Types.ObjectId | string;
  eventId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const userId = typeof input.userId === "string" ? new Types.ObjectId(input.userId) : input.userId;
  try {
    await Notification.updateOne(
      { user: userId, eventId: input.eventId },
      {
        $setOnInsert: {
          user: userId,
          eventId: input.eventId,
          type: input.type,
          title: input.title,
          message: input.message,
          payload: input.payload || {},
          readAt: null,
          expiresAt: null,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    // Concurrent upserts can race before the winning row becomes visible.
    if ((error as { code?: number })?.code !== 11000) throw error;
    const existing = await Notification.exists({ user: userId, eventId: input.eventId });
    if (!existing) throw error;
  }
}

/** Fan out a request notification to active HR/Admin accounts exactly once each. */
export async function notifyHrUsersOnce(input: {
  eventId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const recipients = await User.find({
    role: { $in: [UserRole.HR, UserRole.ADMIN, UserRole.HR_ADMIN] },
    status: "ACTIVE",
  }).select("_id").lean();

  const results = await Promise.allSettled(
    recipients.map((recipient) => createNotificationOnce({ ...input, userId: recipient._id }))
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error(
        `[Notification] Failed to persist ${input.eventId} for user ${recipients[index]._id}:`,
        result.reason
      );
    }
  });
}
