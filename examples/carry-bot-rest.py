"""
carry-bot-rest.py — Carry trade strategy via Basalt REST API.

Start Basalt first:  npx basalt start
Then run this:       python examples/carry-bot-rest.py

Every parameter is YOUR CHOICE. Basalt does not advise on any of these values.
This software provides NO financial advice.
"""

import os
import json
import time
import requests

BASALT_URL = os.environ.get("BASALT_URL", "http://localhost:3100")
AUTH_TOKEN = os.environ.get("API_AUTH_TOKEN", "")

HEADERS = {
    "Content-Type": "application/json",
}
if AUTH_TOKEN:
    HEADERS["Authorization"] = f"Bearer {AUTH_TOKEN}"


def basalt_post(endpoint: str, data: dict) -> dict:
    resp = requests.post(f"{BASALT_URL}{endpoint}", headers=HEADERS, json=data)
    resp.raise_for_status()
    return resp.json()


def basalt_get(endpoint: str) -> dict:
    resp = requests.get(f"{BASALT_URL}{endpoint}", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()


def check_opportunities():
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Scanning carry opportunities...\n")

    # Validate a carry strategy against YOUR policy
    validation = basalt_post("/api/validate/strategy", {
        "type": "carry",
        "collateral": "tBTC",
        "collateralAmount": 2,
        "borrowAsset": "USDC",
        "targetLTV": 35,       # YOUR CHOICE
        "deployTo": "aave-v3-usdc-supply",
    })

    if not validation["approved"]:
        print(f"Strategy rejected: {validation.get('rejectionReason', 'unknown')}")
        return

    print("Strategy approved by YOUR policy. Building carry sequence (dry_run)...\n")

    result = basalt_post("/api/orchestrate/carry", {
        "collateral": "tBTC",
        "collateralAmount": 2,
        "borrowAsset": "USDC",
        "targetLTV": 35,
        "deployTo": "aave-v3-usdc-supply",
    })

    print(f"Status: {result['status']}")
    print(f"Steps: {len(result['steps'])}")
    for step in result["steps"]:
        print(f"  [{step['status']}] {step['action']}")


def main():
    # Check health first
    health = basalt_get("/api/health")
    print(f"Basalt: {health['status']} v{health['version']}")
    print(f"Disclaimer: {health['disclaimer']}\n")

    # Check current risk
    risk = basalt_get("/api/risk")
    print(f"Risk status: {risk['overallStatus']}\n")

    # Run strategy loop
    while True:
        try:
            check_opportunities()
        except Exception as e:
            print(f"Error: {e}")

        print(f"\nWaiting 4 hours...\n")
        time.sleep(4 * 3600)


if __name__ == "__main__":
    main()
