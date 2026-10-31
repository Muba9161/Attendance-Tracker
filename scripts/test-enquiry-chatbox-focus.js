const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

function startStaticServer(distPath, port) {
  const mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".json": "application/json",
  };

  const server = http.createServer((req, res) => {
    let reqUrl = req.url.split("?")[0];
    let filePath = path.join(distPath, reqUrl);

    if (reqUrl === "/" || !path.extname(filePath)) {
      filePath = path.join(distPath, "index.html");
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        fs.readFile(path.join(distPath, "index.html"), (err2, fallback) => {
          if (err2) {
            res.writeHead(404);
            res.end("Not Found");
          } else {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(fallback);
          }
        });
      } else {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function run() {
  const distDir = path.resolve(__dirname, "../apps/web/dist");
  const port = 4175;
  console.log(`Starting preview server on port ${port}...`);
  const server = await startStaticServer(distDir, port);

  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/auth/me")) {
        req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            user: {
              _id: "usr_mock_admin_123",
              employeeId: "ADM-001",
              email: "admin@vorldx.demo",
              role: "ADMIN",
              name: "Super Administrator",
              status: "ACTIVE",
            },
            employee: {
              name: "Super Administrator",
              department: "Management",
              designation: "Executive",
            },
          }),
        });
      } else if (url.includes("/api/system/flags")) {
        req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: { enquiries: true, leave: true, announcements: true },
          }),
        });
      } else if (url.includes("/api/enquiries/enq_123")) {
        req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              _id: "enq_123",
              ticketNumber: "ENQ-2026-0001",
              subject: "Incorrect punch timestamp on biometric reader",
              status: "OPEN",
              priority: "HIGH",
              category: "ATTENDANCE_DISPUTE",
              employee: {
                _id: "emp_1",
                name: "Rohit Sharma",
                employeeId: "EMP-042",
                department: "Engineering",
                designation: "DevOps Engineer",
              },
            },
            messages: [
              {
                _id: "msg_1",
                senderRole: "EMPLOYEE",
                message: "Hello HR team, my morning check-in at 09:02 was marked late despite being in the queue.",
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        });
      } else if (url.includes("/api/enquiries")) {
        req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: [
              {
                _id: "enq_123",
                ticketNumber: "ENQ-2026-0001",
                subject: "Incorrect punch timestamp on biometric reader",
                status: "OPEN",
                priority: "HIGH",
                category: "ATTENDANCE_DISPUTE",
                employee: {
                  _id: "emp_1",
                  name: "Rohit Sharma",
                  employeeId: "EMP-042",
                  department: "Engineering",
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          }),
        });
      } else if (url.includes("/api/employees")) {
        req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: [],
          }),
        });
      } else {
        req.continue();
      }
    });

    // Seed mock token so auth context detects authenticated state
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("vorldx_access_token", "mock_valid_token");
      localStorage.setItem(
        "vorldx_user",
        JSON.stringify({
          id: "usr_mock_admin_123",
          employeeId: "ADM-001",
          email: "admin@vorldx.demo",
          role: "ADMIN",
        })
      );
    });

    console.log("Navigating to http://127.0.0.1:4175/enquiries...");
    await page.goto(`http://127.0.0.1:${port}/enquiries`, { waitUntil: "networkidle0", timeout: 15000 });

    // Wait for the enquiry row
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
    console.log("✓ Enquiries table loaded with mock record.");

    // Click "View Thread"
    const viewThreadBtn = await page.$('tbody tr button');
    await viewThreadBtn.click();
    console.log("✓ Clicked View Thread.");

    // Wait for the Drawer to open
    await page.waitForSelector('textarea', { timeout: 5000 });
    console.log("✓ Drawer opened, reply textarea located.");

    const textarea = await page.$('textarea');
    await textarea.click();

    let isFocused = await page.evaluate(() => {
      const el = document.querySelector('textarea');
      return document.activeElement === el;
    });
    console.log("✓ Textarea focused on click:", isFocused);
    if (!isFocused) throw new Error("Textarea was not focused on click!");

    // Type 60 characters with realistic pauses
    const testString = "Typing smooth reply: investigating punch records now with IT team.";
    for (let i = 0; i < testString.length; i++) {
      await page.keyboard.type(testString[i]);
      await new Promise((r) => setTimeout(r, 30));

      const currentlyFocused = await page.evaluate(() => {
        const el = document.querySelector('textarea');
        return document.activeElement === el;
      });

      if (!currentlyFocused) {
        const tag = await page.evaluate(() => document.activeElement?.outerHTML);
        throw new Error(`Focus lost on char '${testString[i]}' (index ${i})! ActiveElement is: ${tag}`);
      }
    }

    const finalVal = await page.evaluate(() => document.querySelector('textarea').value);
    console.log("✓ String typed completely with focus remaining locked onto textarea!");
    console.log("  Final Value:", finalVal);

    if (finalVal !== testString) {
      throw new Error(`Mismatch in typed value: got '${finalVal}'`);
    }

    console.log("🎉 VERIFICATION PASSED: Chatbox never deselects! Typing is completely smooth and stable.");
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
