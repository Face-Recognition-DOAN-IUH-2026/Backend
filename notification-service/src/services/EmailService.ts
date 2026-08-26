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
      connectionTimeout: 5000,
      greetingTimeout: 5000,
    });
  }

  async verifyConnection(): Promise<void> {
    const ok = await this.transporter.verify();
    if (!ok) throw new Error('SMTP connection verification failed');
    console.log('[EmailService] SMTP connection verified');
  }

  async sendPasswordResetCode(toEmail: string, code: string): Promise<void> {
    console.log(`[EmailService] Sending password reset to: ${toEmail}`);
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: '[ThuVienIUH] Mã khôi phục mật khẩu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #333; margin: 0 0 16px; font-size: 20px;">Mã khôi phục mật khẩu của bạn</h2>
            <div style="background: #f5f5f5; padding: 24px; text-align: center; border-radius: 8px; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${code}</span>
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              Ma reset cua ban co <strong>6 chu so</strong> va co hieu luc trong <strong>15 phut</strong>.
            </p>
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #856404; font-size: 13px; margin: 0;">
                <strong>Luu y:</strong> Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.va dam bao tai khoan cua ban van an toan.
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

Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
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
      subject: `[ThuVienIUH] Nhắc trả sách - "${bookTitle}"`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1976d2 0%, #0d47a1 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thư Viện IUH - Nhắc trả sách</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #1976d2; margin: 0 0 16px; font-size: 20px;">Sách của bạn đã quá hạn trả</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Chào bạn,<br/><br/>
              Cuốn sách <strong>"${bookTitle}"</strong> đã quá hạn trả <strong>${daysOverdue} ngày</strong>.
            </p>
            <p style="color: #666; font-size: 14px; line-height: 1.6;">
              Vui lòng trả sách sớm nhất có thể để tránh phí phát thêm. Bạn có thể trả sách tại quầy thư viện hoặc qua máy trả sách tự động.
            </p>
            <div style="background: #e3f2fd; border: 1px solid #1976d2; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #0d47a1; font-size: 13px; margin: 0;">
                <strong>Lưu ý:</strong> Nếu bạn cần hỗ trợ, vui lòng liên hệ thư viện qua email hoặc số điện thoại trên thẻ thành viên.
              </p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email này được gửi từ Hệ Thống Thư Viện IUH. Vui lòng không trả lời email này.
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
      subject: `[ThuVienIUH] Thông tin phí quá hạn - "${bookTitle}"`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thư Viện IUH - Hướng dẫn xử lý phí quá hạn</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #f57c00; margin: 0 0 16px; font-size: 20px;">Tài khoản của bạn có phí quá hạn</h2>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Chào bạn,<br/><br/>
              Cuốn sách <strong>"${bookTitle}"</strong> đã quá hạn trả <strong>${daysOverdue} ngày</strong>.
            </p>
            <div style="background: #fff3e0; border: 1px solid #ff9800; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #666; font-size: 14px; margin: 0 0 8px;">Khoản phí quá hạn hiện tại</p>
              <p style="color: #f57c00; font-size: 32px; font-weight: bold; margin: 0;">${fineAmount.toLocaleString('vi-VN')}đ</p>
            </div>
            <p style="color: #333; font-size: 15px; line-height: 1.6; font-weight: 600;">
              Đừng lo bạn! Chỉ cần thanh toán tại quầy thư viện để mở khóa thẻ và tiếp tục sử dụng thư viện.
            </p>
            <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #333; font-size: 14px; margin: 0 0 8px;"><strong>Hướng dẫn thanh toán:</strong></p>
              <p style="color: #666; font-size: 13px; line-height: 1.8; margin: 0;">
                1. Đến quầy thư viện (Tầng 1, Khu A)<br/>
                2. Quét mã QR tại quầy hoặc trình thanh toán cho nhân viên<br/>
                3. Sau khi thanh toán, thẻ của bạn sẽ được mở khóa tự động
              </p>
            </div>
            <div style="background: #e3f2fd; border: 1px solid #1976d2; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #0d47a1; font-size: 13px; margin: 0;">
                <strong>Lưu ý:</strong> Sau khi thanh toán, vui lòng báo nhân viên để được mở khóa thẻ. Nếu bạn cần hỗ trợ, vui lòng liên hệ thư viện qua email hoặc số điện thoại trên thẻ thành viên.
              </p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email này được gửi từ Hệ Thống Thư Viện IUH. Vui lòng không trả lời email này.
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
              Vui lòng đến thư viện để nạp tiền gia hạn thẻ. Sau khi hết hạn, bạn sẽ không thể mượn sách cho đến khi nạp tiền.
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

  async sendEmailVerificationCode(toEmail: string, code: string): Promise<void> {
    console.log(`[EmailService] Sending email verification OTP to: ${toEmail}`);
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: '[ThuVienIUH] Xac thuc email cua ban',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #333; margin: 0 0 16px; font-size: 20px;">Xac thuc email</h2>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              Vui long su dung ma OTP duoi day de xac thuc email:
            </p>
            <div style="background: #f5f5f5; padding: 24px; text-align: center; border-radius: 8px; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4facfe;">${code}</span>
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              Ma xac thuc cua ban co hieu luc trong <strong>15 phut</strong>.
            </p>
          </div>
        </div>
      `,
    };
    await this.transporter.sendMail(mailOptions);
  }

  async sendEmailChangeCode(toEmail: string, code: string): Promise<void> {
    console.log(`[EmailService] Sending email change OTP to: ${toEmail}`);
    const mailOptions = {
      from: config.smtp.from,
      to: toEmail,
      subject: '[ThuVienIUH] Xac thuc doi dia chi email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Thu Vien IUH</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">
            <h2 style="color: #333; margin: 0 0 16px; font-size: 20px;">Xac thuc thay doi email</h2>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              Ban dang yeu cau thay doi dia chi email. Vui long su dung ma OTP duoi day de xac nhan dia chi email moi:
            </p>
            <div style="background: #f5f5f5; padding: 24px; text-align: center; border-radius: 8px; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4facfe;">${code}</span>
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              Ma xac thuc cua ban co hieu luc trong <strong>15 phut</strong>.
            </p>
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #856404; font-size: 13px; margin: 0;">
                <strong>Luu y:</strong> Neu ban khong thuc hien yeu cau nay, vui long bo qua email va kiem tra lai bao mat tai khoan.
              </p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin: 24px 0 0;">
              Email nay duoc gui tu He thong Thu Vien IUH. Vui long khong tra loi email nay.
            </p>
          </div>
        </div>
      `,
      text: `
THU VIEN IUH - XAC THUC DOI EMAIL

Ma xac thuc cua ban la: ${code}

Ma co hieu luc trong 15 phut.

Neu ban khong thuc hien yeu cau nay, vui long bo qua email.
      `,
    };
    await this.transporter.sendMail(mailOptions);
  }
}