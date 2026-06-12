from __future__ import annotations

import concurrent.futures
import logging
import threading
import time
from datetime import datetime
from typing import Callable, Dict, Optional

import cv2
import numpy as np

from infra.config import settings

logger = logging.getLogger(__name__)

MAX_RETRY_DELAY = 30
INITIAL_RETRY_DELAY = 1


class CameraStatus:
    def __init__(self, camera_id: str, url: str):
        self.camera_id = camera_id
        self.url = url
        self.running = False
        self.connected = False
        self.frames_processed = 0
        self.last_frame_time: Optional[str] = None
        self.last_error: Optional[str] = None
        self.retry_count = 0
        self.next_retry_in: Optional[float] = None


class CameraStream:
    def __init__(self, camera_id: str, url: str, on_frame: Callable[[str, np.ndarray], None]):
        self.camera_id = camera_id
        self.url = url
        self.on_frame = on_frame
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_process_time: float = 0
        self._cooldown: float = max(settings.frame_process_interval, 0.5)
        self._lock = threading.Lock()
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.status = CameraStatus(camera_id, url)

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info("Camera %s started", self.camera_id)

    def stop(self):
        self._running = False
        self._executor.shutdown(wait=False)
        if self._thread:
            self._thread.join(timeout=5)
        with self._lock:
            self.status.running = False
            self.status.connected = False
        logger.info("Camera %s stopped", self.camera_id)

    def _run(self):
        retry_delay = INITIAL_RETRY_DELAY
        cap = None

        while self._running:
            if cap is None:
                cap = self._open_camera_or_wait()

            if cap is None:
                continue

            ret, frame = cap.read()
            if not ret:
                logger.warning("Camera %s lost frame, reconnecting...", self.camera_id)
                with self._lock:
                    self.status.connected = False
                    self.status.last_error = "Frame read failed"
                    self.status.retry_count += 1
                    self.status.next_retry_in = retry_delay
                cap.release()
                cap = None
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, MAX_RETRY_DELAY)
                continue

            retry_delay = INITIAL_RETRY_DELAY

            now = time.time()
            if now - self._last_process_time >= self._cooldown:
                self._last_process_time = now
                try:
                    # Offload callback to thread pool so frame read is not blocked
                    self._executor.submit(self._run_callback, self.camera_id, frame.copy())
                except Exception as e:
                    logger.error("Camera %s callback error: %s", self.camera_id, e)

        if cap:
            cap.release()
        with self._lock:
            self.status.running = False
            self.status.connected = False

    def _run_callback(self, camera_id: str, frame: np.ndarray):
        try:
            self.on_frame(camera_id, frame)
            with self._lock:
                self.status.connected = True
                self.status.frames_processed += 1
                self.status.last_frame_time = datetime.now().isoformat(timespec="seconds")
                self.status.last_error = None
                self.status.retry_count = 0
                self.status.next_retry_in = None
        except Exception as e:
            logger.error("Camera %s callback error: %s", camera_id, e)
            with self._lock:
                self.status.last_error = str(e)

    def _open_camera_or_wait(self) -> Optional[cv2.VideoCapture]:
        cap = cv2.VideoCapture(self.url)
        if cap.isOpened():
            # Set properties ONCE on open (not on every frame — causes lag)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_FPS, 15)
            with self._lock:
                self.status.running = True
                self.status.connected = True
                self.status.retry_count = 0
                self.status.next_retry_in = None
                self.status.last_error = None
            return cap
        cap.release()
        with self._lock:
            self.status.connected = False
            self.status.last_error = "Failed to open camera stream"
            self.status.retry_count = (self.status.retry_count or 0) + 1
            delay = min(
                INITIAL_RETRY_DELAY * (2 ** (self.status.retry_count - 1)),
                MAX_RETRY_DELAY,
            )
            self.status.next_retry_in = delay
        logger.warning(
            "Camera %s not reachable, retrying in %.1fs (attempt %d)",
            self.camera_id, delay, self.status.retry_count,
        )
        time.sleep(delay)
        return None

    def reconnect(self) -> bool:
        logger.info("Camera %s manual reconnect triggered", self.camera_id)
        return self._running


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

    def get_status(self, camera_id: str) -> Optional[dict]:
        cam = self._cameras.get(camera_id)
        if not cam:
            return None
        with cam._lock:
            s = cam.status
            return {
                "camera_id": s.camera_id,
                "url": s.url,
                "running": s.running,
                "connected": s.connected,
                "frames_processed": s.frames_processed,
                "last_frame_time": s.last_frame_time,
                "last_error": s.last_error,
                "retry_count": s.retry_count,
                "next_retry_in": s.next_retry_in,
            }

    def get_all_status(self) -> list[dict]:
        return [self.get_status(cid) for cid in self._cameras if self.get_status(cid)]

    def reconnect(self, camera_id: str) -> bool:
        cam = self._cameras.get(camera_id)
        if not cam:
            return False
        return cam.reconnect()


stream_service = StreamService()
