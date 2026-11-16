/** Prefixed settings take precedence; legacy names keep existing installs working. */
export function configuration(name: string, legacy = name) {
  return process.env[`IMAGE_QUEUE_${name}`] ?? process.env[legacy];
}
