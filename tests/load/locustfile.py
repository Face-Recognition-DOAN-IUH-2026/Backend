"""
Locust Load & Stress Test Suite for Smart Library Microservices.

Usage (local/staging ONLY):
  locust -f Backend/tests/load/locustfile.py --host http://localhost:80
  locust -f Backend/tests/load/locustfile.py --host http://localhost:80 --headless -u 150 -r 15 -t 2m --csv reports/load_150vu
"""

import io
import os
import random
from locust import HttpUser, between, task
from PIL import Image

PATRON_EMAIL = os.getenv("LOAD_TEST_PATRON_EMAIL", "")
PATRON_PASSWORD = os.getenv("LOAD_TEST_PATRON_PASSWORD", "")
STAFF_EMAIL = os.getenv("LOAD_TEST_STAFF_EMAIL", "")
STAFF_PASSWORD = os.getenv("LOAD_TEST_STAFF_PASSWORD", "")
ENABLE_AI_CHAT = os.getenv("ENABLE_AI_CHAT", "false").lower() == "true"
GATE_FRAME_ENDPOINT = os.getenv("GATE_FRAME_ENDPOINT", "/api/face/identify")


def _make_dummy_jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (160, 160), color=(210, 190, 175))
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


DUMMY_FRAME_BYTES = _make_dummy_jpeg_bytes()

AI_QUESTIONS = [
    "Thư viện mở cửa lúc mấy giờ?",
    "Sinh viên được mượn tối đa bao nhiêu cuốn sách?",
    "Phí phạt trả sách trễ hạn là bao nhiêu?",
    "Phòng đọc yên tĩnh nằm ở tầng mấy?",
]


def _login(client, email: str, password: str) -> str | None:
    if not email or not password:
        return None
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        name="POST /api/auth/login",
    )
    if resp.status_code == 200:
        data = resp.json()
        return data.get("access_token") or data.get("token")
    return None


class PatronTrafficUser(HttpUser):
    """Simulates normal patron traffic during break peak hours (books, profile, AI RAG)."""
    weight = 7
    wait_time = between(0.5, 2.5)
    token: str | None = None

    def on_start(self):
        self.token = _login(self.client, PATRON_EMAIL, PATRON_PASSWORD)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    @task(5)
    def browse_books(self):
        skip = random.choice([0, 20, 40])
        self.client.get(
            f"/api/borrow/books?skip={skip}&limit=20",
            headers=self._headers(),
            name="GET /api/borrow/books",
        )

    @task(2)
    def view_my_permissions_and_notifications(self):
        if not self.token:
            return
        self.client.get(
            "/api/permissions/me",
            headers=self._headers(),
            name="GET /api/permissions/me",
        )
        self.client.get(
            "/api/notifications/unread-count",
            headers=self._headers(),
            name="GET /api/notifications/unread-count",
        )

    @task(2)
    def check_health(self):
        self.client.get("/health", name="GET /health")

    @task(1)
    def ask_ai_rag(self):
        if not self.token or not ENABLE_AI_CHAT:
            return
        q = random.choice(AI_QUESTIONS)
        self.client.post(
            "/api/ai/patrons/chat",
            json={"message": q},
            headers=self._headers(),
            name="POST /api/ai/patrons/chat",
            timeout=30,
        )


class GateCameraUser(HttpUser):
    """Simulates turnstile kiosk /gate cameras streaming JPEG frames."""
    weight = 2
    wait_time = between(0.2, 0.6)
    token: str | None = None

    def on_start(self):
        self.token = _login(self.client, STAFF_EMAIL, STAFF_PASSWORD)

    @task
    def send_gate_frame(self):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        files = {"image": ("frame.jpg", DUMMY_FRAME_BYTES, "image/jpeg")}
        with self.client.post(
            GATE_FRAME_ENDPOINT,
            files=files,
            headers=headers,
            name=f"POST {GATE_FRAME_ENDPOINT}",
            catch_response=True,
        ) as resp:
            # 200 (match/no-match) and 400/422 (no face in dummy image) are healthy non-crash responses
            if resp.status_code in (200, 400, 422):
                resp.success()
            elif resp.status_code >= 500:
                resp.failure(f"Server error {resp.status_code}")


class LibrarianCounterUser(HttpUser):
    """Simulates staff dashboard polling active patrons, borrows, and schedules."""
    weight = 1
    wait_time = between(1.0, 3.0)
    token: str | None = None

    def on_start(self):
        self.token = _login(self.client, STAFF_EMAIL, STAFF_PASSWORD)

    @task
    def poll_counter_dashboards(self):
        if not self.token:
            return
        headers = {"Authorization": f"Bearer {self.token}"}
        self.client.get("/api/access/stats", headers=headers, name="GET /api/access/stats")
        self.client.get("/api/borrow/active-borrowers", headers=headers, name="GET /api/borrow/active-borrowers")
        self.client.get("/api/permissions/matrix", headers=headers, name="GET /api/permissions/matrix")
