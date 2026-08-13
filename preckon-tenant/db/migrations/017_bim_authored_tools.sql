-- 017 — tools the user writes themselves.
--
-- The assistant now picks from a registry rather than a fixed command list, and
-- the point of a registry is that it can grow without a deploy. An estimator who
-- tags rooms the same way every week should be able to save that as a tool and
-- have the assistant find it by name next time.
--
-- ── WHY THIS TABLE HOLDS DATA AND NOT CODE ───────────────────────────────────
--
-- The obvious way to let users author automations is to store a snippet and run
-- it. That would put arbitrary user code inside the server process, and every
-- defence against it — a sandbox, a timeout, a syntax whitelist — is a thing
-- that can be got around.
--
-- So `steps` is a list of {tool, args} naming BUILT-IN tools, with {{...}}
-- templates substituted as plain data. There is no expression to evaluate and
-- no interpreter to escape. The worst a hostile definition can do is call the
-- built-in tools with awkward arguments, which is exactly what the UI already
-- permits and what the confirmation gate and discipline scoping already govern.
--
-- Keep that property. If a future column stores something evaluated at run time,
-- the safety argument here stops being true and this becomes a sandbox problem.
--
-- ── SCOPE ────────────────────────────────────────────────────────────────────
--
-- Personal by default: a tool belongs to its author and nobody else is offered
-- it. `scope` is here so a tenant can promote one to shared later without a
-- migration; nothing reads 'GLOBAL' yet, and promoting should be a reviewed act
-- rather than a checkbox, since a shared tool runs against other people's models.

CREATE TABLE IF NOT EXISTS bim_authored_tool (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36) NOT NULL,
  -- snake_case, unique per author. This is the name the model emits, so it is
  -- validated against the same pattern the registry uses.
  name        VARCHAR(64) NOT NULL,
  label       VARCHAR(120) NOT NULL,
  module      VARCHAR(80) NOT NULL DEFAULT 'My Tools',
  -- What the agent searches on. A tool with a vague description is a tool that
  -- never gets discovered, so this is NOT NULL on purpose.
  description VARCHAR(500) NOT NULL,
  -- Declared parameters: [{name, type, description, required, default}].
  params      JSON NOT NULL,
  -- The recipe: [{tool, args, as?, optional?}]. Data, never code — see above.
  steps       JSON NOT NULL,
  keywords    JSON,
  scope       ENUM('PERSONAL','GLOBAL') NOT NULL DEFAULT 'PERSONAL',
  owner_id    CHAR(36) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- One name per author. Two tools answering to the same name would make which
  -- one the agent called a matter of row order.
  UNIQUE KEY bim_tool_name_uq (tenant_id, owner_id, name),
  KEY bim_tool_owner_idx (tenant_id, owner_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
