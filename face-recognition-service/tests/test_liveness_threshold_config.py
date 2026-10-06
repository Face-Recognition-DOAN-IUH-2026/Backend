"""RED: liveness threshold and active-verdict bands must be config-driven."""
from __future__ import annotations

import pytest

from worker.anti_spoofing import AntiSpoofingAnalyzer, decide_active_verdict, get_liveness_threshold


@pytest.fixture
def analyzer() -> AntiSpoofingAnalyzer:
    return AntiSpoofingAnalyzer()


class TestLivenessThresholdConfig:
    def test_default_threshold_is_half(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("LIVENESS_THRESHOLD", raising=False)
        assert get_liveness_threshold() == 0.5

    def test_threshold_reads_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LIVENESS_THRESHOLD", "0.9")
        assert get_liveness_threshold() == 0.9

    def test_invalid_threshold_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LIVENESS_THRESHOLD", "not-a-number")
        assert get_liveness_threshold() == 0.5

    def test_aggregate_honors_configured_threshold(
        self, analyzer: AntiSpoofingAnalyzer, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        breakdown = {"lbp_score": 0.7, "color_score": 0.7, "noise_score": 0.7,
                     "fft_score": 0.7, "multi_scale_score": 0.7, "bbox_score": 0.7}
        monkeypatch.delenv("LIVENESS_THRESHOLD", raising=False)
        assert analyzer.aggregate(breakdown)["is_live"] is True

        monkeypatch.setenv("LIVENESS_THRESHOLD", "0.9")
        assert analyzer.aggregate(breakdown)["is_live"] is False


class TestActiveVerdictBands:
    def test_high_average_is_live(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        assert decide_active_verdict(0.70) == "live"

    def test_mid_average_is_inconclusive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        assert decide_active_verdict(0.50) == "inconclusive"

    def test_low_average_is_spoof(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ACTIVE_LIVENESS_REJECT_BELOW", raising=False)
        monkeypatch.delenv("ACTIVE_LIVENESS_LIVE_ABOVE", raising=False)
        assert decide_active_verdict(0.20) == "spoof"

    def test_bands_follow_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ACTIVE_LIVENESS_REJECT_BELOW", "0.3")
        monkeypatch.setenv("ACTIVE_LIVENESS_LIVE_ABOVE", "0.8")
        assert decide_active_verdict(0.50) == "inconclusive"
        assert decide_active_verdict(0.85) == "live"
        assert decide_active_verdict(0.10) == "spoof"
