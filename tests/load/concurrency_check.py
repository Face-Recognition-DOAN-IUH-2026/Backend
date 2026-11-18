"""
Concurrency & Race Condition Verifier for Smart Library Backend.

Tests two real-world concurrency hazards against a running local/staging stack:
  1. Concurrent borrow of the exact same copy barcode (only 1 should ever succeed).
  2. Duplicate SePay payment webhook delivery for the same orderCode (idempotency check).
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys
import uuid
import requests


def check_concurrent_borrow(base_url: str, token: str, barcode: str, workers: int) -> bool:
    url = f"{base_url.rstrip('/')}/api/borrow/"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _attempt(_idx: int) -> tuple[int, str]:
        resp = requests.post(url, json={"barcode": barcode}, headers=headers, timeout=15)
        return resp.status_code, resp.text[:160]

    statuses: list[int] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_attempt, i) for i in range(workers)]
        for fut in as_completed(futures):
            code, body = fut.result()
            statuses.append(code)
            print(f"  [borrow] status={code} body={body}")

    success_count = sum(1 for s in statuses if s in (200, 201))
    server_errors = sum(1 for s in statuses if s >= 500)
    print(f"Concurrent borrow summary: workers={workers}, 2xx={success_count}, 5xx={server_errors}")
    return success_count <= 1 and server_errors == 0


def check_duplicate_webhook(base_url: str, order_code: str, amount: int, workers: int, api_key: str = "") -> bool:
    url = f"{base_url.rstrip('/')}/api/borrow/payments/sepay-webhook"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Apikey {api_key}"

    tx_id = int(uuid.uuid4().int % 1_000_000_000)
    payload = {
        "id": tx_id,
        "gateway": "MBBank",
        "transactionDate": "2026-11-18 12:00:00",
        "accountNumber": "0123456789",
        "content": order_code,
        "transferType": "in",
        "transferAmount": amount,
        "referenceCode": f"FT{tx_id}",
    }

    def _send(_idx: int) -> tuple[int, str]:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        return resp.status_code, resp.text[:160]

    statuses: list[int] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_send, i) for i in range(workers)]
        for fut in as_completed(futures):
            code, body = fut.result()
            statuses.append(code)
            print(f"  [webhook] status={code} body={body}")

    server_errors = sum(1 for s in statuses if s >= 500)
    print(f"Duplicate webhook summary: workers={workers}, statuses={statuses}, 5xx={server_errors}")
    return server_errors == 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify concurrent borrow & webhook idempotency.")
    parser.add_argument("--base-url", default="http://localhost:80")
    parser.add_argument("--token", default="", help="Bearer JWT for borrow test")
    parser.add_argument("--barcode", default="", help="Copy barcode for concurrent borrow test")
    parser.add_argument("--order-code", default="", help="Order code for duplicate SePay webhook test")
    parser.add_argument("--amount", type=int, default=10000)
    parser.add_argument("--sepay-key", default="")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()

    ok = True
    if args.token and args.barcode:
        print(f"Running concurrent borrow check ({args.workers} parallel requests)...")
        ok = check_concurrent_borrow(args.base_url, args.token, args.barcode, args.workers) and ok
    else:
        print("Skipping concurrent borrow check (pass --token and --barcode to run).")

    if args.order_code:
        print(f"Running duplicate webhook check ({args.workers} parallel requests)...")
        ok = check_duplicate_webhook(args.base_url, args.order_code, args.amount, args.workers, args.sepay_key) and ok
    else:
        print("Skipping duplicate webhook check (pass --order-code to run).")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
