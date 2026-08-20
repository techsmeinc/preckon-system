-- Seed the model registry.
--
-- 021 created ai_model_registry and left it empty, so every alias lookup missed
-- and the alias layer resolved to nothing. These are the three models the app
-- already routes to through MODEL_ROUTING / MODEL_STANDARD / MODEL_DEEP, now
-- expressed as registry rows so that swapping a provider model is an UPDATE
-- here rather than an env change and a deploy.
--
-- INSERT IGNORE, not ON DUPLICATE KEY UPDATE: this seeds a row once and never
-- overwrites one an operator has since tuned. Re-running the migration on every
-- deploy must not silently revert a rate card somebody corrected.
--
-- BOUNDARY: every row is `external`. Anthropic is a third party, and calling it
-- through Preckon's own proxy does not change whose infrastructure the tokens
-- land on. This is deliberate and it has a consequence worth stating: under the
-- `saas` deployment mode, `confidential` data may only reach `local` or
-- `preckon`, and policy.ts treats anything unclassified as confidential. So
-- with enforcement on, these models are ineligible for unclassified work until
-- either the data is classified `internal`, the tenant policy is widened, or
-- Preckon-boundary inference exists. Recording that honestly is the point of
-- the table; see src/lib/ai/govern.ts.
--
-- RATE CARDS: minor units (US cents) per million tokens, at list price.
-- Sonnet 5 carries a promotional rate of $2/$10 per MTok through 2026-08-31;
-- the list price of $3/$15 is seeded instead, because a budget check that
-- under-estimates permits more spend than the customer agreed to, and the
-- direction of that error should never favour looking cheap (budget.ts).

INSERT IGNORE INTO ai_model_registry
  (alias, provider, provider_model, boundary, is_frontier, capabilities_json,
   context_limit, rate_card_json, typical_latency_ms, licence, evaluation_version, status)
VALUES
  ('preckon-small', 'anthropic', 'claude-haiku-4-5', 'external', FALSE,
   JSON_ARRAY('classification', 'extraction', 'structured_output', 'tool_calling'),
   200000,
   JSON_OBJECT('inputPerMillionMinor', 100, 'outputPerMillionMinor', 500),
   1500, 'commercial', 'seed-2026-08', 'approved'),

  ('preckon-reasoning', 'anthropic', 'claude-sonnet-5', 'external', FALSE,
   JSON_ARRAY('construction_reasoning', 'extraction', 'structured_output', 'tool_calling'),
   1000000,
   JSON_OBJECT('inputPerMillionMinor', 300, 'outputPerMillionMinor', 1500),
   4000, 'commercial', 'seed-2026-08', 'approved'),

  ('preckon-multimodal', 'anthropic', 'claude-sonnet-5', 'external', FALSE,
   JSON_ARRAY('multimodal', 'extraction', 'structured_output', 'tool_calling'),
   1000000,
   JSON_OBJECT('inputPerMillionMinor', 300, 'outputPerMillionMinor', 1500),
   4000, 'commercial', 'seed-2026-08', 'approved'),

  ('frontier-reasoning', 'anthropic', 'claude-opus-4-8', 'external', TRUE,
   JSON_ARRAY('hard_reasoning', 'construction_reasoning', 'structured_output', 'tool_calling'),
   1000000,
   JSON_OBJECT('inputPerMillionMinor', 500, 'outputPerMillionMinor', 2500),
   9000, 'commercial', 'seed-2026-08', 'approved'),

  ('frontier-multimodal', 'anthropic', 'claude-opus-4-8', 'external', TRUE,
   JSON_ARRAY('multimodal', 'hard_reasoning', 'structured_output', 'tool_calling'),
   1000000,
   JSON_OBJECT('inputPerMillionMinor', 500, 'outputPerMillionMinor', 2500),
   9000, 'commercial', 'seed-2026-08', 'approved');
