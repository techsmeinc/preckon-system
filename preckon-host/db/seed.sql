-- ============================================================================
-- Preckon Host — platform configuration seed (NO dummy customer data)
-- Run AFTER schema.sql. Seeds only what the platform needs to operate:
-- permissions, roles, the feature/edition catalog, currencies, pricing,
-- settings, and AI providers/routing. It creates NO tenants, subscriptions,
-- invoices, or notifications — the console starts clean.
--   • First OWNER staff account: run `npm run seed:owner` after this.
--   • Want sample rows to explore with? Also import db/seed-demo.sql.
-- ============================================================================

USE `preckon_host`;

-- ── §1.3 Permission catalog ────────────────────────────────────────────────
INSERT INTO host_permission (id, `key`, category, description) VALUES
 (UUID(),'tenant.read','Tenants','View tenants and details'),
 (UUID(),'tenant.create','Tenants','Provision a new tenant'),
 (UUID(),'tenant.update','Tenants','Edit tenant metadata (name, contact, region)'),
 (UUID(),'tenant.suspend','Tenants','Suspend a tenant'),
 (UUID(),'tenant.restore','Tenants','Restore a suspended tenant'),
 (UUID(),'tenant.impersonate','Tenants','Start an audited impersonation session'),
 (UUID(),'tenant.offboard','Tenants','Offboard/export/delete a tenant (retention-gated)'),
 (UUID(),'tenant.theme.write','Tenants','Edit a tenant white-label theme'),
 (UUID(),'entitlement.override','Tenants','Grant/revoke/limit a tenant entitlements outside its edition'),
 (UUID(),'edition.read','Product','View editions'),
 (UUID(),'edition.write','Product','Create/edit editions'),
 (UUID(),'feature.read','Product','View feature catalog'),
 (UUID(),'feature.write','Product','Create/edit features'),
 (UUID(),'pricing.read','Pricing','View pricing'),
 (UUID(),'pricing.write','Pricing','Edit plan/usage pricing'),
 (UUID(),'coupon.write','Pricing','Create/manage coupons'),
 (UUID(),'billing.read','Billing','View subscriptions & invoices'),
 (UUID(),'subscription.manage','Billing','Create/change/cancel a tenant subscription'),
 (UUID(),'invoice.retry','Billing','Retry a failed invoice charge'),
 (UUID(),'invoice.remind','Billing','Send an invoice reminder'),
 (UUID(),'billing.refund','Billing','Issue a refund'),
 (UUID(),'notification.read','Notifications','View notifications'),
 (UUID(),'notification.send','Notifications','Send broadcast notifications'),
 (UUID(),'host_user.read','Administration','View host staff'),
 (UUID(),'host_user.manage','Administration','Invite/edit/suspend host staff'),
 (UUID(),'role.manage','Administration','Create/edit roles & permissions'),
 (UUID(),'audit.read','Operations','Read the audit log'),
 (UUID(),'audit.export','Operations','Export the audit log'),
 (UUID(),'settings.read','Operations','View platform settings'),
 (UUID(),'settings.write','Operations','Edit general platform settings'),
 (UUID(),'settings.ai.write','Operations','Edit AI provider/routing config'),
 (UUID(),'maintenance.toggle','Operations','Toggle maintenance mode'),
 (UUID(),'observability.read','Operations','View queue/worker/AI health'),
 (UUID(),'job.manage','Operations','Retry or resolve failed background jobs')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- ── System roles ───────────────────────────────────────────────────────────
INSERT INTO host_role (id, `key`, name, description, is_system) VALUES
 (UUID(),'owner','Owner','Full platform control',TRUE),
 (UUID(),'admin','Admin','Platform administration (no role/refund/maintenance)',TRUE),
 (UUID(),'billing','Billing / Finance','Subscriptions, invoices, pricing',TRUE),
 (UUID(),'support','Support','Tenant health, diagnostics, audited impersonation',TRUE),
 (UUID(),'read_only','Read-only','View everything, change nothing',TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Role → permission grants (resolved by key so we never hardcode ids)
DELETE FROM host_role_permission;                    -- rebuild grants idempotently
INSERT INTO host_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM host_role r JOIN host_permission p
  ON r.`key`='owner';
INSERT INTO host_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM host_role r JOIN host_permission p
  ON r.`key`='admin' AND p.`key` NOT IN ('role.manage','billing.refund','maintenance.toggle');
INSERT INTO host_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM host_role r JOIN host_permission p
  ON r.`key`='billing' AND (p.category IN ('Billing','Pricing') OR p.`key`='tenant.read');
INSERT INTO host_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM host_role r JOIN host_permission p
  ON r.`key`='support' AND p.`key` IN
     ('tenant.read','tenant.impersonate','notification.read','notification.send','observability.read','audit.read');
INSERT INTO host_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM host_role r JOIN host_permission p
  ON r.`key`='read_only' AND p.`key` LIKE '%.read';

-- ── §4.1.1 Feature registry ────────────────────────────────────────────────
INSERT INTO feature (id, `key`, name, category, type, value_type, unit, allowed_values, sort_order) VALUES
 (UUID(),'module.tenderlogix','TenderLogix','module','flag','boolean',NULL,NULL,10),
 (UUID(),'module.drawlogix','DrawLogix','module','flag','boolean',NULL,NULL,20),
 (UUID(),'module.doclogix','DocLogix','module','flag','boolean',NULL,NULL,30),
 (UUID(),'module.quantlogix','QuantLogix','module','flag','boolean',NULL,NULL,40),
 (UUID(),'module.costlogix','CostLogix','module','flag','boolean',NULL,NULL,50),
 (UUID(),'module.schedulelogix','ScheduleLogix','module','flag','boolean',NULL,NULL,60),
 (UUID(),'module.procurelogix','ProcureLogix','module','flag','boolean',NULL,NULL,70),
 (UUID(),'module.copilot','Construction Copilot','module','flag','boolean',NULL,NULL,80),
 (UUID(),'capability.white_label','White-labeling','capability','flag','boolean',NULL,NULL,100),
 (UUID(),'capability.sso','SSO','capability','flag','boolean',NULL,NULL,110),
 (UUID(),'capability.api_access','API access','capability','flag','boolean',NULL,NULL,120),
 (UUID(),'capability.industry_benchmarks','Industry benchmarks (opt-in)','capability','flag','boolean',NULL,NULL,130),
 (UUID(),'limit.seats','Seats','limit','limit','numeric','seat',NULL,200),
 (UUID(),'limit.projects','Active projects','limit','limit','numeric','project',NULL,210),
 (UUID(),'limit.storage_gb','Storage','limit','limit','numeric','GB',NULL,220),
 (UUID(),'limit.audit_export','Audit export','limit','limit','enum',NULL,JSON_ARRAY('basic','full'),230),
 (UUID(),'metric.drawings','Drawings processed','usage','metric','numeric','drawing',NULL,300),
 (UUID(),'metric.boqs','BOQs generated','usage','metric','numeric','boq',NULL,310),
 (UUID(),'metric.estimates','Estimates produced','usage','metric','numeric','estimate',NULL,320),
 (UUID(),'metric.procurement_packages','Procurement packages','usage','metric','numeric','package',NULL,330),
 (UUID(),'metric.copilot_tokens','Copilot usage','usage','metric','numeric','token',NULL,340)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ── §4.2 Editions ──────────────────────────────────────────────────────────
INSERT INTO edition (id, `key`, name, description, status, is_public, trial_days, sort_order) VALUES
 (UUID(),'starter','Starter','Core preconstruction chain for small teams','published',TRUE,14,10),
 (UUID(),'professional','Professional','Full chain + Copilot for growing firms','published',TRUE,14,20),
 (UUID(),'enterprise','Enterprise','Everything, unlimited, white-labeled','published',FALSE,30,30)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ── §4.3 edition_feature matrix (values via derived tables) ─────────────────
DELETE FROM edition_feature;

INSERT INTO edition_feature (edition_id, feature_id, enabled, limit_value, enum_value)
SELECT (SELECT id FROM edition WHERE `key`='starter'), f.id, v.enabled, v.limit_value, v.enum_value
FROM ( SELECT 'module.tenderlogix' fkey, TRUE enabled, CAST(NULL AS DECIMAL(20,4)) limit_value, CAST(NULL AS CHAR) enum_value
 UNION ALL SELECT 'module.drawlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.doclogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.quantlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.costlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'limit.seats',TRUE,3,NULL
 UNION ALL SELECT 'limit.projects',TRUE,5,NULL
 UNION ALL SELECT 'limit.storage_gb',TRUE,10,NULL
 UNION ALL SELECT 'limit.audit_export',TRUE,NULL,'basic'
 UNION ALL SELECT 'metric.drawings',TRUE,0,NULL
 UNION ALL SELECT 'metric.boqs',TRUE,0,NULL
 UNION ALL SELECT 'metric.estimates',TRUE,0,NULL
 UNION ALL SELECT 'metric.procurement_packages',TRUE,0,NULL
) v JOIN feature f ON f.`key` = v.fkey;

INSERT INTO edition_feature (edition_id, feature_id, enabled, limit_value, enum_value)
SELECT (SELECT id FROM edition WHERE `key`='professional'), f.id, v.enabled, v.limit_value, v.enum_value
FROM ( SELECT 'module.tenderlogix' fkey, TRUE enabled, CAST(NULL AS DECIMAL(20,4)) limit_value, CAST(NULL AS CHAR) enum_value
 UNION ALL SELECT 'module.drawlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.doclogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.quantlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.costlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.schedulelogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.procurelogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.copilot',TRUE,NULL,NULL
 UNION ALL SELECT 'capability.white_label',TRUE,NULL,NULL
 UNION ALL SELECT 'capability.api_access',TRUE,NULL,NULL
 UNION ALL SELECT 'limit.seats',TRUE,25,NULL
 UNION ALL SELECT 'limit.projects',TRUE,50,NULL
 UNION ALL SELECT 'limit.storage_gb',TRUE,200,NULL
 UNION ALL SELECT 'limit.audit_export',TRUE,NULL,'full'
 UNION ALL SELECT 'metric.drawings',TRUE,50,NULL
 UNION ALL SELECT 'metric.boqs',TRUE,25,NULL
 UNION ALL SELECT 'metric.estimates',TRUE,25,NULL
 UNION ALL SELECT 'metric.procurement_packages',TRUE,10,NULL
 UNION ALL SELECT 'metric.copilot_tokens',TRUE,1000000,NULL
) v JOIN feature f ON f.`key` = v.fkey;

INSERT INTO edition_feature (edition_id, feature_id, enabled, limit_value, enum_value)
SELECT (SELECT id FROM edition WHERE `key`='enterprise'), f.id, v.enabled, v.limit_value, v.enum_value
FROM ( SELECT 'module.tenderlogix' fkey, TRUE enabled, CAST(NULL AS DECIMAL(20,4)) limit_value, CAST(NULL AS CHAR) enum_value
 UNION ALL SELECT 'module.drawlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.doclogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.quantlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.costlogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.schedulelogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.procurelogix',TRUE,NULL,NULL
 UNION ALL SELECT 'module.copilot',TRUE,NULL,NULL
 UNION ALL SELECT 'capability.white_label',TRUE,NULL,NULL
 UNION ALL SELECT 'capability.sso',TRUE,NULL,NULL
 UNION ALL SELECT 'capability.api_access',TRUE,NULL,NULL
 UNION ALL SELECT 'capability.industry_benchmarks',TRUE,NULL,NULL
 UNION ALL SELECT 'limit.seats',TRUE,NULL,NULL            -- NULL = unlimited
 UNION ALL SELECT 'limit.projects',TRUE,NULL,NULL
 UNION ALL SELECT 'limit.storage_gb',TRUE,2000,NULL
 UNION ALL SELECT 'limit.audit_export',TRUE,NULL,'full'
 UNION ALL SELECT 'metric.drawings',TRUE,500,NULL
 UNION ALL SELECT 'metric.boqs',TRUE,250,NULL
 UNION ALL SELECT 'metric.estimates',TRUE,250,NULL
 UNION ALL SELECT 'metric.procurement_packages',TRUE,100,NULL
 UNION ALL SELECT 'metric.copilot_tokens',TRUE,10000000,NULL
) v JOIN feature f ON f.`key` = v.fkey;

-- ── §6.1 Currencies ────────────────────────────────────────────────────────
INSERT INTO currency (code,name,symbol,minor_unit,sort_order) VALUES
 ('USD','US Dollar','$',2,10),
 ('CAD','Canadian Dollar','$',2,20),
 ('EUR','Euro','€',2,30),
 ('GBP','British Pound','£',2,40),
 ('AED','UAE Dirham','د.إ',2,50)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ── §6.2 Edition prices ────────────────────────────────────────────────────
DELETE FROM edition_price;
INSERT INTO edition_price (edition_id, currency_code, `interval`, amount_minor)
SELECT (SELECT id FROM edition WHERE `key`=v.ek), v.cc, v.iv, v.amt
FROM (
  SELECT 'starter' ek,'USD' cc,'monthly' iv,  9900 amt
  UNION ALL SELECT 'starter','USD','annual',   99000
  UNION ALL SELECT 'starter','CAD','monthly',  13900
  UNION ALL SELECT 'starter','EUR','monthly',   9900
  UNION ALL SELECT 'starter','GBP','monthly',   8500
  UNION ALL SELECT 'starter','AED','monthly',  36500
  UNION ALL SELECT 'professional','USD','monthly', 29900
  UNION ALL SELECT 'professional','USD','annual',  299000
  UNION ALL SELECT 'professional','CAD','monthly', 39900
  UNION ALL SELECT 'professional','EUR','monthly', 27900
  UNION ALL SELECT 'professional','GBP','monthly', 24900
  UNION ALL SELECT 'professional','AED','monthly',109500
) v;
-- Enterprise: no price rows → priced by negotiation (§6.2).

-- ── §6.3 Usage rates ───────────────────────────────────────────────────────
DELETE FROM usage_rate;
INSERT INTO usage_rate (feature_id, currency_code, amount_minor)
SELECT f.id, v.cc, v.amt FROM (
  SELECT 'metric.drawings' fk,'USD' cc, 200 amt
  UNION ALL SELECT 'metric.boqs','USD',2500
  UNION ALL SELECT 'metric.estimates','USD',3000
  UNION ALL SELECT 'metric.procurement_packages','USD',2000
  UNION ALL SELECT 'metric.copilot_tokens','USD',1
  UNION ALL SELECT 'metric.drawings','CAD',270
  UNION ALL SELECT 'metric.boqs','CAD',3400
) v JOIN feature f ON f.`key` = v.fk;

-- ── §9.1 Platform settings ─────────────────────────────────────────────────
INSERT INTO platform_setting (`key`, value, description) VALUES
 ('general.platform_name', JSON_QUOTE('Preckon'), 'Branding name'),
 ('security.session_max_hours', '12', 'Host session length'),
 ('security.require_2fa', 'true', 'Staff 2FA requirement'),
 ('security.password_min_length', '12', 'Staff password policy'),
 ('maintenance.enabled', 'false', 'Maintenance mode'),
 ('maintenance.message', JSON_QUOTE(''), 'Maintenance banner text'),
 ('impersonation.max_minutes', '30', 'Impersonation time-box'),
 ('offboarding.retention_days', '30', 'Retention window'),
 ('entitlements.cache_ttl_seconds', '300', 'Entitlement cache backstop'),
 ('email.provider', JSON_QUOTE('postmark'), 'Transactional email provider'),
 ('email.from_address', JSON_QUOTE('noreply@preckon.com'), 'Default from address'),
 ('email.api_key_secret_ref', JSON_QUOTE('secret://email/api_key'), 'Secret reference, not the key')
ON DUPLICATE KEY UPDATE value = VALUES(value);

-- ── §9.2 AI providers & routing ────────────────────────────────────────────
INSERT INTO ai_provider (id, `key`, name, kind, base_url, api_key_secret_ref) VALUES
 (UUID(),'anthropic','Anthropic','llm','https://api.anthropic.com','secret://ai/anthropic'),
 (UUID(),'openai','OpenAI','llm','https://api.openai.com','secret://ai/openai'),
 (UUID(),'voyage','Voyage AI','embedding','https://api.voyageai.com','secret://ai/voyage')
ON DUPLICATE KEY UPDATE name = VALUES(name);

DELETE FROM ai_routing_rule;
INSERT INTO ai_routing_rule (id, tier, provider_id, model, priority, params)
SELECT UUID(), v.tier, p.id, v.model, v.priority, JSON_OBJECT('max_tokens', v.max_tokens)
FROM (
  SELECT 'orchestrator' tier,'anthropic' pk,'claude-opus-4-8' model, 0 priority, 8000 max_tokens
  UNION ALL SELECT 'orchestrator','openai','gpt-4.1', 1, 8000
  UNION ALL SELECT 'extraction','anthropic','claude-haiku-4-5', 0, 4000
  UNION ALL SELECT 'embedding','voyage','voyage-3', 0, 0
) v JOIN ai_provider p ON p.`key` = v.pk;

-- ============================================================================
-- Platform configuration only — no sample customers/business data.
-- The console starts clean: create your own tenants, editions, pricing, etc.
-- Want demo rows to explore with? Import db/seed-demo.sql as well.
-- ============================================================================

-- Done. Now run:  npm run seed:owner
