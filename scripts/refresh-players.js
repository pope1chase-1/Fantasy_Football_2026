const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.sleeper.app/v1/players/nfl';
const OUTPUT_PATH = path.resolve(__dirname, '../SleeperAPI.json');

async function main() {
  const response = await fetch(API_URL, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Sleeper API request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  const totalPlayers = Object.keys(payload || {}).length;
  console.log(`Saved ${totalPlayers} players to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('Failed to refresh player data:', error);
  process.exit(1);
});
