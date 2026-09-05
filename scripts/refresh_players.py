#!/usr/bin/env python3
import json
import urllib.request
from pathlib import Path

API_URL = "https://api.sleeper.app/v1/players/nfl"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "SleeperAPI.json"


def main() -> None:
    with urllib.request.urlopen(API_URL, timeout=30) as response:
        payload = json.load(response)

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    player_count = len(payload) if isinstance(payload, dict) else 0
    print(f"Saved {player_count} players to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
