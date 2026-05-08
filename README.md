# Vic Mobile Camera Alerts

A mobile-first PWA prototype for Victorian approved mobile road safety camera locations.

The app loads the Victorian mobile camera location spreadsheet, watches the user's current location while the app is open, and alerts when an approved mobile camera location is nearby. Mobile camera locations are approved sites only, so the alert does not guarantee a camera is present.

## Run Locally

```sh
python3 -m http.server 4173 -d public
```

Then open `http://127.0.0.1:4173/`.

## Deploy

This project is set up like AFL Performance Lab: GitHub Pages deploys the static PWA from `.github/workflows/deploy-pages.yml`.

The intended repository is:

`https://github.com/FartyButtBlast/vic-mobile-camera-alerts`

After the repository exists, push `main`, then set GitHub Pages to **GitHub Actions**.

The latest Excel source is stored in the repo and published with the app at:

`public/data/latest-mobile-camera-locations.xlsx`

On GitHub Pages it is available at:

`https://FartyButtBlast.github.io/vic-mobile-camera-alerts/data/latest-mobile-camera-locations.xlsx`

The app can also load pre-mapped coordinates from:

`public/data/mobile-cameras-geocoded.json`

Refresh that file only when a new Excel is loaded:

```sh
npm run geocode:data
```

## Notes

- The source spreadsheet contains location descriptions and suburbs, but not latitude/longitude.
- The app geocodes camera locations and caches mapped positions in the browser.
- Full background GPS monitoring and foreground wake-up behavior need a native mobile wrapper, such as Capacitor, because mobile browsers limit PWA background execution.
