/** Failure returned when a value has no supported canonical JSON representation. */
export type CanonicalJsonFailure = {
  readonly _tag: "failure"
  readonly reason: "unsupported_value" | "cyclic_reference"
}

/** Successful canonical serialization or SHA-256 hashing. */
export type CanonicalJsonSuccess = {
  readonly _tag: "success"
  readonly value: string
}

/** Result of canonical JSON serialization or hashing. */
export type CanonicalJsonResult = CanonicalJsonSuccess | CanonicalJsonFailure

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function serialize(
  value: unknown,
  ancestors: Set<object>,
): CanonicalJsonResult {
  if (value === null) return { _tag: "success", value: "null" }

  switch (typeof value) {
    case "boolean":
      return { _tag: "success", value: value ? "true" : "false" }
    case "string":
      return { _tag: "success", value: JSON.stringify(value) }
    case "number":
      return Number.isFinite(value)
        ? { _tag: "success", value: JSON.stringify(value) }
        : { _tag: "failure", reason: "unsupported_value" }
    case "object":
      break
    default:
      return { _tag: "failure", reason: "unsupported_value" }
  }

  if (ancestors.has(value)) {
    return { _tag: "failure", reason: "cyclic_reference" }
  }

  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return { _tag: "failure", reason: "unsupported_value" }
  }

  ancestors.add(value)
  const parts: string[] = []

  if (Array.isArray(value)) {
    for (const item of value) {
      const serialized = serialize(item, ancestors)
      if (serialized._tag === "failure") {
        ancestors.delete(value)
        return serialized
      }
      parts.push(serialized.value)
    }
    ancestors.delete(value)
    return { _tag: "success", value: `[${parts.join(",")}]` }
  }

  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    ancestors.delete(value)
    return { _tag: "failure", reason: "unsupported_value" }
  }

  for (const key of Object.keys(value).sort()) {
    const serialized = serialize(value[key], ancestors)
    if (serialized._tag === "failure") {
      ancestors.delete(value)
      return serialized
    }
    parts.push(`${JSON.stringify(key)}:${serialized.value}`)
  }
  ancestors.delete(value)
  return { _tag: "success", value: `{${parts.join(",")}}` }
}

/**
 * Serialize supported JSON values deterministically: object keys are sorted
 * lexicographically at every level and array order is preserved. Unsupported
 * values and cycles are rejected rather than omitted or coerced.
 */
export function canonicalizeJson(value: unknown): CanonicalJsonResult {
  return serialize(value, new Set<object>())
}

/** Canonicalize a supported JSON value and return its lowercase SHA-256 digest. */
export async function sha256CanonicalJson(value: unknown): Promise<CanonicalJsonResult> {
  const canonical = canonicalizeJson(value)
  if (canonical._tag === "failure") return canonical

  const bytes = new TextEncoder().encode(canonical.value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return {
    _tag: "success",
    value: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  }
}
