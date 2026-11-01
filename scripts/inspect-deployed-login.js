const puppeteer = require("puppeteer-core");

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    headless: true,
  });

  const page = await browser.newPage();
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      console.log("-> REQUEST:", req.method(), req.url());
      if (req.postData()) console.log("   Payload:", req.postData());
    }
  });

  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      console.log("<- RESPONSE:", res.status(), res.url());
      if (res.request().method() !== "OPTIONS") {
        try {
          const text = await res.text();
          console.log("   Body:", text.slice(0, 300));
        } catch {}
      }
    }
  });

  page.on("console", (msg) => console.log("PAGE LOG:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

  await page.goto("https://attendance-tracker-apps-kirtee.vercel.app/login", {
    waitUntil: "networkidle2",
  });

  // Switch to Password tab
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.innerText, b);
    if (text.includes("Password Sign In")) {
      await b.click();
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 1000));

  // Click Demo Admin button
  const buttons2 = await page.$$("button");
  for (const b of buttons2) {
    const text = await page.evaluate((el) => el.innerText, b);
    if (text.includes("Demo Admin")) {
      console.log("Clicking Demo Admin button...");
      await b.click();
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 1000));

  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) {
    console.log("Clicking Sign In with Password submit button...");
    await submitBtn.click();
  }

  await new Promise((r) => setTimeout(r, 5000));
  await browser.close();
}

main().catch(console.error);
