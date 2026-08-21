-- Seed the prompt registry.
--
-- ai_prompt_version has existed since 021 and stayed empty, so every ledger row
-- carried NULL in prompt_key and prompt_version and nobody could answer "which
-- prompt produced this output". These rows give every task type a v1 to point
-- at, which is what turns the ledger columns from decoration into provenance.
--
-- ── WHAT v1 MEANS, AND WHAT IS DELIBERATELY NOT HERE ─────────────────────────
--
-- prompt_json does NOT contain prompt text. The prompt bodies live in the
-- worker service, and inventing plausible-looking text here to fill the column
-- would be worse than leaving it empty: it would look like the prompt that ran,
-- and it would be wrong. Somebody debugging a bad output would read a prompt
-- that never reached a model.
--
-- So v1 records what is actually true today — "whatever the worker shipped
-- with, for this task, at this tier" — and prefix_hash is NULL because there is
-- no prefix here to hash. When a prompt is genuinely authored and reviewed in
-- the registry it lands as v2 with real content, a prefix hash and an eval
-- version, and resolvePrompt() picks it up with no code change. The version
-- number then means something: v1 is the un-migrated baseline, v2+ is governed.
--
-- Status is 'approved' rather than 'draft' because these ARE what is running in
-- production. Marking the live prompts as drafts would make the one honest
-- status value in the table a lie.

-- Idempotent by the (prompt_key, version) unique key, like every other seed in
-- this directory: re-running a migration must not create a second v1.
INSERT INTO ai_prompt_version
  (id, prompt_key, version, task_type, prompt_json, prefix_hash, status, eval_version, created_by)
VALUES
  (UUID(), 'document.classify_split',   1, 'document.classify_split',   JSON_OBJECT('source','worker','tier','standard'), NULL, 'approved', NULL, NULL),
  (UUID(), 'tender.extract_summary',    1, 'tender.extract_summary',    JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'spec.extract_clauses',      1, 'spec.extract_clauses',      JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'drawing.index',             1, 'drawing.index',             JSON_OBJECT('source','worker','tier','standard'), NULL, 'approved', NULL, NULL),
  (UUID(), 'drawing.takeoff',           1, 'drawing.takeoff',           JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'boq.derive_lines',          1, 'boq.derive_lines',          JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'cost.price_lines',          1, 'cost.price_lines',          JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'schedule.build_programme',  1, 'schedule.build_programme',  JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'procure.build_packages',    1, 'procure.build_packages',    JSON_OBJECT('source','worker','tier','standard'), NULL, 'approved', NULL, NULL),
  (UUID(), 'narrative.compose',         1, 'narrative.compose',         JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'rfi.detect',                1, 'rfi.detect',                JSON_OBJECT('source','worker','tier','standard'), NULL, 'approved', NULL, NULL),
  (UUID(), 'compliance.check',          1, 'compliance.check',          JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'proposal.assemble',         1, 'proposal.assemble',         JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'bid.qualify',               1, 'bid.qualify',               JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'risk.assess',               1, 'risk.assess',               JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'approval.prepare',          1, 'approval.prepare',          JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'clarification.draft',       1, 'clarification.draft',       JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'knowledge.search',          1, 'knowledge.search',          JSON_OBJECT('source','worker','tier','routing'),  NULL, 'approved', NULL, NULL),
  (UUID(), 'copilot.respond',           1, 'copilot.respond',           JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'copilot.review_run',        1, 'copilot.review_run',        JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'commercial.respond',        1, 'commercial.respond',        JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'commercial.review_run',     1, 'commercial.review_run',     JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'compliance_lead.respond',   1, 'compliance_lead.respond',   JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL),
  (UUID(), 'compliance_lead.review_run',1, 'compliance_lead.review_run',JSON_OBJECT('source','worker','tier','deep'),     NULL, 'approved', NULL, NULL)
ON DUPLICATE KEY UPDATE task_type = VALUES(task_type);

-- Template-pack tasks (`intake.capture`, `<stage>.run`, `assistant.respond`)
-- are NOT seeded. They are generated per configured domain, so their task types
-- are not knowable at migration time; resolvePrompt() falls back to the caller's
-- reference for them, which is exactly the un-registered behaviour it was built
-- to degrade to.
