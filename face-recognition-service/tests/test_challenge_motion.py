"""RED: motion verification for the active challenge must reject static replays."""

import numpy as np
import pytest

from worker.anti_spoofing import verify_challenge_motion


def _kps(cx: float, cy: float, iod: float = 100.0) -> np.ndarray:
    """Synthetic 5-point kps: [left_eye, right_eye, nose, mouth_l, mouth_r]."""
    return np.array(
        [
            [cx - iod / 2, cy],
            [cx + iod / 2, cy],
            [cx, cy + 10.0],
            [cx - 20.0, cy + 40.0],
            [cx + 20.0, cy + 40.0],
        ],
        dtype=np.float64,
    )


class TestVerifyChallengeMotion:
    def test_static_sequence_has_no_motion(self) -> None:
        frames = [_kps(0.0, 0.0) for _ in range(3)]
        result = verify_challenge_motion(frames)
        assert result["has_motion"] is False

    def test_head_turn_has_motion(self) -> None:
        frames = [_kps(-30.0, 0.0), _kps(0.0, 0.0), _kps(30.0, 0.0)]
        result = verify_challenge_motion(frames)
        assert result["has_motion"] is True
        assert result["displacement"] >= 0.15

    def test_head_nod_has_motion(self) -> None:
        frames = [_kps(0.0, -25.0), _kps(0.0, 0.0), _kps(0.0, 25.0)]
        result = verify_challenge_motion(frames)
        assert result["has_motion"] is True

    def test_hand_tremor_has_no_motion(self) -> None:
        frames = [_kps(2.0, -1.0), _kps(0.0, 0.0), _kps(-2.0, 1.5)]
        result = verify_challenge_motion(frames)
        assert result["has_motion"] is False

    def test_missing_frames_have_no_motion(self) -> None:
        assert verify_challenge_motion([None, None, None])["has_motion"] is False
        frames = [_kps(0.0, 0.0), None, None]
        assert verify_challenge_motion(frames)["has_motion"] is False

    def test_single_valid_frame_has_no_motion(self) -> None:
        assert verify_challenge_motion([_kps(0.0, 0.0)])["has_motion"] is False

    def test_scale_invariant(self) -> None:
        small = [_kps(-15.0, 0.0, iod=50.0), _kps(15.0, 0.0, iod=50.0)]
        large = [_kps(-60.0, 0.0, iod=200.0), _kps(60.0, 0.0, iod=200.0)]
        assert verify_challenge_motion(small)["has_motion"] is True
        assert verify_challenge_motion(large)["has_motion"] is True

    def test_threshold_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        frames = [_kps(-30.0, 0.0), _kps(0.0, 0.0), _kps(30.0, 0.0)]
        monkeypatch.setenv("CHALLENGE_MOTION_MIN_DISPLACEMENT", "0.9")
        assert verify_challenge_motion(frames)["has_motion"] is False
        monkeypatch.setenv("CHALLENGE_MOTION_MIN_DISPLACEMENT", "0.05")
        assert verify_challenge_motion(frames)["has_motion"] is True
