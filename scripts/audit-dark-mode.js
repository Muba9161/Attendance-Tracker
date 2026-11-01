const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const axeCore = require("axe-core");

const ARTIFACT_DIR = "C:\\Users\\asus\\.gemini\\antigravity\\brain\\2f17904c-8747-49f4-950c-bbb200b15e56";
const SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, "dark_mode_screenshots");
const DIST_DIR = path.resolve(__dirname, "../apps/web/dist");
const PORT = 3008;

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXECUTABLE_PATH = fs.existsSync(chromePath) ? chromePath : edgePath;

// Mock data
const mockUser = {
  id: "usr-admin-1",
  _id: "usr-admin-1",
  employeeId: "HR-001",
  name: "Priya Sharma",
  email: "admin@vorldx.demo",
  role: "ADMIN",
  department: "Human Resources",
  designation: "HR Director",
};

const mockSummary = {
  totalActiveStaff: 120,
  presentCount: 98,
  lateCount: 12,
  wfhCount: 8,
  notPunchedCount: 2,
  attendancePercentage: 91.6,
  statusSplit: { totalActive: 120, present: 98, late: 12, wfh: 8, absent: 2 },
  trendComparison: { presentDelta: 4, lateDelta: -2, rateDelta: 3.2 },
};

const mockTimeline = {
  todayDateKey: "2026-10-31",
  peakCheckInHour: 9,
  hourlyBuckets: [
    { hour: 8, count: 25, lateCount: 2 },
    { hour: 9, count: 58, lateCount: 8 },
    { hour: 10, count: 18, lateCount: 2 },
  ],
};

const mockEmployees = {
  data: [
    {
      _id: "emp-101",
      employeeId: "EMP-101",
      name: "Ananya Sharma",
      email: "ananya.sharma@vorldx.demo",
      department: "Engineering",
      designation: "Staff Software Engineer",
      workType: "FULL_TIME",
      isActive: true,
      joiningDate: "2024-01-15",
    },
  ],
  pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
};

const mockAttendance = {
  data: [
    {
      _id: "rec-1",
      employeeId: "EMP-101",
      dateKey: "2026-10-31",
      checkInTime: "2026-10-31T03:30:00.000Z",
      checkOutTime: "2026-10-31T12:00:00.000Z",
      durationMinutes: 510,
      status: "PRESENT",
      isLate: false,
      lateMinutes: 0,
      employee: { name: "Ananya Sharma", department: "Engineering", employeeId: "EMP-101" },
    },
  ],
  pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
};

const mockPolicies = {
  success: true,
  data: {
    _id: "pol-1",
    version: 3,
    isActive: true,
    workdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    wfhMonthlyAllowance: 4,
    shifts: [
      {
        _id: "sh-1",
        name: "General Core Shift",
        startTime: "09:00",
        endTime: "18:00",
        graceMinutes: 15,
        checkInWindowStartMinutes: 60,
        checkOutWindowEndMinutes: 120,
        isOvernight: false,
        isActive: true,
      },
    ],
  },
};

const mockHolidays = {
  success: true,
  data: [
    { _id: "hol-1", name: "Diwali", dateKey: "2026-11-01", isRecurring: true, description: "Festival of Lights" },
    { _id: "hol-2", name: "Republic Day", dateKey: "2026-01-26", isRecurring: true, description: "National Holiday" },
  ],
};

const mockAuditLogs = {
  success: true,
  data: [
    {
      _id: "aud-1",
      action: "POLICY_UPDATE",
      performedByEmployeeId: "HR-001",
      timestamp: "2026-10-31T10:00:00.000Z",
      reason: "Adjusted winter grace period",
      metadata: { newVersion: 3 },
    },
  ],
  pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
};

const mockDisplays = {
  success: true,
  data: [
    {
      _id: "disp-1",
      terminalId: "TERM-001",
      name: "Main Reception Terminal",
      location: "Tower A, Ground Floor",
      status: "ONLINE",
      version: "2.1.0",
      ipAddress: "192.168.1.105",
      isRevoked: false,
      pairingCode: "948-219",
      lastPingAt: "2026-10-31T14:00:00.000Z",
    },
  ],
};

const mockAnnouncements = {
  success: true,
  data: [
    {
      _id: "ann-1",
      title: "Company Town Hall - Q4 Roadmap",
      content: "Join us for our all-hands sync this Friday at 4 PM IST.",
      priority: "HIGH",
      channels: ["WEB", "MOBILE"],
      publishedAt: "2026-10-30T10:00:00.000Z",
      readBy: [],
    },
  ],
};

const mockEnquiries = {
  success: true,
  data: [
    {
      _id: "enq-1",
      ticketNumber: "TICK-1001",
      employeeId: "EMP-101",
      employeeName: "Ananya Sharma",
      department: "Engineering",
      category: "ATTENDANCE_DISPUTE",
      subject: "Punch not registered on 24th Oct",
      status: "OPEN",
      priority: "MEDIUM",
      createdAt: "2026-10-28T10:00:00.000Z",
      messages: [],
    },
  ],
};

const mockLeaveQueue = {
  success: true,
  data: [
    {
      _id: "lv-1",
      employeeId: "EMP-101",
      employeeName: "Ananya Sharma",
      department: "Engineering",
      leaveType: "CASUAL",
      startDate: "2026-11-05",
      endDate: "2026-11-06",
      daysCount: 2,
      reason: "Family function",
      status: "PENDING",
      createdAt: "2026-10-29T02:00:00.000Z",
    },
  ],
};

const mockWfh = {
  data: [
    {
      _id: "wfh-101",
      employeeId: "EMP-101",
      dateKey: "2026-10-30",
      reason: "Home network setup",
      status: "PENDING",
      createdAt: "2026-10-29T04:00:00.000Z",
      employee: { name: "Ananya Sharma", department: "Engineering", employeeId: "EMP-101" },
    },
  ],
  pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
};

const mockReleases = {
  success: true,
  data: [
    {
      _id: "rel-1",
      platform: "MOBILE",
      version: "2.1.0",
      minSupportedVersion: "2.0.0",
      forceUpdate: false,
      notes: "Dark mode enhancements and high-contrast scanner.",
      publishedAt: "2026-10-31T10:00:00.000Z",
      publishedBy: "Priya Sharma",
    },
  ],
};

function createStaticServer() {
  return http.createServer((req, res) => {
    const url = req.url;

    if (url.startsWith("/api/auth/me")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: true,
          data: {
            user: { _id: "usr-admin-1", employeeId: "HR-001", email: "admin@vorldx.demo", role: "ADMIN", status: "ACTIVE" },
            employee: { name: "Priya Sharma", department: "Human Resources", designation: "HR Director" },
          },
        })
      );
    }
    if (url.startsWith("/api/analytics/summary")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, data: mockSummary }));
    }
    if (url.startsWith("/api/analytics/timeline")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, data: mockTimeline }));
    }
    if (url.startsWith("/api/analytics/departments")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, data: { departments: [{ name: "Engineering", total: 45, present: 42, percentage: 93.3 }] } }));
    }
    if (url.startsWith("/api/employees")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...mockEmployees }));
    }
    if (url.startsWith("/api/attendance")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...mockAttendance }));
    }
    if (url.startsWith("/api/policy/active") || url.startsWith("/api/policies/active")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockPolicies));
    }
    if (url.startsWith("/api/calendar/holidays")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockHolidays));
    }
    if (url.startsWith("/api/audit-logs")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockAuditLogs));
    }
    if (url.startsWith("/api/terminals") || url.startsWith("/api/displays")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockDisplays));
    }
    if (url.startsWith("/api/announcements")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockAnnouncements));
    }
    if (url.startsWith("/api/enquiries")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockEnquiries));
    }
    if (url.startsWith("/api/leave")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockLeaveQueue));
    }
    if (url.startsWith("/api/wfh")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...mockWfh }));
    }
    if (url.startsWith("/api/updates/releases")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockReleases));
    }
    if (url.startsWith("/api/security/sessions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, data: [] }));
    }
    if (url.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, data: [] }));
    }

    // Static file serving
    let filePath = path.join(DIST_DIR, url.split("?")[0]);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, "index.html");
    }
    const ext = path.extname(filePath);
    const contentTypeMap = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": contentTypeMap[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function runDarkModeAudit() {
  console.log("================================================================================");
  console.log("   VORLDX DARK MODE AUDIT & CONTRAST VERIFICATION");
  console.log("   WCAG 2.1 AA Color-Contrast Check • Theme Switching • Multi-page Screenshotting");
  console.log("================================================================================\n");

  const server = createStaticServer();
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ Local web audit server running at http://localhost:${PORT}\n`);

  const profileDir = fs.mkdtempSync(path.join(ARTIFACT_DIR, "puppeteer_dark_profile_"));
  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    headless: "new",
    userDataDir: profileDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pagesToAudit = [
    { path: "/login", name: "login", title: "Login" },
    { path: "/dashboard", name: "dashboard", title: "Dashboard" },
    { path: "/attendance", name: "attendance", title: "Attendance Ledger" },
    { path: "/employees", name: "employees", title: "Employees" },
    { path: "/wfh", name: "wfh", title: "Work From Home" },
    { path: "/policies", name: "policies", title: "Policies & Shifts" },
    { path: "/calendar", name: "calendar", title: "Calendar & Schedule" },
    { path: "/leave", name: "leave", title: "Leave Queue" },
    { path: "/announcements", name: "announcements", title: "Announcements" },
    { path: "/enquiries", name: "enquiries", title: "HR Enquiries" },
    { path: "/displays", name: "displays", title: "Displays & Terminals" },
    { path: "/audit-logs", name: "audit-logs", title: "Compliance Audit Logs" },
    { path: "/security", name: "security", title: "Security & Sessions" },
    { path: "/reports", name: "reports", title: "Reports" },
    { path: "/releases", name: "releases", title: "App Releases" },
    { path: "/design-system", name: "design-system", title: "Design System Tokens" },
  ];

  const results = [];
  const axeSource = axeCore.source;

  for (const p of pagesToAudit) {
    console.log(`\nEvaluating [${p.title}] (${p.path})...`);

    // 1. Evaluate Light Mode (Before Screenshot)
    try {
      await page.goto(`http://localhost:${PORT}${p.path}`, { waitUntil: "networkidle0", timeout: 10000 });

      if (p.path !== "/login") {
        await page.evaluate((u) => {
          localStorage.setItem("vorldx_access_token", "mock-jwt-token-admin");
          localStorage.setItem("vorldx_cached_user", JSON.stringify(u));
          localStorage.setItem("vorldx_auth_token", "mock-jwt-token-admin");
          localStorage.setItem("vorldx_user", JSON.stringify(u));
          localStorage.setItem("vorldx_theme_preference", "light");
          document.documentElement.classList.remove("dark");
          document.documentElement.style.colorScheme = "light";
        }, mockUser);
      } else {
        await page.evaluate(() => {
          localStorage.setItem("vorldx_theme_preference", "light");
          document.documentElement.classList.remove("dark");
          document.documentElement.style.colorScheme = "light";
        });
      }

      await new Promise((r) => setTimeout(r, 400));
      const lightShotPath = path.join(SCREENSHOTS_DIR, `${p.name}-light.png`);
      await page.screenshot({ path: lightShotPath, fullPage: false });

      // 2. Switch to Dark Mode (After Screenshot & Axe Contrast Check)
      await page.evaluate(() => {
        localStorage.setItem("vorldx_theme_preference", "dark");
        document.documentElement.classList.add("dark");
        document.documentElement.style.colorScheme = "dark";
      });
      await new Promise((r) => setTimeout(r, 400));

      const darkShotPath = path.join(SCREENSHOTS_DIR, `${p.name}-dark.png`);
      await page.screenshot({ path: darkShotPath, fullPage: false });

      // 3. Run Axe contrast checks in Dark Mode
      await page.evaluate(axeSource);
      const axeResult = await page.evaluate(async () => {
        return await window.axe.run(document, {
          runOnly: {
            type: "rule",
            values: ["color-contrast"],
          },
        });
      });

      const contrastViolations = axeResult.violations;
      const passCount = axeResult.passes.reduce((acc, p) => acc + p.nodes.length, 0);
      const violationCount = contrastViolations.reduce((acc, v) => acc + v.nodes.length, 0);

      if (violationCount > 0) {
        console.log(`  ⚠ ${violationCount} contrast violation(s) detected:`);
        contrastViolations.forEach((v) => {
          v.nodes.forEach((n) => {
            console.log(`    - [${n.target.join(" ")}]: ${n.failureSummary}`);
          });
        });
      } else {
        console.log(`  ✓ Dark mode contrast clean! Checked elements passed WCAG AA: ${passCount}`);
      }

      results.push({
        title: p.title,
        path: p.path,
        lightScreenshot: lightShotPath,
        darkScreenshot: darkShotPath,
        contrastPasses: passCount,
        contrastViolations: violationCount,
        status: violationCount === 0 ? "PASS" : "FAIL",
      });
    } catch (err) {
      console.log(`  ❌ Error evaluating ${p.path}: ${err.message}`);
      results.push({
        title: p.title,
        path: p.path,
        error: err.message,
        status: "ERROR",
      });
    }
  }

  await browser.close();
  server.close();

  console.log("\n================================================================================");
  console.log("                      DARK MODE AUDIT SUMMARY RESULTS                           ");
  console.log("================================================================================");
  console.table(
    results.map((r) => ({
      Page: r.title,
      Path: r.path,
      "WCAG Passes": r.contrastPasses ?? 0,
      "Violations": r.contrastViolations ?? 0,
      Result: r.status,
    }))
  );

  const totalViolations = results.reduce((acc, r) => acc + (r.contrastViolations || 0), 0);
  console.log(`\nOverall Dark Mode Contrast Result: ${totalViolations === 0 ? "100% WCAG AA PASS" : totalViolations + " issues to fix"}`);
  fs.writeFileSync(path.join(ARTIFACT_DIR, "dark_mode_audit_results.json"), JSON.stringify(results, null, 2));
}

runDarkModeAudit().catch((err) => {
  console.error("Audit failure:", err);
  process.exit(1);
});
