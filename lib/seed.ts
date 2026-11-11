import type { PGlite } from '@electric-sql/pglite';
import { hashPassword } from './password';

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export async function seedDemo(db: PGlite): Promise<void> {
  const existing = await db.query<{ count: number }>('select count(*)::int as count from users');
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  const passwordHash = await hashPassword('Demo12345!');
  await db.query(
    `insert into users (id, email, name, password_hash) values
     ('u-demo', 'demo@htk.dev', 'Demo Owner', $1)`,
    [passwordHash],
  );

  await db.query(
    `insert into endpoints
       (id, user_id, slug, name, target_url, mode, secret, previous_secret, secret_rotated_at,
        rate_limit_per_min, max_attempts, status, created_at, updated_at)
     values
       ('ep_billing', 'u-demo', 'billing-alerts', 'Billing alerts', 'https://hooks.sandbox.local/billing',
        'sandbox', 'whsec_demo_billing_5c1f9a7e2b8d4f60', null, null, 120, 5, 'active', $1, $1),
       ('ep_crm', 'u-demo', 'crm-contact-sync', 'CRM contact sync', 'https://crm.sandbox.local/hooks',
        'sandbox', 'whsec_demo_crm_91c3de47a8f02b15', 'whsec_demo_crm_old_77ab21ce90f4d356', $2, 60, 5, 'active', $1, $1),
       ('ep_ocr', 'u-demo', 'ocr-pipeline', 'OCR pipeline', 'https://ocr.sandbox.local/callback',
        'sandbox', 'whsec_demo_ocr_3d7f0b62e9a1c584', null, null, 30, 5, 'paused', $1, $1)`,
    [iso(14 * 24 * 60), iso(2 * 60)],
  );

  type EventSeed = [
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    number | null,
    string | null,
    string,
    string | null,
  ];
  const events: EventSeed[] = [
    [
      'evt_billing_paid',
      'ep_billing',
      'demo-billing-1001',
      'invoice.paid',
      JSON.stringify({ id: 'inv_2041', amount: 149000, currency: 'VND', customer: 'An Phát' }),
      'delivered',
      1,
      iso(34),
      200,
      null,
      iso(35),
      iso(34),
    ],
    [
      'evt_billing_failed',
      'ep_billing',
      'demo-billing-1002',
      'invoice.payment_failed',
      JSON.stringify({ id: 'inv_2042', amount: 299000, reason: 'card_declined' }),
      'delivered',
      3,
      iso(110),
      200,
      null,
      iso(120),
      iso(110),
    ],
    [
      'evt_billing_canceled',
      'ep_billing',
      'demo-billing-1003',
      'subscription.canceled',
      JSON.stringify({ id: 'sub_77', plan: 'pro', at_period_end: true }),
      'dlq',
      5,
      iso(1500),
      500,
      'Sandbox mô phỏng upstream lỗi 500',
      iso(1560),
      null,
    ],
    [
      'evt_billing_updated',
      'ep_billing',
      'demo-billing-1004',
      'customer.updated',
      JSON.stringify({ customer: 'Minh Châu', field: 'billing_email' }),
      'queued',
      2,
      iso(2),
      500,
      'Sandbox mô phỏng upstream lỗi 500',
      iso(20),
      null,
    ],
    [
      'evt_crm_created',
      'ep_crm',
      'demo-crm-2001',
      'contact.created',
      JSON.stringify({ contact: 'Lê Văn Nam', source: 'landing-page' }),
      'delivered',
      1,
      iso(295),
      200,
      null,
      iso(300),
      iso(295),
    ],
    [
      'evt_crm_updated',
      'ep_crm',
      'demo-crm-2002',
      'contact.updated',
      JSON.stringify({ contact: 'Trần Thu Hà', field: 'phone' }),
      'dlq',
      5,
      iso(4300),
      500,
      'Sandbox mô phỏng upstream lỗi 500',
      iso(4320),
      null,
    ],
    [
      'evt_crm_deal',
      'ep_crm',
      'demo-crm-2003',
      'deal.won',
      JSON.stringify({ deal: 'DL-88', value: 48000000 }),
      'queued',
      0,
      iso(1),
      null,
      null,
      iso(3),
      null,
    ],
    [
      'evt_ocr_upload',
      'ep_ocr',
      'demo-ocr-3001',
      'document.uploaded',
      JSON.stringify({ doc: 'hopdong-2026.pdf', pages: 12 }),
      'queued',
      0,
      iso(360),
      null,
      null,
      iso(360),
      null,
    ],
  ];

  for (const event of events) {
    await db.query(
      `insert into events
         (id, endpoint_id, idempotency_key, event_type, payload, status, attempts,
          next_attempt_at, last_status_code, last_error, received_at, delivered_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      event,
    );
  }

  type DeliverySeed = [string, string, number, string, number, string, number];
  const deliveries: DeliverySeed[] = [
    ['dlv_b1_1', 'evt_billing_paid', 1, 'success', 200, '{"ok":true,"attempt":1}', 18],
    ['dlv_b2_1', 'evt_billing_failed', 1, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 15],
    ['dlv_b2_2', 'evt_billing_failed', 2, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 19],
    ['dlv_b2_3', 'evt_billing_failed', 3, 'success', 200, '{"ok":true,"attempt":3}', 22],
    ['dlv_b3_1', 'evt_billing_canceled', 1, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 14],
    ['dlv_b3_2', 'evt_billing_canceled', 2, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 16],
    ['dlv_b3_3', 'evt_billing_canceled', 3, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 18],
    ['dlv_b3_4', 'evt_billing_canceled', 4, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 20],
    ['dlv_b3_5', 'evt_billing_canceled', 5, 'fatal', 500, '{"ok":false,"error":"upstream 500"}', 17],
    ['dlv_b4_1', 'evt_billing_updated', 1, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 13],
    ['dlv_b4_2', 'evt_billing_updated', 2, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 15],
    ['dlv_c1_1', 'evt_crm_created', 1, 'success', 200, '{"ok":true,"attempt":1}', 21],
    ['dlv_c2_1', 'evt_crm_updated', 1, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 12],
    ['dlv_c2_2', 'evt_crm_updated', 2, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 14],
    ['dlv_c2_3', 'evt_crm_updated', 3, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 16],
    ['dlv_c2_4', 'evt_crm_updated', 4, 'retry', 500, '{"ok":false,"error":"upstream 500"}', 18],
    ['dlv_c2_5', 'evt_crm_updated', 5, 'fatal', 500, '{"ok":false,"error":"upstream 500"}', 20],
  ];
  for (const [id, eventId, attemptNo, outcome, code, body, duration] of deliveries) {
    await db.query(
      `insert into deliveries (id, event_id, attempt_no, outcome, status_code, response_body, duration_ms, started_at)
       values ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' minutes')::interval)`,
      [id, eventId, attemptNo, outcome, code, body, duration, attemptNo * 2],
    );
  }

  await db.query(
    `insert into audit_logs (id, actor_id, action, target, detail, created_at) values
     ('aud_1', 'u-demo', 'endpoint.created', 'ep_billing', 'Billing alerts (sandbox)', $1),
     ('aud_2', 'u-demo', 'endpoint.created', 'ep_crm', 'CRM contact sync (sandbox)', $1),
     ('aud_3', 'u-demo', 'endpoint.created', 'ep_ocr', 'OCR pipeline (sandbox)', $1),
     ('aud_4', 'u-demo', 'endpoint.secret_rotated', 'ep_crm', 'Secret cũ còn hiệu lực 24 giờ', $2),
     ('aud_5', null, 'event.dead_lettered', 'evt_billing_canceled', 'subscription.canceled sau 5 lần thử', $3)`,
    [iso(14 * 24 * 60), iso(2 * 60), iso(1500)],
  );
}
