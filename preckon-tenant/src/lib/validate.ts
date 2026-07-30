/**
 * Minimal JSON-Schema validator for artifact payloads (§5.1). Covers exactly
 * the vocabulary the construction pack's payload_schemas use — object/array/
 * string/number/integer/boolean, required, properties, additionalProperties,
 * enum, format (uuid/date-time), minimum, minItems/maxItems, pattern. Not a
 * general JSON-Schema engine; deliberately small and dependency-free.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export function validatePayload(schema: any, value: unknown, path = "$"): ValidationResult {
  const errors: string[] = [];
  walk(schema, value, path, errors);
  return { valid: errors.length === 0, errors };
}

function walk(schema: any, value: any, path: string, errors: string[]): void {
  if (!schema || typeof schema !== "object") return;
  const type = schema.type;

  if (value === undefined || value === null) {
    // presence is enforced by `required` on the parent; a null here is only a
    // problem if a type was explicitly required — handled by required check.
    return;
  }

  if (type === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const req of schema.required ?? []) {
      if (value[req] === undefined || value[req] === null)
        errors.push(`${path}.${req}: required`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const k of Object.keys(value))
        if (!allowed.has(k)) errors.push(`${path}.${k}: additional property not allowed`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (value[k] !== undefined) walk(sub, value[k], `${path}.${k}`, errors);
    }
    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (schema.minItems != null && value.length < schema.minItems)
      errors.push(`${path}: minItems ${schema.minItems}`);
    if (schema.maxItems != null && value.length > schema.maxItems)
      errors.push(`${path}: maxItems ${schema.maxItems}`);
    if (schema.items)
      value.forEach((v: any, i: number) => walk(schema.items, v, `${path}[${i}]`, errors));
    return;
  }

  if (type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path}: expected string`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value))
      errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
    if (schema.format === "uuid" && !UUID_RE.test(value))
      errors.push(`${path}: invalid uuid`);
    if (schema.format === "date-time" && !DATETIME_RE.test(value))
      errors.push(`${path}: invalid date-time`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: does not match ${schema.pattern}`);
    return;
  }

  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || (type === "integer" && !Number.isInteger(value))) {
      errors.push(`${path}: expected ${type}`);
      return;
    }
    if (schema.minimum != null && value < schema.minimum)
      errors.push(`${path}: minimum ${schema.minimum}`);
    return;
  }

  if (type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
    return;
  }
}
