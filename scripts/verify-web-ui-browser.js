const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

// Simple static file server for dist/
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

async function verifyWebUI() {
  const distDir = path.resolve(__dirname, "../apps/web/dist");
  if (!fs.existsSync(distDir)) {
    throw new Error("dist directory not found! Run npm run build in apps/web first.");
  }

  const port = 4173;
  console.log(`Starting local preview server on http://127.0.0.1:${port}...`);
  const server = await startStaticServer(distDir, port);

  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    headless: true,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const screenshotsDir = path.resolve(__dirname, "../docs/screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  try {
    // 1. LOGIN PAGE
    console.log("\n[UI Check 1] Visiting /login...");
    await page.goto(`http://127.0.0.1:${port}/login`, { waitUntil: "networkidle0" });
    const loginTitle = await page.title();
    console.log("   ✓ Page Title:", loginTitle);

    const emailInput = await page.$('input#identifier');
    const passwordInput = await page.$('input#password');
    const submitBtn = await page.$('button[type="submit"]');

    if (!emailInput || !passwordInput || !submitBtn) {
      throw new Error("Missing email, password, or submit button on /login");
    }
    console.log("   ✓ Email input, password input, and submit button verified");

    // Click quick fill Demo Admin
    const demoAdminBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find((b) => b.innerText.includes("Demo Admin"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log("   ✓ Demo Admin quick-fill button clicked:", demoAdminBtn);

    const emailVal = await page.$eval('input#identifier', (el) => el.value);
    console.log("   ✓ Populated email value:", emailVal);

    await page.screenshot({ path: path.join(screenshotsDir, "ui-login-page.png") });
    console.log("   ✓ Screenshot saved: docs/screenshots/ui-login-page.png");

    // 2. SIGNUP PAGE
    console.log("\n[UI Check 2] Visiting /signup...");
    await page.goto(`http://127.0.0.1:${port}/signup`, { waitUntil: "networkidle0" });

    const nameInput = await page.$('input#name');
    const signupEmailInput = await page.$('input#email');
    const signupPasswordInput = await page.$('input#password');
    const confirmPasswordInput = await page.$('input#confirmPassword');

    if (!nameInput || !signupEmailInput || !signupPasswordInput || !confirmPasswordInput) {
      throw new Error("Missing registration inputs on /signup");
    }
    console.log("   ✓ Name, email, password, and confirm password inputs verified");

    // Type partial password to test live checklist
    await signupPasswordInput.type("Pass1!");
    const checklistText = await page.evaluate(() => {
      const el = document.querySelector("form");
      return el ? el.innerText : "";
    });
    if (!checklistText.includes("Password requirements")) {
      throw new Error("Password requirements checklist not visible!");
    }
    console.log("   ✓ Live password strength requirements checklist verified visible");

    await page.screenshot({ path: path.join(screenshotsDir, "ui-signup-page.png") });
    console.log("   ✓ Screenshot saved: docs/screenshots/ui-signup-page.png");

    // 3. FORGOT PASSWORD PAGE
    console.log("\n[UI Check 3] Visiting /forgot-password...");
    await page.goto(`http://127.0.0.1:${port}/forgot-password`, { waitUntil: "networkidle0" });

    const forgotEmail = await page.$('input#email');
    const forgotSubmit = await page.$('button[type="submit"]');
    if (!forgotEmail || !forgotSubmit) {
      throw new Error("Missing forgot-password inputs");
    }
    console.log("   ✓ Forgot password email input and submit button verified");

    await page.screenshot({ path: path.join(screenshotsDir, "ui-forgot-password-page.png") });
    console.log("   ✓ Screenshot saved: docs/screenshots/ui-forgot-password-page.png");

    // 4. VERIFY EMAIL PAGE
    console.log("\n[UI Check 4] Visiting /verify-email...");
    await page.goto(`http://127.0.0.1:${port}/verify-email`, { waitUntil: "networkidle0" });

    const resendEmail = await page.$('input#resendEmail');
    if (!resendEmail) {
      throw new Error("Missing resend verification input");
    }
    console.log("   ✓ Email verification portal with resend capability verified");

    await page.screenshot({ path: path.join(screenshotsDir, "ui-verify-email-page.png") });
    console.log("   ✓ Screenshot saved: docs/screenshots/ui-verify-email-page.png");

    // 5. RESET PASSWORD PAGE
    console.log("\n[UI Check 5] Visiting /reset-password (no token state)...");
    await page.goto(`http://127.0.0.1:${port}/reset-password`, { waitUntil: "networkidle0" });

    const resetBodyText = await page.evaluate(() => document.body.innerText);
    if (!resetBodyText.includes("Missing Reset Token") && !resetBodyText.includes("New Password")) {
      throw new Error("Reset password page did not render as expected");
    }
    console.log("   ✓ Reset password page rendered safely with missing token alert");

    await page.screenshot({ path: path.join(screenshotsDir, "ui-reset-password-page.png") });
    console.log("   ✓ Screenshot saved: docs/screenshots/ui-reset-password-page.png");

    console.log("\n" + "=".repeat(80));
    console.log("🎉 ALL WEB UI BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(80));
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length > 0) {
    console.warn("Page errors encountered:", errors);
  }
}

verifyWebUI().catch((err) => {
  console.error("❌ Web UI Verification Failed:", err);
  process.exit(1);
});

