-- 010 — license the technical narrative module.
--
-- The pack seed (`npm run seed`) registers the module, agent, artifact type and
-- workflow from the pack source. It does NOT license them: a workflow is
-- runnable only when its module_key appears in that tenant's
-- entitlement_snapshot.licensed_modules (§8.1). So without this an existing
-- workspace gets NarrativeLogix registered and still cannot see it — the tab
-- never appears, and there is nothing on screen to explain why.
--
-- Granted to every tenant that already licenses procurelogix, which is the
-- closest existing signal for "this workspace has the full construction chain".
-- Idempotent: JSON_ARRAY_APPEND only runs where the value is absent.

UPDATE entitlement_snapshot
   SET licensed_modules = JSON_ARRAY_APPEND(licensed_modules, '$', 'narrativelogix')
 WHERE JSON_CONTAINS(licensed_modules, '"procurelogix"')
   AND NOT JSON_CONTAINS(licensed_modules, '"narrativelogix"');
