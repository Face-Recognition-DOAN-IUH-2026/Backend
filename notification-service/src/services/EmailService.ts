import nodemailer from 'nodemailer';
import { config } from '../config';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }

  async sendPasswordResetCode(toEmail: string, code: string): Promise<void> {
    console.log(`[EmailService] Sending password reset to: ${toEmail}`);
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: '[ThuVienIUH] Ma reset mat khau',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #333; margin: 0 0 16px; font-size: 20px;">Ma reset mat khau cua ban</h2>
            <div style="background: #f5f5f5; padding: 24px; text-align: center; border-radius: 8px; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${code}</span>
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              Ma reset cua ban co <strong>6 chu so</strong> va co hieu luc trong <strong>15 phut</strong>.
            </p>
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #856404; font-size: 13px; margin: 0;">
                <strong>Luu y:</strong> Neu ban khong yeu cau dat lai mat khau, vui long bo qua email nay va dam bao tai khoan cua ban van an toan.
              </p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email nay duoc gui tu He thong Thu Vien IUH. Vui long khong tra loi email nay.
            </p>
          </div>
        </div>
      `,
      text: `
THU VIEN IUH - MA RESET MAT KHAU

Ma reset cua ban la: ${code}

Ma co hieu luc trong 15 phut.

Neu ban khong yeu cau dat lai mat khau, vui long bo qua email nay.
      `,
    };

    const info = await this.transporter.sendMail(mailOptions);
    console.log(`[EmailService] Email sent successfully: ${info.messageId}`);
  }

  async sendOverdueEmail(toEmail: string, bookTitle: string, daysOverdue: number): Promise<void> {
    console.log(`[EmailService] Sending overdue email to: ${toEmail}, book: ${bookTitle}, days: ${daysOverdue}`);
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: `[ThuVienIUH] Sach qua han tra - "${bookTitle}"`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #e53935 0%, #c62828 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH - Canh bao qua han</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #e53935; margin: 0 0 16px; font-size: 20px;">Sach cua ban da qua han!</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Cuon sach <strong>"${bookTitle}"</strong> da qua han tra <strong>${daysOverdue} ngay</strong>.
            </p>
            <p style="color: #666; font-size: 14px; line-height: 1.6;">
              Vui long tra sach ngay de tranh phi phat. Moi ngay qua han, ban se bi phat them phi phat theo quy dinh.
            </p>
            <div style="background: #ffebee; border: 1px solid #e53935; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #c62828; font-size: 13px; margin: 0;">
                <strong>Luu y:</strong> Phi phat duoc tinh tu ngay het han tra sach. Vui long tra sach som nhat co the.
              </p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email nay duoc gui tu He thong Thu Vien IUH. Vui long khong tra loi email nay.
            </p>
          </div>
        </div>
      `,
    };
    await this.transporter.sendMail(mailOptions);
  }

  async sendFineEmail(toEmail: string, bookTitle: string, fineAmount: number, daysOverdue: number): Promise<void> {
    console.log(`[EmailService] Sending fine email to: ${toEmail}, book: ${bookTitle}, fine: ${fineAmount}`);
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: `[ThuVienIUH] Phat phat tra tre - "${bookTitle}"`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH - Thong bao phat</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #f57c00; margin: 0 0 16px; font-size: 20px;">Ban co phat phat moi!</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Cuon sach <strong>"${bookTitle}"</strong> da duoc tra tre <strong>${daysOverdue} ngay</strong>.
            </p>
            <div style="background: #fff3e0; border: 1px solid #ff9800; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #666; font-size: 14px; margin: 0 0 8px;">Tong tien phat</p>
              <p style="color: #f57c00; font-size: 32px; font-weight: bold; margin: 0;">${fineAmount.toLocaleString('vi-VN')}d</p>
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.6;">
              Vui long thanh toan phi phat tai quay thu vien hoac lien he nhan vien de duoc huong dan.
            </p>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email nay duoc gui tu He thong Thu Vien IUH. Vui long khong tra loi email nay.
            </p>
          </div>
        </div>
      `,
    };
    await this.transporter.sendMail(mailOptions);
  }

  async sendMembershipExpiryEmail(toEmail: string, expiryDate: Date): Promise<void> {
    console.log(`[EmailService] Sending membership expiry email to: ${toEmail}, expiry: ${expiryDate}`);
    const formattedDate = expiryDate.toLocaleDateString('vi-VN');
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: '[ThuVienIUH] Thẻ thành viên sắp hết hạn',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1976d2 0%, #0d47a1 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH - Nap tien the thanh vien</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #1976d2; margin: 0 0 16px; font-size: 20px;">The thanh vien sap het han!</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              The thanh vien cua ban se het han vao ngay <strong>${formattedDate}</strong>.
            </p>
            <p style="color: #666; font-size: 14px; line-height: 1.6;">
              Vui long den thu vien de nap tien gia han the. Sau khi het han, ban se khong the muon sach cho den khi nap tien gia han.
            </p>
            <div style="background: #e3f2fd; border: 1px solid #1976d2; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #0d47a1; font-size: 13px; margin: 0;">
                <strong>Luu y:</strong> Vui long gia han truoc ngay het han de khong bi gian doan dich vu.
              </p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email nay duoc gui tu He thong Thu Vien IUH. Vui long khong tra loi email nay.
            </p>
          </div>
        </div>
      `,
    };
    await this.transporter.sendMail(mailOptions);
  }
}