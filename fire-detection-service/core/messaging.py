import json
import logging
from typing import Dict, Any, Optional

try:
    import pika
    PIKA_AVAILABLE = True
except ImportError:
    pika = None
    PIKA_AVAILABLE = False

from core.config import settings

logger = logging.getLogger(__name__)


class HazardMessagePublisher:
    """
    Publisher gửi thông điệp cảnh báo nguy cơ cháy nổ lên RabbitMQ.
    """
    def __init__(self):
        self.connection = None
        self.channel = None

    def connect(self):
        if not PIKA_AVAILABLE:
            logger.warning("[RabbitMQ] Thư viện 'pika' chưa được cài đặt. Chạy ở chế độ Standalone/Log.")
            return

        try:
            credentials = pika.PlainCredentials(settings.RABBITMQ_USER, settings.RABBITMQ_PASS)
            parameters = pika.ConnectionParameters(
                host=settings.RABBITMQ_HOST,
                port=settings.RABBITMQ_PORT,
                credentials=credentials,
                connection_attempts=1,
                retry_delay=1,
                heartbeat=600
            )
            self.connection = pika.BlockingConnection(parameters)
            self.channel = self.connection.channel()

            # Khai báo Topic Exchange cho các sự kiện nguy hại (Hazard Events)
            self.channel.exchange_declare(
                exchange=settings.HAZARD_EXCHANGE,
                exchange_type="topic",
                durable=True
            )
            logger.info(f"[RabbitMQ] Kết nối thành công tới exchange '{settings.HAZARD_EXCHANGE}'")
        except Exception as e:
            logger.warning(f"[RabbitMQ] Không thể kết nối tới RabbitMQ ({e}). Cảnh báo sẽ chỉ log local.")
            self.connection = None
            self.channel = None

    def publish_fire_hazard(self, payload: Dict[str, Any]):
        """
        Gửi sự kiện phát hiện lửa/khói tới các microservices khác.
        """
        if self.channel is None or self.channel.is_closed:
            self.connect()

        if self.channel and not self.channel.is_closed:
            try:
                body = json.dumps(payload, ensure_ascii=False)
                self.channel.basic_publish(
                    exchange=settings.HAZARD_EXCHANGE,
                    routing_key=settings.FIRE_ROUTING_KEY,
                    body=body.encode("utf-8"),
                    properties=pika.BasicProperties(
                        delivery_mode=2,  # Persistent message
                        content_type="application/json"
                    )
                )
                logger.info(f"[RabbitMQ] Đã gửi thông báo cháy khẩn cấp: {payload.get('camera_id')}")
            except Exception as e:
                logger.error(f"[RabbitMQ] Lỗi khi publish message: {e}")
        else:
            logger.warning(f"[RabbitMQ - OFFLINE] Cảnh báo cháy: {payload}")

    def close(self):
        if self.connection and not self.connection.is_closed:
            self.connection.close()


hazard_publisher = HazardMessagePublisher()
