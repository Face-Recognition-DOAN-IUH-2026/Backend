#!/usr/bin/env python3
"""
Camera Pipeline Latency Test
=============================
Measures end-to-end processing time for face recognition pipeline.

Tests:
  1. /face/process-sync  — synchronous kiosk flow (JSON base64)
  2. /face/identify       — async Celery flow (multipart + poll)
  3. /kiosk/enter          — async kiosk entry (multipart + poll)

Usage:
  python test_camera_latency.py --base-url http://localhost:8080 --iterations 10
  python test_camera_latency.py --base-url http://localhost:8080 --image face.jpg
"""

import argparse
import base64
import io
import json
import statistics
import sys
import time
from typing import Optional

import requests

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None
    Draw = None


def generate_test_image(width=640, height=480) -> bytes:
    """Generate a simple test image (grey face-like shape on white bg)."""
    if Image:
        img = Image.new("RGB", (width, height), (240, 240, 240))
        draw = ImageDraw.Draw(img)
        # Draw a face-like oval
        cx, cy = width // 2, height // 2
        draw.ellipse([cx - 80, cy - 100, cx + 80, cy + 100], fill=(200, 170, 140), outline=(180, 150, 120), width=2)
        # Eyes
        draw.ellipse([cx - 35, cy - 30, cx - 15, cy - 10], fill=(50, 50, 50))
        draw.ellipse([cx + 15, cy - 30, cx + 35, cy - 10], fill=(50, 50, 50))
        # Mouth
        draw.arc([cx - 25, cy + 10, cx + 25, cy + 40], start=0, end=180, fill=(150, 80, 80), width=2)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue()
    else:
        # Fallback: minimal valid JPEG
        # 1x1 pixel JPEG
        return base64.b64decode(
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsM"
            "DhEQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQU"
            "FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAA"
            "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAA"
            "AAAAAAAAAAAAAAAAAAAAQP/aAAwDAQACEQMRAD8AaA//2Q=="
        )


def load_image(path: str) -> bytes:
    """Load image from file and return bytes."""
    with open(path, "rb") as f:
        return f.read()


def image_to_base64_jpeg(data: bytes) -> str:
    """Convert image bytes to base64 JPEG string."""
    if Image:
        img = Image.open(io.BytesIO(data))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return base64.b64encode(buf.getvalue()).decode()
    return base64.b64encode(data).decode()


def test_process_sync(base_url: str, image_b64: str, camera_id: str = "test-kiosk") -> dict:
    """Test synchronous /face/process-sync endpoint."""
    url = f"{base_url}/face/process-sync"
    payload = {
        "image": image_b64,
        "camera_id": camera_id,
        "process_type": "identify",
        "consent_given": True,
    }
    start = time.perf_counter()
    resp = requests.post(url, json=payload, timeout=30)
    elapsed = time.perf_counter() - start
    return {
        "status_code": resp.status_code,
        "elapsed_s": round(elapsed, 4),
        "response": resp.json() if resp.status_code < 500 else resp.text[:200],
    }


def test_identify_async(base_url: str, image_data: bytes, camera_id: str = "test-kiosk") -> dict:
    """Test async /face/identify + poll task result."""
    url = f"{base_url}/face/identify"
    files = {"file": ("test.jpg", image_data, "image/jpeg")}
    data = {"camera_id": camera_id, "consent_given": "true"}

    start = time.perf_counter()
    resp = requests.post(url, files=files, data=data, timeout=30)
    submit_elapsed = time.perf_counter() - start

    if resp.status_code != 202:
        return {
            "status_code": resp.status_code,
            "elapsed_s": round(submit_elapsed, 4),
            "response": resp.text[:200],
        }

    task_id = resp.json().get("task_id")
    if not task_id:
        return {
            "status_code": resp.status_code,
            "elapsed_s": round(submit_elapsed, 4),
            "response": resp.json(),
        }

    # Poll for result
    task_url = f"{base_url}/tasks/{task_id}"
    poll_count = 0
    max_polls = 60  # 60 * 0.5s = 30s max
    result = None

    while poll_count < max_polls:
        time.sleep(0.5)
        poll_count += 1
        try:
            poll_resp = requests.get(task_url, timeout=10)
            if poll_resp.status_code == 200:
                task_data = poll_resp.json()
                status = task_data.get("status", "")
                if status in ("SUCCESS", "FAILURE", "REVOKED"):
                    result = task_data
                    break
        except Exception:
            continue

    total_elapsed = time.perf_counter() - start
    return {
        "status_code": 200,
        "task_id": task_id,
        "elapsed_s": round(total_elapsed, 4),
        "submit_s": round(submit_elapsed, 4),
        "polls": poll_count,
        "response": result or {"status": "TIMEOUT"},
    }


def test_kiosk_enter(base_url: str, image_data: bytes, student_code: str = "test") -> dict:
    """Test async /kiosk/enter + poll task result."""
    url = f"{base_url}/kiosk/enter"
    files = {"image": ("test.jpg", image_data, "image/jpeg")}
    data = {"student_code": student_code}

    start = time.perf_counter()
    resp = requests.post(url, files=files, data=data, timeout=30)
    submit_elapsed = time.perf_counter() - start

    if resp.status_code != 202:
        return {
            "status_code": resp.status_code,
            "elapsed_s": round(submit_elapsed, 4),
            "response": resp.text[:200],
        }

    task_id = resp.json().get("task_id")
    if not task_id:
        return {
            "status_code": resp.status_code,
            "elapsed_s": round(submit_elapsed, 4),
            "response": resp.json(),
        }

    # Poll for result
    task_url = f"{base_url}/tasks/{task_id}"
    poll_count = 0
    max_polls = 60
    result = None

    while poll_count < max_polls:
        time.sleep(0.5)
        poll_count += 1
        try:
            poll_resp = requests.get(task_url, timeout=10)
            if poll_resp.status_code == 200:
                task_data = poll_resp.json()
                status = task_data.get("status", "")
                if status in ("SUCCESS", "FAILURE", "REVOKED"):
                    result = task_data
                    break
        except Exception:
            continue

    total_elapsed = time.perf_counter() - start
    return {
        "status_code": 200,
        "task_id": task_id,
        "elapsed_s": round(total_elapsed, 4),
        "submit_s": round(submit_elapsed, 4),
        "polls": poll_count,
        "response": result or {"status": "TIMEOUT"},
    }


def compute_stats(latencies: list[float]) -> dict:
    """Compute latency statistics."""
    if not latencies:
        return {}
    sorted_lat = sorted(latencies)
    n = len(sorted_lat)
    return {
        "min_s": round(sorted_lat[0], 4),
        "max_s": round(sorted_lat[-1], 4),
        "avg_s": round(statistics.mean(sorted_lat), 4),
        "median_s": round(statistics.median(sorted_lat), 4),
        "p95_s": round(sorted_lat[int(n * 0.95)] if n > 1 else sorted_lat[0], 4),
        "p99_s": round(sorted_lat[int(n * 0.99)] if n > 1 else sorted_lat[0], 4),
        "stddev_s": round(statistics.stdev(sorted_lat), 4) if n > 1 else 0,
        "count": n,
    }


def print_stats(label: str, stats: dict, results: list[dict]):
    """Pretty-print latency statistics."""
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print(f"{'=' * 60}")
    print(f"  Iterations : {stats['count']}")
    print(f"  Min        : {stats['min_s'] * 1000:.1f} ms")
    print(f"  Max        : {stats['max_s'] * 1000:.1f} ms")
    print(f"  Average    : {stats['avg_s'] * 1000:.1f} ms")
    print(f"  Median     : {stats['median_s'] * 1000:.1f} ms")
    print(f"  P95        : {stats['p95_s'] * 1000:.1f} ms")
    print(f"  P99        : {stats['p99_s'] * 1000:.1f} ms")
    print(f"  Std Dev    : {stats['stddev_s'] * 1000:.1f} ms")

    # Status breakdown
    statuses = {}
    for r in results:
        resp = r.get("response", {})
        s = resp.get("status", resp.get("detail", "unknown"))
        statuses[s] = statuses.get(s, 0) + 1
    print(f"\n  Status Breakdown:")
    for s, c in sorted(statuses.items(), key=lambda x: -x[1]):
        print(f"    {s}: {c}")

    # Show individual timings
    print(f"\n  Individual timings:")
    for i, r in enumerate(results):
        resp = r.get("response", {})
        status = resp.get("status", "?")
        print(f"    [{i + 1}] {r['elapsed_s'] * 1000:.1f} ms — {status}")
    print(f"{'=' * 60}\n")


def main():
    parser = argparse.ArgumentParser(description="Camera pipeline latency test")
    parser.add_argument("--base-url", default="http://localhost:8080", help="Face-recognition API base URL")
    parser.add_argument("--iterations", "-n", type=int, default=5, help="Number of test iterations")
    parser.add_argument("--image", help="Path to test face image (optional, generates synthetic if not provided)")
    parser.add_argument("--tests", nargs="+", default=["process-sync", "identify", "kiosk-enter"],
                        help="Tests to run: process-sync, identify, kiosk-enter")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between iterations (seconds)")
    args = parser.parse_args()

    # Load or generate test image
    if args.image:
        image_data = load_image(args.image)
        print(f"[INFO] Loaded image: {args.image} ({len(image_data)} bytes)")
    else:
        image_data = generate_test_image()
        print(f"[INFO] Generated synthetic test image ({len(image_data)} bytes)")

    image_b64 = image_to_base64_jpeg(image_data)

    # Health check
    print(f"\n[CHECK] Connecting to {args.base_url} ...")
    try:
        health = requests.get(f"{args.base_url}/healthz", timeout=5)
        print(f"[CHECK] Health: {health.json()}")
    except Exception as e:
        print(f"[ERROR] Cannot reach {args.base_url}: {e}")
        sys.exit(1)

    all_results = {}

    # Test 1: process-sync
    if "process-sync" in args.tests:
        print(f"\n[RUN] Testing /face/process-sync ({args.iterations} iterations) ...")
        results = []
        for i in range(args.iterations):
            r = test_process_sync(args.base_url, image_b64)
            results.append(r)
            tag = "OK" if r["status_code"] == 200 else f"ERR({r['status_code']})"
            print(f"  [{i + 1}/{args.iterations}] {r['elapsed_s'] * 1000:.1f} ms — {tag}")
            if args.delay > 0 and i < args.iterations - 1:
                time.sleep(args.delay)
        latencies = [r["elapsed_s"] for r in results if r["status_code"] == 200]
        if latencies:
            stats = compute_stats(latencies)
            print_stats("process-sync (synchronous kiosk)", stats, results)
            all_results["process-sync"] = stats
        else:
            print("  [WARN] No successful iterations")

    # Test 2: identify (async)
    if "identify" in args.tests:
        print(f"\n[RUN] Testing /face/identify ({args.iterations} iterations) ...")
        results = []
        for i in range(args.iterations):
            r = test_identify_async(args.base_url, image_data)
            results.append(r)
            tag = "OK" if r["status_code"] == 200 else f"ERR({r['status_code']})"
            resp_status = r.get("response", {}).get("status", "?")
            print(f"  [{i + 1}/{args.iterations}] {r['elapsed_s'] * 1000:.1f} ms — {tag} ({resp_status})")
            if args.delay > 0 and i < args.iterations - 1:
                time.sleep(args.delay)
        latencies = [r["elapsed_s"] for r in results if r["status_code"] == 200]
        if latencies:
            stats = compute_stats(latencies)
            print_stats("identify (async Celery)", stats, results)
            all_results["identify"] = stats
        else:
            print("  [WARN] No successful iterations")

    # Test 3: kiosk-enter (async)
    if "kiosk-enter" in args.tests:
        print(f"\n[RUN] Testing /kiosk/enter ({args.iterations} iterations) ...")
        results = []
        for i in range(args.iterations):
            r = test_kiosk_enter(args.base_url, image_data)
            results.append(r)
            tag = "OK" if r["status_code"] == 200 else f"ERR({r['status_code']})"
            resp_status = r.get("response", {}).get("status", "?")
            print(f"  [{i + 1}/{args.iterations}] {r['elapsed_s'] * 1000:.1f} ms — {tag} ({resp_status})")
            if args.delay > 0 and i < args.iterations - 1:
                time.sleep(args.delay)
        latencies = [r["elapsed_s"] for r in results if r["status_code"] == 200]
        if latencies:
            stats = compute_stats(latencies)
            print_stats("kiosk-enter (async Celery)", stats, results)
            all_results["kiosk-enter"] = stats
        else:
            print("  [WARN] No successful iterations")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"  SUMMARY")
    print(f"{'=' * 60}")
    for test_name, stats in all_results.items():
        print(f"  {test_name:20s}  avg={stats['avg_s'] * 1000:8.1f}ms  p95={stats['p95_s'] * 1000:8.1f}ms")
    print(f"{'=' * 60}\n")

    # Save results to JSON
    output_file = "camera_latency_results.json"
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"[DONE] Results saved to {output_file}")


if __name__ == "__main__":
    main()
