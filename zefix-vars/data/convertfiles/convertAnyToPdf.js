const path = require("path");
const fs = require("fs/promises");
const { convertDocxToPdf } = require("./convertDocxToPdf");
const { convertXlsxToPdf } = require("./convertXlsxToPdf");

const BLOCKED = new Set([".docm", ".xlsm"]);

async function convertAnyToPdf(inputPath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const ext = path.extname(inputPath).toLowerCase();

  if (BLOCKED.has(ext)) {
    throw new Error("Makro-Dateien sind blockiert.");
  }

  if (ext === ".pdf") {
    const out = path.join(outDir, path.basename(inputPath));
    await fs.copyFile(inputPath, out);
    return out;
  }

  if (ext === ".docx") {
    return convertDocxToPdf(inputPath, outDir);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    return convertXlsxToPdf(inputPath, outDir);
  }

  throw new Error(`Dateiformat nicht unterstützt: ${ext}`);
}

module.exports = { convertAnyToPdf };