const mammoth = require("mammoth");
const fs = require("fs/promises");
const path = require("path");
const puppeteer = require("puppeteer");

async function convertDocxToPdf(inputPath, outDir) {
  const buf = await fs.readFile(inputPath);
  const result = await mammoth.convertToHtml({ buffer: buf });
  const html = result.value;

  const htmlDoc = `
<!doctype html>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm; }
  body { font: 12pt system-ui, -apple-system, Segoe UI, Arial; }
  h1, h2, h3 { page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; }
</style>
<body>${html}</body>`;

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlDoc, { waitUntil: "networkidle0" });

    const outFile = path.join(
      outDir,
      path.basename(inputPath).replace(/\.[^.]+$/, ".pdf")
    );

    await page.pdf({
      path: outFile,
      format: "A4",
      printBackground: true,
    });

    return outFile;
  } finally {
    await browser.close();
  }
}

module.exports = { convertDocxToPdf };