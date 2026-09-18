# The Manning vs. Brady Draft Grudge Match

A polished fantasy football draft board for tracking Sleeper player data, filtering by team, position, injury status, and 2026 rank, while marking players as drafted in the rivalry showdown.

## Files

- `index.html` — interactive dashboard
- `SleeperAPI.json` — local player dataset snapshot
- `scripts/refresh-players.js` — fetches the latest data from the Sleeper API

## Open locally

Open `index.html` directly in a browser, or serve the folder with:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Refresh the JSON from Sleeper

Run:

```bash
python3 scripts/refresh_players.py
```

or:

```bash
npm run refresh-players
```

This fetches the live NFL player list from the Sleeper API and overwrites the local JSON file used by the dashboard.

A GitHub Actions workflow is also included in `.github/workflows/refresh-sleeper-data.yml` to refresh the snapshot automatically on a schedule and via manual dispatch.

## Notes

This is a static front-end project designed to run locally or on GitHub Pages without a backend.

