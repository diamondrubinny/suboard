import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** SMTP mailer (nodemailer). Returns null when SMTP is not configured → e-mail is disabled. */
export function createMailer(config: AppConfig): Mailer | null {
  if (!config.smtp) return null;
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: !config.smtp.secure, // STARTTLS mandatory when not using implicit TLS
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password ?? '' } : undefined,
    tls: { minVersion: 'TLSv1.2' },
  });
  return {
    async send(msg) {
      await transport.sendMail({ from: config.mailFrom, ...msg });
    },
  };
}

/** In-memory mailer for tests. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
