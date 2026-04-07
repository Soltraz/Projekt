const fs = require("fs/promises");
const XLSX = require("xlsx");
const path = require("path");
const puppeteer = require("puppeteer");

async function convertXlsxToPdf(inputPath, outDir) {
  const buf = await fs.readFile(inputPath);
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const table = XLSX.utils.sheet_to_html(ws, { id: "sheet" });

  const htmlDoc = `
<!doctype html>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 12mm; }
  body { font: 11pt system-ui, -apple-system, Segoe UI, Arial; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 3px 5px; }
  tr { page-break-inside: avoid; }
</style>
<body>${table}</body>`;

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

module.exports = { convertXlsxToPdf };