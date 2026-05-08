import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const dataDir = path.join(process.cwd(), "public", "data");
const sourcePath = path.join(dataDir, "mobile-cameras-latest.json");
const outputPath = path.join(dataDir, "mobile-cameras-geocoded.json");
const delayMs = Number(process.env.GEOCODE_DELAY_MS || 1200);
const limit = Number(process.env.GEOCODE_LIMIT || 0);
const force = process.argv.includes("--force");

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const existing = await readExistingOutput();
const geocodedById = new Map((existing.locations || []).map((row) => [row.id, row]));
const failuresById = new Map((existing.failures || []).map((row) => [row.id, row]));

let processed = 0;

for (const camera of source.cameras) {
  if (!force && geocodedById.has(camera.id)) continue;
  if (limit && processed >= limit) break;

  const query = camera.query || `${camera.location}, ${camera.suburb}, Victoria, Australia`;
  const result = await geocode(query);
  processed += 1;

  if (result) {
    geocodedById.set(camera.id, {
      id: camera.id,
      location: camera.location,
      suburb: camera.suburb,
      query,
      lat: result.lat,
      lng: result.lng,
      label: result.label,
      geocoder: "nominatim",
      approximate: true,
      geocodedAt: new Date().toISOString()
    });
    failuresById.delete(camera.id);
    console.log(`mapped ${processed}: ${camera.location}, ${camera.suburb}`);
  } else {
    failuresById.set(camera.id, {
      id: camera.id,
      location: camera.location,
      suburb: camera.suburb,
      query,
      reason: "No geocoder match",
      attemptedAt: new Date().toISOString()
    });
    console.log(`unmapped ${processed}: ${camera.location}, ${camera.suburb}`);
  }

  await writeOutput(source, geocodedById, failuresById);
  await sleep(delayMs);
}

await writeOutput(source, geocodedById, failuresById);
console.log(`Mapped ${geocodedById.size} of ${source.cameras.length} locations.`);
console.log(`Saved ${path.relative(process.cwd(), outputPath)}.`);

async function geocode(query) {
  const params = new URLSearchParams({
    format: "jsonv2",
    countrycodes: "au",
    limit: "1",
    q: query
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "vic-mobile-camera-alerts/0.1 (https://github.com/FartyButtBlast/vic-mobile-camera-alerts)"
    }
  });

  if (!response.ok) {
    throw new Error(`Geocoder request failed: ${response.status}`);
  }

  const [match] = await response.json();
  if (!match) return null;
  return {
    lat: Number(match.lat),
    lng: Number(match.lon),
    label: match.display_name
  };
}

async function readExistingOutput() {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    return { locations: [], failures: [] };
  }
}

async function writeOutput(sourceData, mapped, failures) {
  const locations = Array.from(mapped.values()).sort(sortByName);
  const failed = Array.from(failures.values()).sort(sortByName);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFile: sourceData.sourceFile,
    sourceUrl: sourceData.sourceUrl,
    upstreamSourceUrl: sourceData.upstreamSourceUrl,
    period: sourceData.period,
    count: sourceData.cameras.length,
    mappedCount: locations.length,
    unmappedCount: sourceData.cameras.length - locations.length,
    note: "Generated when a new mobile camera Excel file is loaded. Coordinates are approximate geocodes from road/suburb descriptions.",
    locations,
    failures: failed
  };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sortByName(a, b) {
  return `${a.suburb} ${a.location}`.localeCompare(`${b.suburb} ${b.location}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
