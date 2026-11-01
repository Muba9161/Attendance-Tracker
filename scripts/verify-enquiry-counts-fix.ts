import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../apps/api/src/app";
import { User, Employee, Enquiry, EnquiryMessage } from "../apps/api/src/models";
import { featureFlagService } from "../apps/api/src/services/featureFlag.service";
import { env } from "../apps/api/src/config/env";
import { UserRole } from "@vorldx/shared";

async function main() {
  console.log("================================================================================");
  console.log("   VERIFY ENQUIRY COUNTS & TAB SWITCHING BUG FIX");
  console.log("================================================================================");

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  console.log("✓ In-memory MongoDB connected");

  featureFlagService.setInMemoryOverride("enquiries", true);

  // 1. Seed HR and Employee Users
  const hrUser = await User.create({
    employeeId: "HR-999",
    email: "hr.manager@vorldx.test",
    passwordHash: "dummyhash",
    role: UserRole.HR,
    status: "ACTIVE",
    failedLoginAttempts: 0,
  });

  const empUser = await User.create({
    employeeId: "EMP-100",
    email: "alice@vorldx.test",
    passwordHash: "dummyhash",
    role: UserRole.EMPLOYEE,
    status: "ACTIVE",
    failedLoginAttempts: 0,
  });

  const hrToken = jwt.sign(
    { userId: hrUser._id.toString(), role: UserRole.HR, email: hrUser.email },
    env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const empToken = jwt.sign(
    { userId: empUser._id.toString(), role: UserRole.EMPLOYEE, email: empUser.email },
    env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  console.log("✓ Test users seeded");

  // 2. Create 5 test enquiries:
  // Ticket 1: ATTENDANCE, HIGH, OPEN -> assigned to HR
  // Ticket 2: LEAVE, MEDIUM, OPEN -> unassigned
  // Ticket 3: WFH, URGENT, IN_PROGRESS -> unassigned
  // Ticket 4: PAYROLL, LOW, RESOLVED -> assigned to HR
  // Ticket 5: TECHNICAL, MEDIUM, CLOSED -> unassigned

  const t1 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empToken}`)
    .send({
      category: "ATTENDANCE",
      subject: "Morning punch missing",
      message: "Please check kiosk punch",
      priority: "HIGH",
    });

  const t2 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empToken}`)
    .send({
      category: "LEAVE",
      subject: "Leave entitlement query",
      message: "Check CL quota",
      priority: "MEDIUM",
    });

  const t3 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empToken}`)
    .send({
      category: "WFH",
      subject: "WFH system error",
      message: "Cannot check in remotely",
      priority: "URGENT",
    });

  const t4 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empToken}`)
    .send({
      category: "PAYROLL",
      subject: "Tax calculation query",
      message: "Form 16 request",
      priority: "LOW",
    });

  const t5 = await request(app)
    .post("/api/enquiries")
    .set("Authorization", `Bearer ${empToken}`)
    .send({
      category: "TECHNICAL",
      subject: "Laptop charger dead",
      message: "Need replacement",
      priority: "MEDIUM",
    });

  const id1 = t1.body.data._id;
  const id2 = t2.body.data._id;
  const id3 = t3.body.data._id;
  const id4 = t4.body.data._id;
  const id5 = t5.body.data._id;

  // Set assignees and statuses
  await request(app)
    .patch(`/api/enquiries/${id1}/assign`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ assigneeId: hrUser._id.toString() });

  await request(app)
    .patch(`/api/enquiries/${id3}/status`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ status: "IN_PROGRESS" });

  await request(app)
    .patch(`/api/enquiries/${id4}/assign`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ assigneeId: hrUser._id.toString() });

  await request(app)
    .patch(`/api/enquiries/${id4}/status`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ status: "RESOLVED" });

  await request(app)
    .patch(`/api/enquiries/${id5}/status`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ status: "CLOSED" });

  console.log("✓ 5 enquiries configured with diverse statuses, priorities and assignees");

  // Step 3: Check Initial Counts for HR
  let countRes = await request(app)
    .get("/api/enquiries/counts")
    .set("Authorization", `Bearer ${hrToken}`);

  console.log("\n[Test 1] Verify Initial Counts for HR:");
  console.log("Returned Counts:", countRes.body.data);

  if (countRes.body.data.all !== 5) throw new Error(`Expected all=5, got ${countRes.body.data.all}`);
  if (countRes.body.data.active !== 3) throw new Error(`Expected active=3, got ${countRes.body.data.active}`);
  if (countRes.body.data.myTickets !== 2) throw new Error(`Expected myTickets=2, got ${countRes.body.data.myTickets}`);
  if (countRes.body.data.unassigned !== 3) throw new Error(`Expected unassigned=3, got ${countRes.body.data.unassigned}`);
  if (countRes.body.data.highPriority !== 2) throw new Error(`Expected highPriority=2, got ${countRes.body.data.highPriority}`);
  if (countRes.body.data.resolved !== 2) throw new Error(`Expected resolved=2, got ${countRes.body.data.resolved}`);
  console.log("✓ Initial counts match exact expected database totals");

  // Step 4: Simulate switching tabs in the frontend:
  // User clicks "Resolved / Closed" tab -> frontend requests enquiries?status=RESOLVED
  console.log("\n[Test 2] Simulate Tab Switch: User clicks 'Resolved / Closed' tab:");
  const resolvedListRes = await request(app)
    .get("/api/enquiries?status=RESOLVED")
    .set("Authorization", `Bearer ${hrToken}`);

  console.log(`- Filtered list returns ${resolvedListRes.body.data.length} resolved ticket(s)`);

  // Verify that counts endpoint STILL returns authoritative counts:
  countRes = await request(app)
    .get("/api/enquiries/counts")
    .set("Authorization", `Bearer ${hrToken}`);

  if (countRes.body.data.active !== 3) {
    throw new Error(`FAIL: Active count corrupted on tab switch! Got ${countRes.body.data.active}`);
  }
  if (countRes.body.data.all !== 5) {
    throw new Error(`FAIL: All count corrupted on tab switch! Got ${countRes.body.data.all}`);
  }
  if (countRes.body.data.myTickets !== 2) {
    throw new Error(`FAIL: myTickets corrupted on tab switch! Got ${countRes.body.data.myTickets}`);
  }
  console.log("✓ All tab and badge counts remained completely stable and accurate across tab switch!");

  // Step 5: Simulate switching to "Assigned to Me" tab
  console.log("\n[Test 3] Simulate Tab Switch: User clicks 'Assigned to Me' tab:");
  const myTicketsListRes = await request(app)
    .get(`/api/enquiries?assigneeId=${hrUser._id.toString()}`)
    .set("Authorization", `Bearer ${hrToken}`);
  console.log(`- Filtered list returns ${myTicketsListRes.body.data.length} assigned ticket(s)`);

  countRes = await request(app)
    .get("/api/enquiries/counts")
    .set("Authorization", `Bearer ${hrToken}`);

  if (countRes.body.data.unassigned !== 3) {
    throw new Error(`FAIL: Unassigned count corrupted! Got ${countRes.body.data.unassigned}`);
  }
  console.log("✓ Tab counts remained authoritative!");

  // Step 5B: Simulate switching to "Unassigned" tab (The exact crash reported in the screenshot!)
  console.log("\n[Test 3B] Simulate Tab Switch: User clicks 'Unassigned' tab (assigneeId=UNASSIGNED):");
  const unassignedListRes = await request(app)
    .get("/api/enquiries?assigneeId=UNASSIGNED")
    .set("Authorization", `Bearer ${hrToken}`);

  if (unassignedListRes.status !== 200) {
    throw new Error(`FAIL: 'Unassigned' tab crashed with HTTP ${unassignedListRes.status}: ${JSON.stringify(unassignedListRes.body)}`);
  }
  if (unassignedListRes.body.data.length !== 3) {
    throw new Error(`Expected 3 unassigned tickets, got ${unassignedListRes.body.data.length}`);
  }
  console.log(`✓ 'Unassigned' tab successfully returned all ${unassignedListRes.body.data.length} unassigned tickets with status 200 (no BSONError 500 crash)!`);

  // Step 5C: Verify compound filters for Active, High Priority, and Resolved/Closed
  const activeListRes = await request(app)
    .get("/api/enquiries?status=OPEN,IN_PROGRESS")
    .set("Authorization", `Bearer ${hrToken}`);
  if (activeListRes.body.data.length !== 3) {
    throw new Error(`Expected 3 active tickets, got ${activeListRes.body.data.length}`);
  }

  const highPriorityListRes = await request(app)
    .get("/api/enquiries?priority=HIGH,URGENT")
    .set("Authorization", `Bearer ${hrToken}`);
  if (highPriorityListRes.body.data.length !== 2) {
    throw new Error(`Expected 2 high/urgent tickets, got ${highPriorityListRes.body.data.length}`);
  }

  const resolvedClosedListRes = await request(app)
    .get("/api/enquiries?status=RESOLVED,CLOSED")
    .set("Authorization", `Bearer ${hrToken}`);
  if (resolvedClosedListRes.body.data.length !== 2) {
    throw new Error(`Expected 2 resolved/closed tickets, got ${resolvedClosedListRes.body.data.length}`);
  }
  console.log("✓ All compound view filters ('Open & Active', 'High & Urgent', 'Resolved / Closed') matched database counts!");

  // Step 6: Test dynamic update after mutation
  console.log("\n[Test 4] Verify counts dynamically update after ticket assignment:");
  // Assign ticket 2 to HR user
  await request(app)
    .patch(`/api/enquiries/${id2}/assign`)
    .set("Authorization", `Bearer ${hrToken}`)
    .send({ assigneeId: hrUser._id.toString() });

  countRes = await request(app)
    .get("/api/enquiries/counts")
    .set("Authorization", `Bearer ${hrToken}`);

  console.log("Updated counts:", {
    myTickets: countRes.body.data.myTickets,
    unassigned: countRes.body.data.unassigned,
  });

  if (countRes.body.data.myTickets !== 3) {
    throw new Error(`Expected myTickets=3, got ${countRes.body.data.myTickets}`);
  }
  if (countRes.body.data.unassigned !== 2) {
    throw new Error(`Expected unassigned=2, got ${countRes.body.data.unassigned}`);
  }
  console.log("✓ Ticket assignment immediately reflected in counts: myTickets -> 3, unassigned -> 2");

  await mongoose.disconnect();
  await mongod.stop();

  console.log("\n================================================================================");
  console.log("🎉 ALL ENQUIRY COUNTS & TAB SWITCHING VERIFICATION TESTS PASSED!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

