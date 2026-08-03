-- 008 — citation audit fields on boq_line.
--
-- Core validates every emitted artifact against artifact_type.payload_schema as
-- stored in THIS database, not against the pack source. The pack file is only
-- the seed. So a schema change that ships in code but not here does not loosen
-- validation — it tightens it into a failure: the worker emits the new fields,
-- `additionalProperties: false` rejects the payload, and the whole BOQ job
-- fails. The bill does not come back wrong; it does not come back at all.
--
-- Three fields, all optional:
--   measured_from    the CAD layers/blocks a quantity was measured from, each
--                    confirmed to exist in the parsed drawings
--   review_required  the citation audit could not match any cited element
--   review_reason    what it could not match
--
-- Idempotent: JSON_SET overwrites, so re-running is safe.

UPDATE artifact_type
   SET payload_schema = JSON_SET(
         payload_schema,
         '$.properties.measured_from',   JSON_OBJECT('type', 'string'),
         '$.properties.review_required', JSON_OBJECT('type', 'boolean'),
         '$.properties.review_reason',   JSON_OBJECT('type', 'string')
       )
 WHERE `key` LIKE '%boq_line';
