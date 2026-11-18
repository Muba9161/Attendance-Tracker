import mongoose from "mongoose";
import { env } from "../config/env";
import { connectDatabase, disconnectDatabase } from "../config/database";
import { Employee } from "../models/Employee";
import { hashPassword, User } from "../models/User";
import { UserRole, WorkType } from "@vorldx/shared";

const ADMIN_EMPLOYEE_ID = (process.env.ADMIN_DEFAULT_EMPLOYEE_ID || "ADM-001").trim().toUpperCase();
const ADMIN_NAME = (process.env.ADMIN_DEFAULT_NAME || "System Administrator").trim();

async function provisionAdmin(): Promise<void> {
  const email = (process.env.ADMIN_DEFAULT_EMAIL || "admin@vorldx.demo").trim().toLowerCase();
  const password = env.ADMIN_DEFAULT_PASSWORD;

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("ADMIN_DEFAULT_EMAIL must be a valid email address.");
  }
  if (
    !password ||
    password.length < 16 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[\d\W_]/.test(password)
  ) {
    throw new Error(
      "Set ADMIN_DEFAULT_PASSWORD to an explicit password of at least 16 characters with uppercase, lowercase, and a number or symbol."
    );
  }

  await connectDatabase();

  const [byId, byEmail, employeeById, employeeByEmail] = await Promise.all([
    User.findOne({ employeeId: ADMIN_EMPLOYEE_ID }),
    User.findOne({ email }),
    Employee.findOne({ employeeId: ADMIN_EMPLOYEE_ID }),
    Employee.findOne({ email }),
  ]);

  if (byId || byEmail || employeeById || employeeByEmail) {
    throw new Error(
      "An account or employee record already uses the Admin ID or email. Refusing to modify existing records."
    );
  }

  const passwordHash = await hashPassword(password);
  const user = new User({
    employeeId: ADMIN_EMPLOYEE_ID,
    email,
    role: UserRole.ADMIN,
  });
  user.passwordHash = passwordHash;
  user.status = "ACTIVE";
  user.isEmailVerified = true;
  await user.save();

  const employee = new Employee({
    employeeId: ADMIN_EMPLOYEE_ID,
    name: ADMIN_NAME,
    email,
    department: "Executive",
    designation: "Platform Super Admin",
    workType: WorkType.FULL_TIME,
    joiningDate: "2022-01-01",
    isActive: true,
    userId: user._id,
  });
  await employee.save();

  const savedUser = await User.findById(user._id);
  if (
    !savedUser ||
    savedUser.role !== UserRole.ADMIN ||
    savedUser.status !== "ACTIVE" ||
    !(await savedUser.comparePassword(password))
  ) {
    throw new Error("Admin account was saved but did not pass its credential verification check.");
  }

  console.log(`Admin account is ready in MongoDB (${email}, ${ADMIN_EMPLOYEE_ID}). Password stored as bcrypt hash.`);
}

provisionAdmin()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown setup error.";
    console.error(`Admin setup failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await disconnectDatabase();
  });
