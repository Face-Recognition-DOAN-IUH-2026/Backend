import { amqpClient } from '../clients/AmqpClient';
import { notificationService } from '../services/NotificationService';
import { notificationHub } from '../realtime/NotificationHub';
import { EmailService } from '../services/EmailService';

const emailService = new EmailService();

export async function startAmqpSubscriber(): Promise<void> {
  try {
    // Verify SMTP at startup — log warning instead of blocking
    try {
      await emailService.verifyConnection();
    } catch (err: any) {
      console.warn(`[AMQP] SMTP verification failed (email notifications disabled): ${err.message}`);
    }

    await amqpClient.connect();

    await amqpClient.consume(
      'notification_service_queue',
      ['book.borrowed', 'book.returned', 'notification.send', 'config.updated'],
      async (envelope) => {
        const { eventType, payload } = envelope;
        console.log(`[AMQP] Processing event ${eventType} on notification-service`);

        try {
          if (eventType === 'book.borrowed') {
            const { patronId, title, dueAt } = payload;
            if (!patronId || !title) return;

            const dateStr = dueAt ? new Date(dueAt).toLocaleDateString('vi-VN') : '';
            const body = `Bạn đã mượn thành công cuốn sách "${title}". Vui lòng trả trước ngày ${dateStr}.`;

            const notification = await notificationService.create({
              userId: patronId,
              type: 'borrow',
              title: 'Mượn sách thành công',
              body,
              data: payload,
            });
            await notificationHub.publish(patronId, notification);
            console.log(`[AMQP] Created borrow notification for user ${patronId}`);
          }
          
          else if (eventType === 'book.returned') {
            const { patronId, title } = payload;
            if (!patronId || !title) return;

            const body = `Bạn đã hoàn thành trả cuốn sách "${title}". Cảm ơn bạn!`;

            const notification = await notificationService.create({
              userId: patronId,
              type: 'return',
              title: 'Trả sách thành công',
              body,
              data: payload,
            });
            await notificationHub.publish(patronId, notification);
            console.log(`[AMQP] Created return notification for user ${patronId}`);
          }
          
          else if (eventType === 'notification.send') {
            const { emailType, userId, type: notifType, title, body, data, toEmail, code, bookTitle, daysOverdue, fineAmount, expiryDate } = payload;

            if (emailType === 'push') {
              if (!userId || !notifType || !title || !body) {
                console.warn('[AMQP] Invalid push notification payload:', payload);
                return;
              }
              const notification = await notificationService.create({
                userId,
                type: notifType,
                title,
                body,
                data: data || {},
              });
              await notificationHub.publish(userId, notification);
              console.log(`[AMQP] Created push notification for user ${userId}: ${title}`);
              return;
            }

            if (!toEmail) {
              console.warn('[AMQP] Invalid notification.send payload (missing toEmail):', payload);
              return;
            }

            console.log(`[AMQP] Sending email of type ${emailType} to ${toEmail}`);

            if (emailType === 'password_reset') {
              await emailService.sendPasswordResetCode(toEmail, code);
            } else if (emailType === 'email_verification') {
              await emailService.sendEmailVerificationCode(toEmail, code);
            } else if (emailType === 'overdue') {
              await emailService.sendOverdueEmail(toEmail, bookTitle, daysOverdue);
            } else if (emailType === 'fine') {
              await emailService.sendFineEmail(toEmail, bookTitle, fineAmount, daysOverdue);
            } else if (emailType === 'membership_expiry') {
              await emailService.sendMembershipExpiryEmail(toEmail, new Date(expiryDate));
            } else if (emailType === 'email_change') {
              await emailService.sendEmailChangeCode(toEmail, code);
            } else {
              console.warn(`[AMQP] Unknown email type: ${emailType}`);
            }
          } else if (eventType === 'config.updated') {
            const { category, values } = payload;
            if (category === 'smtp' && values) {
              console.log('[AMQP] Received SMTP config update, dynamically updating transporter...');
              emailService.updateConfig(values);
            }
          }
        } catch (err: any) {
          console.error(`[AMQP] Processing error on ${eventType}: ${err.message}`);
          // Re-throw ALL errors so AmqpClient's retry/DLQ mechanism handles them.
          // Previously SMTP errors were swallowed here, meaning failed emails could
          // never be replayed after SMTP recovered. Now they go through 3 retries
          // then land in the DLQ (notification_service_queue.dlq) for manual replay.
          throw err;
        }
      }
    );

    console.log('[AMQP] Notification-service subscriber initialized');
  } catch (err: any) {
    console.error('[AMQP] Failed to start notification-service subscribers:', err.message);
  }
}
