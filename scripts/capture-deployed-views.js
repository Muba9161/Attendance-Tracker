const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

async function captureDeployedViews() {
  const artifactsDir = "C:\\Users\\asus\\.gemini\\antigravity\\brain\\2f17904c-8747-49f4-950c-bbb200b15e56";
  const docsScreenshotsDir = path.resolve(__dirname, "../docs/screenshots");

  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  if (!fs.existsSync(docsScreenshotsDir)) {
    fs.mkdirSync(docsScreenshotsDir, { recursive: true });
  }

  console.log("Launching headless Chrome to capture live deployed views...");
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    headless: true,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // 1. Live HR & Admin Web Portal on Vercel
  console.log("\n1. Navigating to Deployed HR & Admin Web Portal (https://attendance-tracker-apps-kirtee.vercel.app)...");
  try {
    await page.goto("https://attendance-tracker-apps-kirtee.vercel.app/login", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log("   ✓ Loaded. Title:", await page.title());

    const hrLoginDocPath = path.join(docsScreenshotsDir, "deployed-hr-login.png");
    const hrLoginArtifactPath = path.join(artifactsDir, "deployed-hr-login.png");
    await page.screenshot({ path: hrLoginDocPath, fullPage: false });
    fs.copyFileSync(hrLoginDocPath, hrLoginArtifactPath);
    console.log("   ✓ Captured login view screenshot to", hrLoginArtifactPath);

    // Attempt live login with demo credentials
    const idInput = await page.$('input#identifier, input[type="text"], input[type="email"]');
    const pwInput = await page.$('input#password, input[type="password"]');
    const submitBtn = await page.$('button[type="submit"]');

    if (idInput && pwInput && submitBtn) {
      console.log("   Logging in with admin@vorldx.demo...");
      await idInput.click({ clickCount: 3 });
      await idInput.type("admin@vorldx.demo");
      await pwInput.click({ clickCount: 3 });
      await pwInput.type("Admin@VorldX2026!");
      await submitBtn.click();

      // Wait for navigation
      await new Promise((r) => setTimeout(r, 6000));
      console.log("   ✓ Current URL after login:", page.url());

      const hrDashDocPath = path.join(docsScreenshotsDir, "deployed-hr-dashboard.png");
      const hrDashArtifactPath = path.join(artifactsDir, "deployed-hr-dashboard.png");
      await page.screenshot({ path: hrDashDocPath, fullPage: false });
      fs.copyFileSync(hrDashDocPath, hrDashArtifactPath);
      console.log("   ✓ Captured dashboard view screenshot to", hrDashArtifactPath);
    }
  } catch (err) {
    console.error("   ⚠️ Failed capturing HR Portal:", err.message);
  }

  // 2. Live Office Dynamic QR Display Kiosk on Vercel
  console.log("\n2. Navigating to Deployed Office QR Kiosk (https://attendance-tracker-qq8u.vercel.app)...");
  try {
    await page.goto("https://attendance-tracker-qq8u.vercel.app", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log("   ✓ Loaded. Title:", await page.title());
    await new Promise((r) => setTimeout(r, 3000));

    const qrKioskDocPath = path.join(docsScreenshotsDir, "deployed-qr-kiosk.png");
    const qrKioskArtifactPath = path.join(artifactsDir, "deployed-qr-kiosk.png");
    await page.screenshot({ path: qrKioskDocPath, fullPage: false });
    fs.copyFileSync(qrKioskDocPath, qrKioskArtifactPath);
    console.log("   ✓ Captured QR Kiosk view screenshot to", qrKioskArtifactPath);
  } catch (err) {
    console.error("   ⚠️ Failed capturing QR Kiosk:", err.message);
  }

  // 3. Live Direct Render Web Service
  console.log("\n3. Navigating to Direct Cloud Web Service (https://attendance-tracker-56du.onrender.com)...");
  try {
    await page.goto("https://attendance-tracker-56du.onrender.com", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    console.log("   ✓ Loaded. Title:", await page.title());
    await new Promise((r) => setTimeout(r, 2000));

    const directDocPath = path.join(docsScreenshotsDir, "deployed-render-web.png");
    const directArtifactPath = path.join(artifactsDir, "deployed-render-web.png");
    await page.screenshot({ path: directDocPath, fullPage: false });
    fs.copyFileSync(directDocPath, directArtifactPath);
    console.log("   ✓ Captured Render Direct view screenshot to", directArtifactPath);
  } catch (err) {
    console.error("   ⚠️ Failed capturing Render Web Service:", err.message);
  }

  await browser.close();
  console.log("\n====================================================");
  console.log("🎉 ALL DEPLOYED SCREENSHOTS CAPTURED SUCCESSFULLY!");
  console.log("====================================================");
}

captureDeployedViews().catch(console.error);

