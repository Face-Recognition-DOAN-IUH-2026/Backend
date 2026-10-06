"""RED: POST /kiosk/liveness-active verdict matrix, validation, feature flag."""
from __future__ import annotations

import io
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from PIL import Image


def _jpeg_bytes(color: tuple[int, int, int] = (200, 150, 100)) -> bytes:
    img = Image.new("RGB", (64, 64), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _files(n: int) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("frames", (f"f{i}.jpg", _jpeg_bytes(), "image/jpeg")) for i in range(n)]


def _static_kps() -> list:
    base = [[-50.0, 0.0], [50.0, 0.0], [0.0, 10.0], [-20.0, 40.0], [20.0, 40.0]]
    return [base, base, base]


def _moving_kps() -> list:
    out = []
    for cx in (-30.0, 0.0, 30.0):
        out.append(
            [
                [cx - 50.0, 0.0],
                [cx + 50.0, 0.0],
                [cx, 10.0],
                [cx - 20.0, 40.0],
                [cx + 20.0, 40.0],
            ]
        )
    return out


@pytest.fixture
async def client(test_client: AsyncClient) -> AsyncClient:
    return test_client


class TestKioskLivenessActive:
    async def test_high_average_returns_live(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        with (
            patch("api.routers.kiosk._analyze_frame_liveness", return_value=0.70),
            patch("api.routers.kiosk._extract_frame_kps", side_effect=_moving_kps()),
        ):
            resp = await client.post("/kiosk/liveness-active", files=_files(3))
        assert resp.status_code == 200
        body = resp.json()
        assert body["verdict"] == "live"
        assert body["is_live"] is True
        assert body["liveness_score"] == pytest.approx(0.70)
        assert body["motion_displacement"] >= 0.15

    async def test_high_texture_without_motion_is_inconclusive(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Static replay (printed photo / phone held still) never goes live."""
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        with (
            patch("api.routers.kiosk._analyze_frame_liveness", return_value=0.90),
            patch("api.routers.kiosk._extract_frame_kps", side_effect=_static_kps()),
        ):
            resp = await client.post("/kiosk/liveness-active", files=_files(3))
        assert resp.status_code == 200
        body = resp.json()
        assert body["verdict"] == "inconclusive"
        assert body["is_live"] is False

    async def test_mid_average_returns_inconclusive(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        with (
            patch("api.routers.kiosk._analyze_frame_liveness", return_value=0.50),
            patch("api.routers.kiosk._extract_frame_kps", side_effect=[None, None, None]),
        ):
            resp = await client.post("/kiosk/liveness-active", files=_files(3))
        assert resp.status_code == 200
        body = resp.json()
        assert body["verdict"] == "inconclusive"
        assert body["is_live"] is False

    async def test_low_average_returns_spoof(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        with (
            patch("api.routers.kiosk._analyze_frame_liveness", return_value=0.20),
            patch("api.routers.kiosk._extract_frame_kps", side_effect=_moving_kps()),
        ):
            resp = await client.post("/kiosk/liveness-active", files=_files(3))
        assert resp.status_code == 200
        body = resp.json()
        assert body["verdict"] == "spoof"
        assert body["is_live"] is False

    async def test_spoof_verdict_records_audit_event(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        with (
            patch("api.routers.kiosk._analyze_frame_liveness", return_value=0.20),
            patch("api.routers.kiosk._extract_frame_kps", side_effect=_moving_kps()),
            patch("api.routers.kiosk._record_challenge_spoof") as recorder,
        ):
            resp = await client.post(
                "/kiosk/liveness-active",
                files=_files(3),
                data={"student_code": "SV001"},
            )
        assert resp.status_code == 200
        assert resp.json()["verdict"] == "spoof"
        recorder.assert_awaited_once_with("SV001", None)

    async def test_wrong_frame_count_is_rejected(self, client: AsyncClient) -> None:
        resp = await client.post("/kiosk/liveness-active", files=_files(2))
        assert resp.status_code == 422

    async def test_feature_disabled_returns_400(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ENABLE_ACTIVE_LIVENESS", "false")
        resp = await client.post("/kiosk/liveness-active", files=_files(3))
        assert resp.status_code == 400
        assert "disabled" in resp.json()["detail"].lower()

    async def test_corrupt_frame_is_rejected(self, client: AsyncClient) -> None:
        bad = [("frames", ("bad.jpg", b"not-an-image", "image/jpeg")) for _ in range(3)]
        resp = await client.post("/kiosk/liveness-active", files=bad)
        assert resp.status_code == 422
