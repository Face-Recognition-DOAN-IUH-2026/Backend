from __future__ import annotations

import base64
import logging
import threading
import time
from typing import Callable, Dict, Optional

import cv2
import numpy as np

from infra.config import settings

logger = logging.getLogger(__name__)


class CameraStream:
    def __init__(self, camera_id: str, url: str, on_frame: Callable[[str, np.ndarray], None]):
        self.camera_id = camera_id
        self.url = url
        self.on_frame = on_frame
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_process_time: float = 0
        self._cooldown: float = settings.access_cooldown_seconds

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info("Camera %s started", self.camera_id)

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Camera %s stopped", self.camera_id)

    def _run(self):
        cap = cv2.VideoCapture(self.url)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, 15)

        while self._running:
            ret, frame = cap.read()
            if not ret:
                logger.warning("Camera %s lost frame, reconnecting...", self.camera_id)
                time.sleep(1)
                cap.release()
                cap = cv2.VideoCapture(self.url)
                continue

            now = time.time()
            if now - self._last_process_time >= self._cooldown:
                self._last_process_time = now
                try:
                    self.on_frame(self.camera_id, frame)
                except Exception as e:
                    logger.error("Camera %s callback error: %s", self.camera_id, e)

        cap.release()


class StreamService:
    def __init__(self):
        self._cameras: Dict[str, CameraStream] = {}
        self._callbacks: Dict[str, Callable] = {}

    def register_camera(self, camera_id: str, url: str):
        def on_frame(cid: str, frame: np.ndarray):
            cb = self._callbacks.get(cid)
            if cb:
                cb(cid, frame)

        cam = CameraStream(camera_id, url, on_frame)
        self._cameras[camera_id] = cam

    def set_callback(self, camera_id: str, callback: Callable[[str, np.ndarray], None]):
        self._callbacks[camera_id] = callback

    def start_all(self):
        for cam in self._cameras.values():
            cam.start()

    def stop_all(self):
        for cam in self._cameras.values():
            cam.stop()

    def is_running(self, camera_id: str) -> bool:
        cam = self._cameras.get(camera_id)
        return cam is not None and cam._running


stream_service = StreamService()
