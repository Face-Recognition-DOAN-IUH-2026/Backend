import { amqpClient } from '../clients/AmqpClient';

export async function publishEvent(type: string, payload: Record<string, any>) {
  try {
    await amqpClient.publish(type, payload);
  } catch (error: any) {
    console.error('Failed to publish event to RabbitMQ:', type, error.message);
  }
}
