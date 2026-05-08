import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

const DATASET_API =
  "https://discover.data.vic.gov.au/api/3/action/package_show?id=road-safety-camera-network-mobile-camera-locations";
const dataDir = path.join(process.cwd(), "public", "data");
const jsonOutputPath = path.join(dataDir, "mobile-cameras-latest.json");
const excelOutputPath = path.join(dataDir, "latest-mobile-camera-locations.xlsx");

const dataset = await fetchJson(DATASET_API);
const resource = selectLatestExcelResource(dataset.result?.resources ?? []);

if (!resource) {
  throw new Error("No Excel resource found in the Data Vic mobile camera dataset.");
}

const workbookBuffer = await fetchArrayBuffer(resource.url);
const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
const data = parseRows(rows, resource);

await fs.mkdir(dataDir, { recursive: true });
await fs.writeFile(excelOutputPath, workbookBuffer);
await fs.writeFile(jsonOutputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

console.log(`Wrote ${data.count} mobile camera locations from ${data.sourceFile}.`);
console.log(`Saved latest Excel to ${path.relative(process.cwd(), excelOutputPath)}.`);

function selectLatestExcelResource(resources) {
  return resources
    .filter((resource) => {
      const format = String(resource.format ?? "");
      const url = String(resource.url ?? "");
      return /xls/i.test(format) || /\.xlsx?($|\?)/i.test(url);
    })
    .sort((a, b) => resourceDate(b) - resourceDate(a))[0];
}

function resourceDate(resource) {
  const value = resource.period_start || resource.metadata_modified || resource.created || resource.last_modified;
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.valueOf()) ? new Date(0) : date;
}

function parseRows(rows, resource) {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => String(cell).trim().toUpperCase() === "LOCATION")
  );
  if (headerIndex === -1) {
    throw new Error("Could not find LOCATION header in workbook.");
  }

  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const locationIndex = headers.findIndex((header) => /^location$/i.test(header));
  const suburbIndex = headers.findIndex((header) => /^suburb$/i.test(header));
  const reasonIndex = headers.findIndex((header) => /reason/i.test(header));
  const auditIndex = headers.findIndex((header) => /audit/i.test(header));

  if (locationIndex === -1 || suburbIndex === -1) {
    throw new Error("Workbook must contain LOCATION and SUBURB columns.");
  }

  const cameras = rows
    .slice(headerIndex + 1)
    .map((row, index) => {
      const location = String(row[locationIndex] || "").trim();
      const suburb = titleCase(String(row[suburbIndex] || "").trim());
      if (!location || !suburb) return null;
      return {
        id: slug(`${location}-${suburb}-${index}`),
        location,
        suburb,
        reasonCode: String(row[reasonIndex] || "").trim(),
        auditDate: String(row[auditIndex] || "").trim(),
        query: `${location}, ${suburb}, Victoria, Australia`
      };
    })
    .filter(Boolean);

  const sourceFile = resource.name || filenameFromUrl(resource.url) || "Mobile camera locations";

  return {
    sourceFile,
    sourceUrl: "data/latest-mobile-camera-locations.xlsx",
    upstreamSourceUrl: resource.url,
    datasetUrl: "https://discover.data.vic.gov.au/dataset/road-safety-camera-network-mobile-camera-locations",
    period: inferPeriod(sourceFile),
    count: cameras.length,
    cameras
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function filenameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function titleCase(value) {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function inferPeriod(fileName) {
  const match = String(fileName).match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)[-\s]+(\d{4})/i
  );
  return match ? `${titleCase(match[1])} ${match[2]}` : "latest";
}
