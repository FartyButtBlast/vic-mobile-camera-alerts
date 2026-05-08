# Deploying Vic Mobile Camera Alerts

This is a static PWA. GitHub Pages can host it and GitHub Actions can refresh the Victorian mobile camera data automatically.

## One-time setup

1. Create a GitHub repository under `FartyButtBlast`.
2. Push this folder to the `main` branch.
3. In GitHub, open the repository settings.
4. Go to **Pages**.
5. Set **Build and deployment** to **GitHub Actions**.
6. Open the **Actions** tab and run **Build and deploy camera alerts** once.

GitHub will publish the site at:

`https://FartyButtBlast.github.io/YOUR-REPO/`

## Automatic updates

The workflow in `.github/workflows/deploy-pages.yml` runs:

- whenever you push to `main`
- whenever you trigger it manually
- once per day, so it can pick up the newest monthly camera spreadsheet after Data Vic publishes it

Each run downloads the latest mobile camera Excel resource from Data Vic, rebuilds `public/data/mobile-cameras-latest.json`, and deploys the refreshed PWA.

The workflow also stores the latest Excel file at:

`public/data/latest-mobile-camera-locations.xlsx`

The matching parsed JSON lives at:

`public/data/mobile-cameras-latest.json`

The fully mapped camera JSON lives at:

`public/data/mobile-cameras-geocoded.json`

The GitHub workflow creates or refreshes it automatically after loading the latest Excel. To run it locally:

```sh
npm run geocode:data
```

The geocoding job is resumable and writes progress back to the JSON file after each location. It intentionally runs slowly because public geocoders rate-limit bulk address lookup. If the Excel file has not changed, existing mapped coordinates are preserved.

## Local update

To refresh the camera data locally:

```sh
npm install
npm run build:data
```

Then run:

```sh
python3 -m http.server 4173 -d public
```

Open `http://127.0.0.1:4173/`.
