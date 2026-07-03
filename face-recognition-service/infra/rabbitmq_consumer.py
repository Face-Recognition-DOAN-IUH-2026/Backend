import json
import logging
import threading
import pika
from infra.config import settings

logger = logging.getLogger(__name__)

_running = True

def _rabbitmq_consumer_loop():
    global _running
    rabbitmq_url = settings.rabbitmq_url or "amqp://guest:guest@rabbitmq:5672"
    exchange_name = "library.exchange"
    queue_name = "face_recognition_registration_queue"
    routing_key = "user.registered"

    logger.info("Connecting to RabbitMQ at %s...", rabbitmq_url)
    
    # Retry connection in case RabbitMQ is not ready yet
    parameters = pika.URLParameters(rabbitmq_url)
    connection = None
    
    import time
    for i in range(10):
        if not _running:
            return
        try:
            connection = pika.BlockingConnection(parameters)
            break
        except Exception as e:
            logger.warning("RabbitMQ connection failed: %s. Retrying in 5 seconds (attempt %d/10)...", e, i+1)
            time.sleep(5)
            
    if not connection:
        logger.error("Failed to connect to RabbitMQ after 10 attempts.")
        return

    try:
        channel = connection.channel()
        channel.exchange_declare(exchange=exchange_name, exchange_type='topic', durable=True)
        channel.queue_declare(queue=queue_name, durable=True)
        channel.queue_bind(exchange=exchange_name, queue=queue_name, routing_key=routing_key)
        
        logger.info("Subscribed to RabbitMQ queue %s for %s", queue_name, routing_key)

        def callback(ch, method, properties, body):
            try:
                msg = json.loads(body.decode('utf-8'))
                payload = msg.get("payload", {})
                user_id = payload.get("userId")
                email = payload.get("email")
                logger.info("[AMQP] Received user.registered event for user_id=%s, email=%s", user_id, email)
                
                ch.basic_ack(delivery_tag=method.delivery_tag)
            except Exception as e:
                logger.error("[AMQP] Error processing message: %s", e)
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

        channel.basic_consume(queue=queue_name, on_message_callback=callback)
        
        # Start consuming (blocking)
        while _running:
            try:
                connection.process_data_events(time_limit=1)
            except Exception as e:
                logger.error("RabbitMQ consume loop error: %s", e)
                break
                
    except Exception as e:
        logger.error("RabbitMQ channel/setup error: %s", e)
    finally:
        if connection and not connection.is_closed:
            connection.close()
            logger.info("RabbitMQ connection closed.")

def start_rabbitmq_consumer() -> tuple[threading.Thread, callable]:
    global _running
    _running = True
    t = threading.Thread(target=_rabbitmq_consumer_loop, daemon=True)
    t.start()
    return t, stop_rabbitmq_consumer

def stop_rabbitmq_consumer():
    global _running
    _running = False
