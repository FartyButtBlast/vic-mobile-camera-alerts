const DATASET_API =
  "https://discover.data.vic.gov.au/api/3/action/package_show?id=road-safety-camera-network-mobile-camera-locations";
const SEED_DATA = "/data/mobile-cameras-april-2026.json";
const GEOCODE_CACHE_KEY = "vic-camera-geocodes-v1";
const CAMERA_DATA_KEY = "vic-camera-data-v1";
const SETTINGS_KEY = "vic-camera-settings-v1";
const ALERT_COOLDOWN_MS = 90_000;

const state = {
  cameras: [],
  geocodes: loadJson(GEOCODE_CACHE_KEY, {}),
  userPosition: null,
  nearest: null,
  watchId: null,
  alertRadius: Number(loadJson(SETTINGS_KEY, { radius: 750 }).radius || 750),
  map: null,
  userMarker: null,
  cameraLayer: null,
  routeLine: null,
  lastAlertAt: 0,
  audioContext: null
};

const els = {
  alertCard: document.querySelector("#alertCard"),
  nearestTitle: document.querySelector("#nearestTitle"),
  nearestMeta: document.querySelector("#nearestMeta"),
  startButton: document.querySelector("#startButton"),
  notifyButton: document.querySelector("#notifyButton"),
  soundTestButton: document.querySelector("#soundTestButton"),
  radiusInput: document.querySelector("#radiusInput"),
  radiusValue: document.querySelector("#radiusValue"),
  cameraCount: document.querySelector("#cameraCount"),
  codedCount: document.querySelector("#codedCount"),
  lastUpdate: document.querySelector("#lastUpdate"),
  monthlyButton: document.querySelector("#monthlyButton"),
  fileInput: document.querySelector("#fileInput"),
  geocodeButton: document.querySelector("#geocodeButton"),
  dataStatus: document.querySelector("#dataStatus")
};

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  await whenLeafletReady();
  initMap();
  wireControls();
  await registerServiceWorker();
  await loadCameraData();
  render();
}

function initMap() {
  state.map = L.map("map", { zoomControl: false }).setView([-37.8136, 144.9631], 10);
  L.control.zoom({ position: "topright" }).addTo(state.map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(state.map);
  state.cameraLayer = L.layerGroup().addTo(state.map);
}

function wireControls() {
  els.radiusInput.value = state.alertRadius;
  els.radiusValue.textContent = formatDistance(state.alertRadius);

  els.startButton.addEventListener("click", toggleTracking);
  els.notifyButton.addEventListener("click", requestNotifications);
  els.soundTestButton.addEventListener("click", () => playMobileAlert(true));
  els.monthlyButton.addEventListener("click", downloadLatestMonthlyFile);
  els.geocodeButton.addEventListener("click", () => geocodeNextBatch(35));
  els.fileInput.addEventListener("change", importSelectedFile);
  els.radiusInput.addEventListener("input", () => {
    state.alertRadius = Number(els.radiusInput.value);
    saveJson(SETTINGS_KEY, { radius: state.alertRadius });
    els.radiusValue.textContent = formatDistance(state.alertRadius);
    evaluateNearest();
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (error) {
      console.warn("Service worker unavailable", error);
    }
  }
}

async function loadCameraData() {
  const cached = loadJson(CAMERA_DATA_KEY, null);
  if (cached?.cameras?.length) {
    applyCameraData(cached, "Loaded cached camera data.");
    return;
  }

  const response = await fetch(SEED_DATA);
  const data = await response.json();
  applyCameraData(data, "Loaded April 2026 from the local seed file.");
}

function applyCameraData(data, statusText) {
  state.cameras = data.cameras.map((camera, index) => ({
    ...camera,
    id: camera.id || slug(`${camera.location}-${camera.suburb}-${index}`),
    query: camera.query || `${camera.location}, ${camera.suburb}, Victoria, Australia`
  }));
  els.lastUpdate.textContent = data.period || "latest";
  els.dataStatus.textContent = statusText;
  saveJson(CAMERA_DATA_KEY, { ...data, cameras: state.cameras });
  render();
  drawKnownCameraMarkers();
  evaluateNearest();
}

function toggleTracking() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    els.startButton.textContent = "Start tracking";
    els.nearestTitle.textContent = "Tracking paused";
    els.nearestMeta.textContent = "Start tracking again when you are driving.";
    return;
  }

  if (!("geolocation" in navigator)) {
    els.nearestTitle.textContent = "Location is unavailable";
    els.nearestMeta.textContent = "This browser does not support GPS tracking.";
    return;
  }

  els.startButton.textContent = "Starting...";
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

function onPosition(position) {
  const { latitude, longitude, accuracy, speed, heading } = position.coords;
  state.userPosition = { lat: latitude, lng: longitude, accuracy, speed, heading };
  els.startButton.textContent = "Stop tracking";
  updateUserMarker();
  evaluateNearest();
}

function onPositionError(error) {
  els.startButton.textContent = "Start tracking";
  els.nearestTitle.textContent = "Location permission needed";
  els.nearestMeta.textContent = error.message || "Allow location access to monitor nearby camera sites.";
}

function updateUserMarker() {
  const latLng = [state.userPosition.lat, state.userPosition.lng];
  const icon = L.divIcon({ className: "", html: '<div class="user-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!state.userMarker) {
    state.userMarker = L.marker(latLng, { icon }).addTo(state.map);
    state.map.setView(latLng, 15);
  } else {
    state.userMarker.setLatLng(latLng);
  }
}

function evaluateNearest() {
  if (!state.userPosition) {
    render();
    return;
  }

  const mapped = state.cameras
    .map((camera) => ({ camera, coords: state.geocodes[camera.id] }))
    .filter((item) => item.coords);

  if (!mapped.length) {
    els.nearestTitle.textContent = "No mapped camera sites yet";
    els.nearestMeta.textContent = "Use Data updates to map locations. They are cached for future trips.";
    render();
    return;
  }

  let nearest = null;
  for (const item of mapped) {
    const distance = distanceMeters(state.userPosition, item.coords);
    if (!nearest || distance < nearest.distance) nearest = { ...item, distance };
  }
  state.nearest = nearest;
  renderNearest();
  if (nearest.distance <= state.alertRadius) triggerApproachAlert(nearest);
}

function renderNearest() {
  const nearest = state.nearest;
  if (!nearest) return;
  const camera = nearest.camera;
  const close = nearest.distance <= state.alertRadius;
  els.alertCard.classList.toggle("alerting", close);
  els.nearestTitle.textContent = `${camera.location}, ${camera.suburb}`;
  els.nearestMeta.textContent = `${formatDistance(nearest.distance)} away. Mobile camera approved location, presence not guaranteed.`;

  const userLatLng = [state.userPosition.lat, state.userPosition.lng];
  const cameraLatLng = [nearest.coords.lat, nearest.coords.lng];
  drawKnownCameraMarkers(nearest.camera.id);
  if (state.routeLine) state.routeLine.remove();
  state.routeLine = L.polyline([userLatLng, cameraLatLng], { color: close ? "#ff5c77" : "#f7c948", weight: 4 }).addTo(state.map);
  if (close) {
    state.map.fitBounds(L.latLngBounds([userLatLng, cameraLatLng]).pad(0.45), { maxZoom: 17 });
  }
}

function triggerApproachAlert(nearest) {
  const now = Date.now();
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
  state.lastAlertAt = now;
  playMobileAlert();

  const body = `${nearest.camera.location}, ${nearest.camera.suburb} is ${formatDistance(nearest.distance)} away.`;
  if (Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then((registration) => {
      registration.showNotification("Mobile camera approved location nearby", {
        body,
        tag: `camera-${nearest.camera.id}`,
        icon: "/icon.svg",
        badge: "/icon.svg"
      });
    });
  }
}

function playMobileAlert(short = false) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audioContext ||= new AudioContext();
  const ctx = state.audioContext;
  const pattern = short ? [880, 0, 660] : [880, 0, 660, 0, 880, 0, 1040];
  pattern.forEach((frequency, index) => {
    if (!frequency) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + index * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.18 + 0.15);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(ctx.currentTime + index * 0.18);
    oscillator.stop(ctx.currentTime + index * 0.18 + 0.16);
  });
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    els.notifyButton.textContent = "No notifications";
    return;
  }
  const permission = await Notification.requestPermission();
  els.notifyButton.textContent = permission === "granted" ? "Alerts enabled" : "Enable alerts";
}

async function geocodeNextBatch(limit = 25) {
  const pending = state.cameras.filter((camera) => !state.geocodes[camera.id]).slice(0, limit);
  if (!pending.length) {
    els.dataStatus.textContent = "All loaded camera sites have mapped positions.";
    return;
  }

  els.geocodeButton.disabled = true;
  for (const [index, camera] of pending.entries()) {
    els.dataStatus.textContent = `Mapping ${index + 1} of ${pending.length}: ${camera.location}, ${camera.suburb}`;
    const coords = await geocodeCamera(camera);
    if (coords) {
      state.geocodes[camera.id] = coords;
      saveJson(GEOCODE_CACHE_KEY, state.geocodes);
      drawKnownCameraMarkers();
      evaluateNearest();
    }
    await sleep(1150);
  }
  els.geocodeButton.disabled = false;
  els.dataStatus.textContent = `Mapped ${Object.keys(state.geocodes).length} locations.`;
  render();
}

async function geocodeCamera(camera) {
  const params = new URLSearchParams({
    format: "jsonv2",
    countrycodes: "au",
    limit: "1",
    q: camera.query
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const [match] = await response.json();
    if (!match) return null;
    return { lat: Number(match.lat), lng: Number(match.lon), label: match.display_name, approximate: true };
  } catch (error) {
    console.warn("Geocode failed", error);
    return null;
  }
}

async function downloadLatestMonthlyFile() {
  els.dataStatus.textContent = "Checking Data Vic for the latest monthly file...";
  try {
    const response = await fetch(DATASET_API);
    const payload = await response.json();
    const resources = payload.result.resources
      .filter((resource) => /xls/i.test(resource.format || "") || /\.xlsx?$/i.test(resource.url || ""))
      .sort((a, b) => new Date(b.period_start || b.created || b.metadata_modified) - new Date(a.period_start || a.created || a.metadata_modified));
    const latest = resources[0];
    if (!latest?.url) throw new Error("No Excel resource found");
    els.dataStatus.textContent = `Downloading ${latest.name || "latest mobile camera file"}...`;
    const fileResponse = await fetch(latest.url);
    const buffer = await fileResponse.arrayBuffer();
    const data = parseWorkbook(buffer, latest.name || "Latest mobile camera file", latest.url);
    applyCameraData(data, `Loaded ${data.period || "latest"} from Data Vic.`);
  } catch (error) {
    els.dataStatus.textContent = "Monthly download was blocked by the browser. Import the Excel file manually instead.";
    console.warn(error);
  }
}

async function importSelectedFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const data = parseWorkbook(buffer, file.name, "");
  applyCameraData(data, `Imported ${file.name}.`);
  event.target.value = "";
}

function parseWorkbook(buffer, sourceFile, sourceUrl) {
  if (!window.XLSX) throw new Error("Excel parser unavailable");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim().toUpperCase() === "LOCATION"));
  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const locationIndex = headers.findIndex((header) => /^location$/i.test(header));
  const suburbIndex = headers.findIndex((header) => /^suburb$/i.test(header));
  const reasonIndex = headers.findIndex((header) => /reason/i.test(header));
  const auditIndex = headers.findIndex((header) => /audit/i.test(header));
  const cameras = rows.slice(headerIndex + 1).map((row, index) => {
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
  }).filter(Boolean);

  return {
    sourceFile,
    sourceUrl,
    datasetUrl: "https://discover.data.vic.gov.au/dataset/road-safety-camera-network-mobile-camera-locations",
    period: inferPeriod(sourceFile),
    count: cameras.length,
    cameras
  };
}

function drawKnownCameraMarkers(activeId = "") {
  if (!state.cameraLayer) return;
  state.cameraLayer.clearLayers();
  const markers = state.cameras
    .filter((camera) => state.geocodes[camera.id])
    .slice(0, 600)
    .map((camera) => {
      const coords = state.geocodes[camera.id];
      const icon = L.divIcon({
        className: "",
        html: `<div class="camera-marker">${camera.id === activeId ? "!" : "M"}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      return L.marker([coords.lat, coords.lng], { icon }).bindPopup(`<strong>${escapeHtml(camera.location)}</strong><br>${escapeHtml(camera.suburb)}<br>Mobile approved location`);
    });
  markers.forEach((marker) => marker.addTo(state.cameraLayer));
}

function render() {
  els.cameraCount.textContent = String(state.cameras.length);
  els.codedCount.textContent = String(Object.keys(state.geocodes).length);
  if (Notification.permission === "granted") els.notifyButton.textContent = "Alerts enabled";
}

function distanceMeters(a, b) {
  const radius = 6371e3;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function titleCase(value) {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

function inferPeriod(fileName) {
  const match = String(fileName).match(/(January|February|March|April|May|June|July|August|September|October|November|December)[-\s]+(\d{4})/i);
  return match ? `${titleCase(match[1])} ${match[2]}` : "latest";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function whenLeafletReady() {
  return new Promise((resolve) => {
    const check = () => (window.L ? resolve() : requestAnimationFrame(check));
    check();
  });
}
