const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    headless: true,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log("Navigating to https://attendance-tracker-apps-kirtee.vercel.app/login...");
  await page.goto("https://attendance-tracker-apps-kirtee.vercel.app/login", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  // Find all buttons and click 'Password Sign In'
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.innerText, b);
    if (text.includes("Password Sign In")) {
      console.log("Found and clicking 'Password Sign In' tab...");
      await b.click();
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 1000));

  const textInputs = await page.$$("input");
  let idInput = null;
  let passInput = null;

  for (const inp of textInputs) {
    const type = await page.evaluate((el) => el.type, inp);
    if (type === "password") {
      passInput = inp;
    } else if (type === "text" || type === "email") {
      idInput = inp;
    }
  }

  const submitBtn = await page.$('button[type="submit"]');

  if (idInput && passInput && submitBtn) {
    console.log("Typing demo admin credentials...");
    await idInput.click({ clickCount: 3 });
    await idInput.type("admin@vorldx.demo");
    await passInput.click({ clickCount: 3 });
    await passInput.type("Admin@VorldX2026!");
    await submitBtn.click();

    console.log("Waiting 6 seconds for live authentication and dashboard render...");
    await new Promise((r) => setTimeout(r, 6000));

    console.log("Current URL:", page.url());
    const body = await page.evaluate(() => document.body.innerText);
    console.log("Page Content Snapshot:", body.slice(0, 300).replace(/\n+/g, " "));

    const artifactPath =
      "C:\\Users\\asus\\.gemini\\antigravity\\brain\\2f17904c-8747-49f4-950c-bbb200b15e56\\deployed-hr-dashboard.png";
    const docsPath = path.resolve(__dirname, "../docs/screenshots/deployed-hr-dashboard.png");

    await page.screenshot({ path: artifactPath });
    fs.copyFileSync(artifactPath, docsPath);
    console.log("✓ Saved dashboard screenshot to:", artifactPath);
  } else {
    console.log("Could not find inputs.");
  }

  await browser.close();
}

main().catch(console.error);

