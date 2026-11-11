import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HTK Hooks — Webhook delivery control plane',
  description:
    'Nhận webhook có chữ ký HMAC, chống trùng theo idempotency key, retry backoff + jitter, DLQ, replay, xoay secret và debug từng lần giao.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
