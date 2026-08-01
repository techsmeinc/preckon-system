// The 16 construction artifact-type payload schemas (pack Appendix C.2). Each is
// the JSON Schema Core validates a payload against on emitArtifact (§5.1). Money
// is integer minor units (§X); inter-artifact references in a payload are soft.

export const SCHEMAS: Record<string, any> = {
  document: {
    type: "object",
    additionalProperties: false,
    required: ["file_id", "doc_type", "page_range"],
    properties: {
      file_id: { type: "string", format: "uuid" },
      doc_type: {
        type: "string",
        enum: ["drawing", "specification", "tender_letter", "addendum", "boq", "schedule", "other"],
      },
      title: { type: "string" },
      page_range: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 2, maxItems: 2 },
    },
  },
  tender_summary: {
    type: "object",
    additionalProperties: false,
    required: ["submission_deadline", "submission_format", "mandatory_requirements"],
    properties: {
      submission_deadline: { type: "string", format: "date-time" },
      submission_format: { type: "string" },
      project_name: { type: "string" },
      client: { type: "string" },
      scope_summary: { type: "string" },
      mandatory_requirements: {
        type: "array",
        items: {
          type: "object",
          required: ["ref", "text"],
          properties: { ref: { type: "string" }, text: { type: "string" } },
        },
      },
    },
  },
  spec_clause: {
    type: "object",
    additionalProperties: false,
    required: ["section", "clause_ref", "text"],
    properties: {
      section: { type: "string" },
      clause_ref: { type: "string" },
      title: { type: "string" },
      text: { type: "string" },
      is_normative: { type: "boolean" },
      standards: { type: "array", items: { type: "string" } },
    },
  },
  drawing_index: {
    type: "object",
    additionalProperties: false,
    required: ["sheet_no", "title", "file_id", "page_no"],
    properties: {
      sheet_no: { type: "string" },
      title: { type: "string" },
      discipline: {
        type: "string",
        enum: ["architectural", "structural", "civil", "mechanical", "electrical", "plumbing", "other"],
      },
      revision: { type: "string" },
      scale: { type: "string" },
      file_id: { type: "string", format: "uuid" },
      page_no: { type: "integer", minimum: 1 },
    },
  },
  drawing_measurement: {
    type: "object",
    additionalProperties: false,
    required: ["sheet_no", "item", "quantity", "unit"],
    properties: {
      sheet_no: { type: "string" },
      item: { type: "string" },
      quantity: { type: "number", minimum: 0 },
      unit: { type: "string", enum: ["m", "m2", "m3", "nr", "kg", "t", "lm"] },
      location: { type: "string" },
      method: { type: "string" },
    },
  },
  boq_line: {
    type: "object",
    additionalProperties: false,
    required: ["code", "description", "quantity", "unit"],
    properties: {
      code: { type: "string" },
      description: { type: "string" },
      quantity: { type: "number", minimum: 0 },
      unit: { type: "string" },
      trade: { type: "string" },
      notes: { type: "string" },
    },
  },
  cost_line: {
    type: "object",
    additionalProperties: false,
    required: ["boq_code", "rate_minor", "amount_minor", "currency"],
    properties: {
      boq_code: { type: "string" },
      rate_minor: { type: "integer", minimum: 0 },
      amount_minor: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      rate_source: { type: "string" },
      rate_book_ref: { type: "string" },
    },
  },
  // A programme activity. `predecessors` (names, finish-to-start) is the simple
  // form and stays required; `depends_on` is the real schedule network — typed
  // links with lag, which is what makes the critical path mean anything. A
  // programme built only of FS-by-name links cannot express two trades starting
  // together, a wall that must finish with its services, or a 7-day concrete
  // cure, so it computes a float that no planner would recognise.
  schedule_activity: {
    type: "object",
    additionalProperties: false,
    required: ["activity", "duration_days", "predecessors"],
    properties: {
      activity: { type: "string" },
      wbs: { type: "string" },
      // Grouping band on the Gantt, named after this project's real structure.
      phase: { type: "string" },
      // Tree position. A "section" is a summary row whose dates and duration are
      // rolled up from its children rather than stated; "activity" is real work.
      // `parent` names the row above it, matching the same convention as
      // depends_on — names, not ids, because an edit supersedes the id.
      kind: { type: "string", enum: ["section", "activity"] },
      parent: { type: "string" },
      // Ordering within a parent. Programmes are read top to bottom in build
      // order, which is not the order an agent happened to emit them in.
      seq: { type: "integer" },
      // Progress, 0-100.
      percent_complete: { type: "number", minimum: 0, maximum: 100 },
      // Who is carrying it. A project member's user id, or a free-text crew name
      // for a subcontractor who has no login.
      assignee: { type: "string" },
      duration_days: { type: "number", minimum: 0 },
      predecessors: { type: "array", items: { type: "string" } },
      depends_on: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["activity"],
          properties: {
            // The predecessor's activity name, matched exactly.
            activity: { type: "string" },
            type: { type: "string", enum: ["FS", "SS", "FF", "SF"] },
            // Days of lag; negative is a lead (an overlap).
            lag_days: { type: "integer" },
          },
        },
      },
      start_offset_days: { type: "integer" },
      // Zero-duration marker: commencement, sectional completion, handover.
      is_milestone: { type: "boolean" },
      trade: { type: "string" },
      sow_ref: { type: "string" },
      // Why this duration — a stated contract period, or the quantity and output
      // rate it was sized from. The difference between a programme you can
      // defend in a meeting and a row of plausible bars.
      basis: { type: "string" },
      // BOQ codes this activity delivers, so a bar traces to the lines that
      // sized it and a priced scope with no bar is visible.
      boq_refs: { type: "array", items: { type: "string" } },
    },
  },
  procurement_package: {
    type: "object",
    additionalProperties: false,
    required: ["package_name", "trade", "boq_codes"],
    properties: {
      package_name: { type: "string" },
      trade: { type: "string" },
      boq_codes: { type: "array", items: { type: "string" } },
      estimated_value_minor: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      lead_time_weeks: { type: "number", minimum: 0 },
    },
  },
  rfi: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "question", "severity"],
    properties: {
      subject: { type: "string" },
      question: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      references: { type: "array", items: { type: "string" } },
      raised_against: { type: "string" },
    },
  },
  compliance_item: {
    type: "object",
    additionalProperties: false,
    required: ["requirement_ref", "status"],
    properties: {
      requirement_ref: { type: "string" },
      requirement_text: { type: "string" },
      status: { type: "string", enum: ["met", "partial", "not_met", "not_applicable"] },
      evidence_artifact_ids: { type: "array", items: { type: "string", format: "uuid" } },
      note: { type: "string" },
    },
  },
  proposal_doc: {
    type: "object",
    additionalProperties: false,
    required: ["title", "sections", "total_amount_minor", "currency"],
    properties: {
      title: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["heading", "body"],
          properties: { heading: { type: "string" }, body: { type: "string" } },
        },
      },
      total_amount_minor: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      submission_ready: { type: "boolean" },
    },
  },
  bid_decision: {
    type: "object",
    additionalProperties: false,
    required: ["decision", "rationale"],
    properties: {
      decision: { type: "string", enum: ["go", "no_go", "conditional"] },
      rationale: { type: "string" },
      signals: {
        type: "object",
        properties: {
          fit: { type: "string", enum: ["low", "med", "high"] },
          capacity: { type: "string", enum: ["low", "med", "high"] },
          competition: { type: "string", enum: ["low", "med", "high"] },
          margin_headroom_pct: { type: "number" },
        },
      },
      conditions: { type: "array", items: { type: "string" } },
    },
  },
  risk: {
    type: "object",
    additionalProperties: false,
    required: ["category", "title", "likelihood", "impact"],
    properties: {
      category: {
        type: "string",
        enum: ["commercial", "technical", "programme", "contractual", "external"],
      },
      title: { type: "string" },
      description: { type: "string" },
      likelihood: { type: "string", enum: ["low", "med", "high"] },
      impact: { type: "string", enum: ["low", "med", "high"] },
      mitigation: { type: "string" },
      owner_role: { type: "string" },
      status: { type: "string", enum: ["open", "mitigating", "closed", "accepted"] },
    },
  },
  bid_approval: {
    type: "object",
    additionalProperties: false,
    required: ["total_amount_minor", "currency", "margin_pct", "recommendation"],
    properties: {
      total_amount_minor: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      margin_pct: { type: "number" },
      key_risk_ids: { type: "array", items: { type: "string", format: "uuid" } },
      compliance_status: { type: "string", enum: ["clear", "open_items", "blocked"] },
      recommendation: { type: "string" },
      conditions: { type: "array", items: { type: "string" } },
      approved_by: { type: "string", format: "uuid" },
    },
  },
  client_query: {
    type: "object",
    additionalProperties: false,
    required: ["direction", "subject", "body", "status"],
    properties: {
      direction: { type: "string", enum: ["inbound", "outbound"] },
      subject: { type: "string" },
      body: { type: "string" },
      references: { type: "array", items: { type: "string", format: "uuid" } },
      is_addendum: { type: "boolean" },
      status: { type: "string", enum: ["open", "answered", "closed"] },
    },
  },
  // Standards & Rules capability (v2, §4) — a validation finding. Generic Core
  // shape; produced by validating confirmed artifacts against mandatory rules.
  standard_violation: {
    type: "object",
    additionalProperties: false,
    required: ["rule_id", "subject_artifact_id", "severity", "status"],
    properties: {
      rule_id: { type: "string" },
      subject_artifact_id: { type: "string", format: "uuid" },
      observed: { type: "object" },
      expected: { type: "object" },
      severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
      reference: { type: "string" },
      recommendation: { type: "string" },
      status: { type: "string", enum: ["open", "waived", "resolved"] },
    },
  },
};

export const REVIEWABLE: Record<string, boolean> = {
  document: false, // canonical on emit (§7.4)
  tender_summary: true,
  spec_clause: true,
  drawing_index: true,
  drawing_measurement: true,
  boq_line: true,
  cost_line: true,
  schedule_activity: true,
  procurement_package: true,
  rfi: true,
  compliance_item: true,
  proposal_doc: true,
  bid_decision: true,
  risk: true,
  bid_approval: true,
  client_query: true,
  standard_violation: true,
};

export const TYPE_NAMES: Record<string, string> = {
  document: "Document",
  tender_summary: "Tender Summary",
  spec_clause: "Specification Clause",
  drawing_index: "Drawing Index",
  drawing_measurement: "Drawing Measurement",
  boq_line: "BOQ Line",
  cost_line: "Cost Line",
  schedule_activity: "Schedule Activity",
  procurement_package: "Procurement Package",
  rfi: "RFI",
  compliance_item: "Compliance Item",
  proposal_doc: "Proposal Document",
  bid_decision: "Bid Decision",
  risk: "Risk",
  bid_approval: "Bid Approval",
  client_query: "Client Query",
  standard_violation: "Standard Violation",
};
