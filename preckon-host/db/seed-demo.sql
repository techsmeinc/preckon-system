-- ============================================================================
-- Preckon Host — OPTIONAL demo data
-- ----------------------------------------------------------------------------
-- Sample customer/business data for exploring the console (fake tenants,
-- subscriptions, invoices, notifications, a failed job, example coupons and a
-- sample email domain). NOT loaded by default. Run only if you want demo rows:
--     mysql ... < db/seed-demo.sql        (or import in phpMyAdmin)
-- Requires schema.sql + seed.sql first (it references editions/features by key).
-- ============================================================================

USE `preckon_host`;

-- ── Example coupons ─────────────────────────────────────────────────────────
INSERT INTO coupon (id, code, name, discount_type, percent_off, duration, duration_months, max_redemptions) VALUES
 (UUID(),'LAUNCH20','Launch 20% (3 mo)','percent',20.00,'repeating',3,100)
ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO coupon (id, code, name, discount_type, amount_off_minor, currency_code, duration) VALUES
 (UUID(),'WELCOME50','$50 off first invoice','fixed',5000,'USD','once')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ── Sample verified email domain ────────────────────────────────────────────
INSERT INTO email_domain (id, domain, status, dns_records, verified_at) VALUES
 (UUID(),'preckon.com','verified',
   JSON_ARRAY(
     JSON_OBJECT('type','TXT','host','@','value','v=spf1 include:spf.postmarkapp.com ~all'),
     JSON_OBJECT('type','CNAME','host','pm._domainkey','value','pm.mtasv.net')
   ), NOW())
ON DUPLICATE KEY UPDATE status = VALUES(status);

-- ── Sample tenants (host_user FKs left NULL) ────────────────────────────────
INSERT INTO tenant (id, slug, name, legal_name, status, region, current_edition_id, trial_ends_at, primary_contact_email) VALUES
 ('10000000-0000-4000-8000-000000000001','cedar-stone','Cedar & Stone Builders','Cedar & Stone Construction Ltd','active','ca-central',(SELECT id FROM edition WHERE `key`='professional'),NULL,'admin@cedarstone.example'),
 ('10000000-0000-4000-8000-000000000002','northface-qs','Northface QS','Northface Quantity Surveying LLP','active','uk-south',(SELECT id FROM edition WHERE `key`='enterprise'),NULL,'ops@northfaceqs.example'),
 ('10000000-0000-4000-8000-000000000003','harbor-civil','Harbor Civil','Harbor Civil Engineering Inc','trial','us-east',(SELECT id FROM edition WHERE `key`='starter'),DATE_ADD(NOW(), INTERVAL 9 DAY),'pm@harborcivil.example'),
 ('10000000-0000-4000-8000-000000000004','summit-mep','Summit MEP','Summit Mechanical & Electrical','active','us-west',(SELECT id FROM edition WHERE `key`='professional'),NULL,'billing@summitmep.example'),
 ('10000000-0000-4000-8000-000000000005','delta-infra','Delta Infrastructure','Delta Infra Group FZE','suspended','ae-dubai',(SELECT id FROM edition WHERE `key`='professional'),NULL,'admin@deltainfra.example')
ON DUPLICATE KEY UPDATE name = VALUES(name);
UPDATE tenant SET suspended_at=NOW(), suspended_reason='Payment dispute — pending resolution' WHERE slug='delta-infra';

INSERT INTO tenant_theme (tenant_id, brand_color, brand_color_dark, accent_color, theme_tokens) VALUES
 ('10000000-0000-4000-8000-000000000001','#1F6F54','#2FA07C','#15C2A8', JSON_OBJECT('font_family','Inter')),
 ('10000000-0000-4000-8000-000000000002','#243B6B','#4C6FB5','#F5A524', JSON_OBJECT('font_family','Inter'))
ON DUPLICATE KEY UPDATE accent_color = VALUES(accent_color);

-- ── Sample subscriptions ────────────────────────────────────────────────────
INSERT INTO subscription (id, tenant_id, edition_id, currency_code, `interval`, status, seats, current_period_start, current_period_end) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',(SELECT id FROM edition WHERE `key`='professional'),'CAD','monthly','active',18,DATE_SUB(NOW(),INTERVAL 12 DAY),DATE_ADD(NOW(),INTERVAL 18 DAY)),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',(SELECT id FROM edition WHERE `key`='enterprise'),'GBP','annual','active',120,DATE_SUB(NOW(),INTERVAL 60 DAY),DATE_ADD(NOW(),INTERVAL 305 DAY)),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',(SELECT id FROM edition WHERE `key`='starter'),'USD','monthly','trialing',3,NULL,NULL),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',(SELECT id FROM edition WHERE `key`='professional'),'USD','monthly','past_due',22,DATE_SUB(NOW(),INTERVAL 20 DAY),DATE_SUB(NOW(),INTERVAL 3 DAY))
ON DUPLICATE KEY UPDATE status = VALUES(status);
UPDATE subscription s SET s.custom_amount_minor = 4500000 WHERE s.id='20000000-0000-4000-8000-000000000002';

-- ── Sample invoices ─────────────────────────────────────────────────────────
INSERT INTO invoice (id, tenant_id, subscription_id, currency_code, number, status, subtotal_minor, tax_minor, total_minor, amount_paid_minor, amount_due_minor, issued_at, paid_at) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','CAD','PRK-2026-0001','paid',39900,5187,45087,45087,0,DATE_SUB(NOW(),INTERVAL 12 DAY),DATE_SUB(NOW(),INTERVAL 12 DAY)),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','USD','PRK-2026-0002','open',29900,0,29900,0,29900,DATE_SUB(NOW(),INTERVAL 5 DAY),NULL)
ON DUPLICATE KEY UPDATE status = VALUES(status);
UPDATE invoice SET attempt_count=2 WHERE id='30000000-0000-4000-8000-000000000002';

INSERT INTO invoice_line (id, invoice_id, kind, description, quantity, unit_amount_minor, amount_minor) VALUES
 (UUID(),'30000000-0000-4000-8000-000000000001','plan','Professional (monthly)',1,39900,39900),
 (UUID(),'30000000-0000-4000-8000-000000000001','tax','Tax (13%)',1,5187,5187),
 (UUID(),'30000000-0000-4000-8000-000000000002','plan','Professional (monthly)',1,29900,29900);

-- ── Sample usage records ────────────────────────────────────────────────────
INSERT INTO usage_record (id, tenant_id, feature_id, subscription_id, quantity, occurred_at, idempotency_key, metadata)
SELECT UUID(),'10000000-0000-4000-8000-000000000001', f.id, '20000000-0000-4000-8000-000000000001', v.qty, DATE_SUB(NOW(),INTERVAL v.d DAY), v.idem, JSON_OBJECT()
FROM ( SELECT 'metric.drawings' fk, 12 qty, 3 d, 'seed-cedar-draw-1' idem
 UNION ALL SELECT 'metric.boqs', 4, 2, 'seed-cedar-boq-1'
 UNION ALL SELECT 'metric.estimates', 3, 1, 'seed-cedar-est-1'
) v JOIN feature f ON f.`key`=v.fk;

-- ── Sample broadcast + deliveries ───────────────────────────────────────────
INSERT INTO notification (id, title, body, audience_type, audience_filter, deliver_in_app, deliver_email, status, sent_at) VALUES
 ('40000000-0000-4000-8000-000000000001','Scheduled maintenance Sunday 02:00 UTC','ScheduleLogix will be briefly unavailable during a deploy.','all_tenants',JSON_OBJECT(),TRUE,TRUE,'sent',DATE_SUB(NOW(),INTERVAL 2 DAY))
ON DUPLICATE KEY UPDATE title = VALUES(title);
INSERT INTO notification_delivery (notification_id, tenant_id, read_at)
SELECT '40000000-0000-4000-8000-000000000001', id, NULL FROM tenant WHERE status <> 'offboarded'
ON DUPLICATE KEY UPDATE read_at = notification_delivery.read_at;

-- ── Host inbox alerts ───────────────────────────────────────────────────────
INSERT INTO host_notification (id, kind, severity, title, body, link) VALUES
 (UUID(),'billing','warning','Invoice payment failed','Summit MEP invoice PRK-2026-0002 failed (attempt 2).','/subscriptions'),
 (UUID(),'tenant','info','New trial started','Harbor Civil started a Starter trial.','/tenants'),
 (UUID(),'security','critical','Suspended tenant','Delta Infrastructure was suspended (payment dispute).','/tenants')
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- ── Sample failed job ───────────────────────────────────────────────────────
INSERT INTO job_failure (id, job_id, job_type, queue, tenant_id, error_class, error_message, attempt, max_attempts, envelope) VALUES
 (UUID(),'arq:job:9f2c','drawlogix.extract','ingest','10000000-0000-4000-8000-000000000003','TimeoutError','Drawing extraction exceeded 300s',3,3,JSON_OBJECT('task','drawlogix.extract','args',JSON_ARRAY('proj-42')))
ON DUPLICATE KEY UPDATE error_message = VALUES(error_message);

-- ── A few audit events through the hash chain ───────────────────────────────
CALL append_audit_event(UUID(), NULL,'system','tenant.create','tenant','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Provisioned Cedar & Stone Builders (Professional)', JSON_OBJECT('edition','professional'), UUID(), NULL,'seed');
CALL append_audit_event(UUID(), NULL,'system','subscription.create','subscription','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Started Professional subscription (CAD monthly)', JSON_OBJECT('seats',18), UUID(), NULL,'seed');
CALL append_audit_event(UUID(), NULL,'system','tenant.suspend','tenant','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','Suspended Delta Infrastructure (payment dispute)', JSON_OBJECT('reason','Payment dispute'), UUID(), NULL,'seed');

-- Done — demo data loaded.
