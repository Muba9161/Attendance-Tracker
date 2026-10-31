import { Schema, model, Document, Types } from "mongoose";
import { UserRole } from "@vorldx/shared";

export interface IStaffInvitation extends Document {
  _id: Types.ObjectId;
  email: string;
  role: UserRole;
  tokenHash: string;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  isAccepted: boolean;
  acceptedAt?: Date | null;
  name?: string | null;
  department?: string | null;
  designation?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const StaffInvitationSchema = new Schema<IStaffInvitation>(
  {
    email: {
      type: String,
      required: [true, "Invited email is required"],
      trim: true,
      lowercase: true,
      index: true,
    },
    role: {
      type: String,
      enum: [UserRole.HR, UserRole.ADMIN, UserRole.HR_ADMIN],
      default: UserRole.HR,
      required: true,
    },
    tokenHash: {
      type: String,
      required: [true, "Token hash is required"],
      unique: true,
      index: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    isAccepted: {
      type: Boolean,
      default: false,
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    department: {
      type: String,
      trim: true,
      default: null,
    },
    designation: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const StaffInvitation = model<IStaffInvitation>("StaffInvitation", StaffInvitationSchema);

