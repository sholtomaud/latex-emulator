/**
 * The subset of JSON Schema the plugin's tools use. Each tool publishes its
 * schema as MCP's `inputSchema` and is checked against the same schema,
 * so the published contract and the check can't drift apart.
 */
export type Schema =
  | {
      type: 'string';
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      description?: string;
    }
  | {
      type: 'integer';
      minimum?: number;
      maximum?: number;
      description?: string;
    }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; items: Schema; description?: string }
  | {
      type: 'object';
      properties: Record<string, Schema>;
      required?: string[];
      additionalProperties: false;
      description?: string;
    };

/** Problems with `value`, in words; empty when it matches. */
export function validate(schema: Schema, value: unknown): string[] {
  if (schema.type !== 'object') return check(schema, value, 'value');
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return ['arguments must be an object'];
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const name of schema.required ?? [])
    if (record[name] === undefined) problems.push(`${name} is required`);
  for (const [name, v] of Object.entries(record)) {
    const property = schema.properties[name];
    if (!property) problems.push(`${name} is not a known argument`);
    else if (v !== undefined) problems.push(...check(property, v, name));
  }
  return problems;
}

function check(schema: Schema, value: unknown, name: string): string[] {
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [`${name} must be a string`];
      if (schema.minLength !== undefined && value.length < schema.minLength)
        return [`${name} must be at least ${schema.minLength} characters`];
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        return [`${name} must be at most ${schema.maxLength} characters`];
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        return [`${name} is not in the expected form`];
      return [];
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        return [`${name} must be an integer`];
      if (schema.minimum !== undefined && value < schema.minimum)
        return [`${name} must be at least ${schema.minimum}`];
      if (schema.maximum !== undefined && value > schema.maximum)
        return [`${name} must be at most ${schema.maximum}`];
      return [];
    case 'boolean':
      return typeof value === 'boolean'
        ? []
        : [`${name} must be true or false`];
    case 'array':
      if (!Array.isArray(value)) return [`${name} must be an array`];
      return value.flatMap((v, i) => check(schema.items, v, `${name}[${i}]`));
    case 'object':
      return validate(schema, value);
  }
}
