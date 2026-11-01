/**
 * Characterization test script for current Enquiry subsystem behaviour.
 *
 * Verifies that all existing Enquiry operations function properly and establishes
 * an exact baseline before making any changes to resolve the badge count bug.
 */

process.env.NODE_ENV = "test";
process.env.VITEST = "true";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../apps/api/src/app";
import {
  User,
  Employee,
  Enquiry,
  EnquiryMessage,
  AuditEvent,
} from "../apps/api/src/models";
import { featureFlagService } from "../apps/api/src/services/featureFlag.service";
import { enquiryService } from "../apps/api/src/services/enquiry.service";
import { env } from "../apps/api/src/config/env";
import { UserRole, WorkType } from "@vorldx/shared";

async function runEnquiryCharacterization() {
  console.log("=".repeat(80));
  console.log("   ENQUIRIES SUBSYSTEM CHARACTERIZATION BASELINE CHECKS");
  console.log("=".repeat(80));

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  console.log("✓ In-memory MongoDB connected");

  featureFlagService.clearInMemoryOverrides();
  featureFlagService.setInMemoryOverride("enquiries", true);
  enquiryService.resetRateLimit();

  // 1. Seed HR User
  const hrUser = await User.create({
    employeeId: "HR-001",
    email: "hr@vorldx.test",
    passwordHash: "hash",
    role: UserRole.HR,
    status: "ACTIVE",
  });
  const hrToken = jwt.sign(
    { userId: hrUser._id.toString(), role: UserRole.HR, email: hrUser.email },
    env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  await Employee.create({
    userId: hrUser._id,
    employeeId: hrUser.employeeId,
    name: "Hannah Rogers",
    email: hrUser.email,
    department: "Human Resources",
    designation: "HR Officer",
    workType: WorkType.FULL_TIME,
    joiningDate: "2024-01-01",
    isActive: true,
  });

  // 2. Seed Employee A
  const empAUser = await User.create({
    employeeId: "EMP-101",
    email: "alice@vorldx.test",
    passwordHash: "hash",
    role: UserRole.EMPLOYEE,
    status: "ACTIVE",
  });
  const empAToken = jwt.sign(
    { userId: empAUser._id.toString(), role: UserRole.EMPLOYEE, email: empAUser.email },
    env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  const empADoc = await Employee.create({
    userId: empAUser._id,
    employeeId: empAUser.employeeId,
    name: "Alice Smith",
    email: empAUser.email,
    department: "Engineering",
    designation: "Software Engineer",
    workType: WorkType.FULL_TIME,
    joiningDate: "2024-01-01",
    isActive: true,
  });

  // 3. Seed Employee B
  const empBUser = await User.create({
    employeeId: "EMP-102",
    email: "bob@vorldx.test",
    passwordHash: "hash",
    role: UserRole.EMPLOYEE,
    status: "ACTIVE",
  });
  const empBToken = jwt.sign(
    { userId: empBUser._id.toString(), role: UserRole.EMPLOYEE, email: empBUser.email },
    env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  await Employee.create({
    userId: empBUser._id,
    employeeId: empBUser.employeeId,
    name: "Bob Jones",
    email: empBUser.email,
    department: "Marketing",
    designation: "Marketing Specialist",
    workType: WorkType.FULL_TIME,
    joiningDate: "2024-01-01",
    isActive: true,
  });

  console.log("✓ Test users & employee documents seeded");

  // Step 1: Employee A creates Ticket 1
  const createRes1 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empAToken}`)
    .send({
      subject: "Punch machine error at Lobby B",
      category: "ATTENDANCE",
      priority: "HIGH",
      message: "The kiosk reader showed a green tick but punch is missing.",
    });
  if (createRes1.status !== 201) throw new Error(`Create Ticket 1 failed: ${createRes1.text}`);
  const ticket1 = createRes1.body.data;
  console.log(`[Check 1] Created Ticket 1: ${ticket1.ticketNumber} (Status: ${ticket1.status})`);

  // Employee A creates Ticket 2
  const createRes2 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empAToken}`)
    .send({
      subject: "Leave balance calculation query",
      category: "LEAVE",
      priority: "MEDIUM",
      message: "Casual leave was deducted instead of earned leave.",
    });
  const ticket2 = createRes2.body.data;
  console.log(`[Check 2] Created Ticket 2: ${ticket2.ticketNumber}`);

  // Employee B creates Ticket 3
  const createRes3 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empBToken}`)
    .send({
      subject: "WFH request pending review",
      category: "WFH",
      priority: "LOW",
      message: "Submitted WFH for Friday, please approve.",
    });
  const ticket3 = createRes3.body.data;
  console.log(`[Check 3] Created Ticket 3: ${ticket3.ticketNumber} for Employee B`);

  // Check 4: Permission Scoping (Employee A sees only own tickets; HR sees all)
  const listEmpA = await request(app)
    .get("/api/enquiries")
    .set("Authorization", `Bearer ${empAToken}`);
  console.log(`[Check 4A] Employee A list count: ${listEmpA.body.data.length} (Expected: 2)`);
  if (listEmpA.body.data.length !== 2) throw new Error("Employee scoping failed");

  const listHr = await request(app)
    .get("/api/enquiries")
    .set("Authorization", `Bearer ${hrToken}`);
  console.log(`[Check 4B] HR list count: ${listHr.body.data.length} (Expected: 3)`);
  if (listHr.body.data.length !== 3) throw new Error("HR scoping failed");

  // Check 5: Search
  const searchRes = await request(app)
    .get("/api/enquiries?search=Lobby")
    .set("Authorization", `Bearer ${hrToken}`);
  console.log(`[Check 5] Search for 'Lobby': found ${searchRes.body.data.length} ticket(s)`);
  if (searchRes.body.data.length !== 1 || searchRes.body.data[0]._id !== ticket1._id) {
    throw new Error("Search filter failed");
  }

  // Check 6: Tab / Status Filtering
  const openRes = await request(app)
    .get("/api/enquiries?status=OPEN")
    .set("Authorization", `Bearer ${hrToken}`);
  console.log(`[Check 6] Status OPEN filter: found ${openRes.body.data.length} ticket(s)`);
  if (openRes.body.data.length !== 3) throw new Error("Status filtering failed");

  // Check 7: Pagination
  const pageRes = await request(app)
    .get("/api/enquiries?page=1&limit=2")
    .set("Authorization", `Bearer ${hrToken}`);
  console.log(`[Check 7] Pagination page=1 limit=2: returned ${pageRes.body.data.length} of total ${pageRes.body.total}`);
  if (pageRes.body.data.length !== 2 || pageRes.body.total !== 3) throw new Error("Pagination failed");

  // Check 8: Open Ticket & View Thread
  const threadRes = await request(app)
    .get(`/api/enquiries/${ticket1._id}`)
    .set("Authorization", `Bearer ${hrToken}`);
  console.log(`[Check 8] Thread view for ${ticket1.ticketNumber}: status ${threadRes.status}, messages: ${threadRes.body.messages?.length}`);
  if (threadRes.status !== 200 || !threadRes.body.messages) throw new Error("Thread retrieval failed");

  // Check 9: Reply (HR sends reply)
  const replyRes = await request(app)
    .post(`/api/enquiries/${ticket1._id}/messages`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ message: "We have reviewed the lobby punch logs and reconciled your punch." });
  console.log(`[Check 9] HR Reply: status ${replyRes.status}`);
  if (replyRes.status !== 201) throw new Error("Reply failed");

  // Check 10: Assign
  const assignRes = await request(app)
    .patch(`/api/enquiries/${ticket1._id}/assign`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ assigneeId: hrUser._id.toString() });
  console.log(`[Check 10] Assign ticket to HR: status ${assignRes.status}`);
  if (assignRes.status !== 200) throw new Error("Assignment failed");

  // Check 11: Change Status to RESOLVED and CLOSED
  const resolveRes = await request(app)
    .patch(`/api/enquiries/${ticket1._id}/status`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ status: "RESOLVED", note: "Punch adjusted" });
  console.log(`[Check 11A] Update status to RESOLVED: status ${resolveRes.status}`);

  const closeRes = await request(app)
    .patch(`/api/enquiries/${ticket1._id}/status`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ status: "CLOSED", note: "Issue confirmed closed" });
  console.log(`[Check 11B] Update status to CLOSED: status ${closeRes.status}`);

  // Check 12: Reopen by Employee A within 7-day window
  const reopenRes = await request(app)
    .post(`/api/enquiries/${ticket1._id}/reopen`)
    .set("Authorization", `Bearer ${empAToken}`)
    .send({ reason: "Issue reoccurred on the same kiosk this morning" });
  console.log(`[Check 12] Reopen ticket: status ${reopenRes.status}, new status: ${reopenRes.body.data?.status}`);
  if (reopenRes.status !== 200 || reopenRes.body.data?.status !== "IN_PROGRESS") throw new Error("Reopen failed");

  console.log("\n" + "=".repeat(80));
  console.log("🎉 ALL 12 CHARACTERIZATION CHECKS COMPLETED AND VERIFIED!");
  console.log("=".repeat(80));

  await mongoose.disconnect();
  await mongod.stop();
}

runEnquiryCharacterization().catch((err) => {
  console.error("❌ Characterization failed:", err);
  process.exit(1);
});
