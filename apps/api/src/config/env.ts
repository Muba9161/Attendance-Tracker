import dotenv from "dotenv";
import path from "path";
import { setServers } from "node:dns";
import { z } from "zod";

// Load package-local configuration first, then fill missing values from the
// repository root. dotenv's default override=false preserves platform values.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const isProduction = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required").default(
    isProduction
      ? ""
      : process.env.NODE_ENV === "test"
        ? "mongodb://localhost:27017/vorldx_test"
        : "mongodb://localhost:27017/vorldx_attendance"
  ),
  MONGODB_DNS_SERVERS: z.string().default(""),
  BREVO_API_KEY: z.string().default(""),
  BREVO_SENDER_EMAIL: z.string().email().or(z.literal("")).default(""),
  BREVO_SENDER_NAME: z.string().default("VORLDX Employee Attendance System"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.preprocess((val) => val === "true" || val === true, z.boolean()).default(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM_EMAIL: z.string().email().or(z.literal("")).default(""),
  SMTP_FROM_NAME: z.string().default("VORLDX INDUSTRIES PRIVATE LIMITED"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters for security").default(
    isProduction
      ? ""
      : process.env.NODE_ENV === "test"
        ? "test-secret-at-least-32-characters-vorldx-jwt"
        : "demo-secret-key-at-least-32-chars-long-vorldx"
  ),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:3001,http://localhost:8081"),
  QR_ROTATION_SECONDS: z.coerce.number().int().min(10).max(120).default(30),
  QR_GRACE_SECONDS: z.coerce.number().int().min(5).max(60).default(15),
  DEFAULT_TIMEZONE: z.string().default("Asia/Kolkata"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  ADMIN_DEFAULT_PASSWORD: z.string().optional(),
  EMPLOYEE_DEFAULT_PASSWORD: z.string().default("Employee@2026!"),
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  DEMO_OTP_MODE: z
    .preprocess((val) => {
      if (val === "true" || val === true) return true;
      if (val === "false" || val === false) return false;
      return process.env.NODE_ENV !== "production";
    }, z.boolean())
    .default(true),
  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  HOLIDAY_PROVIDER: z.string().default("stub"),
  HOLIDAY_DEFAULT_COUNTRY: z.string().default("IN"),
  // Extension Feature Flags (defaults from environment, overridable in DB by Admin)
  FEATURE_FLAG_LEAVE: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .default(false),
  FEATURE_FLAG_ANNOUNCEMENTS: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .default(false),
  FEATURE_FLAG_ENQUIRIES: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .default(false),
  FEATURE_FLAG_CALENDAR_IMPORT: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .default(false),
  FEATURE_FLAG_THREE_D: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .default(false),
  FEATURE_FLAG_OTA_UPDATES: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .default(false),
});

export type Env = z.infer<typeof EnvSchema>;

let envConfig: Env;

try {
  envConfig = EnvSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Fatal Environment Configuration Error(s):");
    error.errors.forEach((err) => {
      console.error(`   - ${err.path.join(".")}: ${err.message}`);
    });
  } else {
    console.error("❌ Unknown error loading environment variables:", error);
  }
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
  // In test mode, provide safe fallback
  envConfig = EnvSchema.parse({
    NODE_ENV: "test",
    JWT_SECRET: "test-secret-at-least-32-characters-vorldx-jwt",
  });
}

const configuredDnsServers = envConfig.MONGODB_DNS_SERVERS.split(",")
  .map((server) => server.trim())
  .filter(Boolean);
if (configuredDnsServers.length > 0) {
  setServers(configuredDnsServers);
}

export const env = envConfig;
