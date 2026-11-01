const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function main() {
  const userUploadPath = "C:/Users/asus/.gemini/antigravity/brain/2f17904c-8747-49f4-950c-bbb200b15e56/.user_uploaded/media_1793470098143_d3ad3beb.jpg";
  const webPublicPng = path.resolve(__dirname, "../apps/web/public/vorldx-logo.png");
  const displayPublicPng = path.resolve(__dirname, "../apps/display/public/vorldx-logo.png");
  const displayPublicJpg = path.resolve(__dirname, "../apps/display/public/vorldx-logo.jpg");
  const displayLogoTs = path.resolve(__dirname, "../apps/display/lib/logo.ts");

  console.log("Reading source image from:", userUploadPath);
  const srcBuffer = fs.readFileSync(userUploadPath);

  // 1. Generate crisp lossless PNG (200x200)
  const pngBuffer = await sharp(srcBuffer)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(webPublicPng, pngBuffer);
  console.log("Updated:", webPublicPng);

  fs.writeFileSync(displayPublicPng, pngBuffer);
  console.log("Updated:", displayPublicPng);

  fs.writeFileSync(displayPublicJpg, srcBuffer);
  console.log("Updated:", displayPublicJpg);

  // 2. Generate Base64 Data URI for display QR code
  const base64DataUri = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const logoTsContent = `export const VORLDX_LOGO_URI = "${base64DataUri}";\nexport const VORLDX_LOGO_PATH = "/vorldx-logo.png";\n`;
  fs.writeFileSync(displayLogoTs, logoTsContent, "utf8");
  console.log("Updated:", displayLogoTs);

  console.log("Logo update completed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

