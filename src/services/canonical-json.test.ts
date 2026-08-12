import { describe, expect, it } from "vitest"
import { canonicalizeJson, sha256CanonicalJson } from "./canonical-json"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonPath = ReadonlyArray<string | number>

function objectKeyPaths(value: JsonValue, prefix: JsonPath = []): JsonPath[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectKeyPaths(item, [...prefix, index]))
  }
  if (value === null || typeof value !== "object") return []

  return Object.entries(value).flatMap(([key, item]) => [
    [...prefix, key],
    ...objectKeyPaths(item, [...prefix, key]),
  ])
}

function removeObjectKey(value: JsonValue, path: JsonPath): JsonValue {
  const [head, ...tail] = path
  if (head === undefined) return value

  if (Array.isArray(value)) {
    if (typeof head !== "number") return value
    return value.map((item, index) =>
      index === head ? removeObjectKey(item, tail) : item,
    )
  }
  if (value === null || typeof value !== "object" || typeof head !== "string") {
    return value
  }

  const result: { [key: string]: JsonValue } = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === head && tail.length === 0) continue
    result[key] = key === head ? removeObjectKey(item, tail) : item
  }
  return result
}

describe("canonical JSON", () => {
  it("recursively sorts object keys while preserving array order", () => {
    expect(canonicalizeJson({
      z: [{ y: 2, x: 1 }, "second"],
      a: { d: null, c: true },
    })).toEqual({
      _tag: "success",
      value: '{"a":{"c":true,"d":null},"z":[{"x":1,"y":2},"second"]}',
    })
  })

  it("rejects values that JSON cannot represent canonically", () => {
    expect(canonicalizeJson({ invalid: undefined })).toEqual({
      _tag: "failure",
      reason: "unsupported_value",
    })
    expect(canonicalizeJson(Number.NaN)).toEqual({
      _tag: "failure",
      reason: "unsupported_value",
    })

    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(canonicalizeJson(cyclic)).toEqual({
      _tag: "failure",
      reason: "cyclic_reference",
    })
  })

  it("includes every manifest key in the digest", async () => {
    const callIds = Array.from(
      { length: 57 },
      (_, index) => `approved-call-${String(index + 1).padStart(2, "0")}`,
    )
    const manifest: JsonValue = {
      representation_version: "psai-245-achieve-backfill-manifest-v1",
      gate: "gate_1_dry_run",
      module_name: "achieve_welcome_call_qa",
      snapshot: {
        cutoff: "2026-08-11T16:21:44.777859Z",
        funnel_counts: [378, 101, 89, 88, 65, 57],
      },
      candidate_count: 57,
      candidates: callIds.map((call_id) => ({
        call_id,
        reason: "approved_frozen_cohort",
        status: "eligible",
      })),
    }
    const baseline = await sha256CanonicalJson(manifest)
    expect(baseline).toEqual({
      _tag: "success",
      value: "298d6e82021179108874b2c1329ad9410dd4ce6a34d9d5ab4f51899567f1a4a8",
    })

    const paths = objectKeyPaths(manifest)
    expect(paths).toHaveLength(179)
    for (const path of paths) {
      const changed = await sha256CanonicalJson(removeObjectKey(manifest, path))
      expect(changed._tag).toBe("success")
      if (changed._tag === "success" && baseline._tag === "success") {
        expect(changed.value).not.toBe(baseline.value)
      }
    }
  })

  it("hashes the documented Python sort_keys representation", async () => {
    const value = {
      snapshot: { funnel_counts: [378, 101, 89, 88, 65, 57], cutoff: "2026-08-11T16:21:44.777859Z" },
      candidate: { status: "eligible", call_id: "call-1", reason: "approved_frozen_cohort" },
    }
    // Produced by Python json.dumps(value, sort_keys=True,
    // separators=(",", ":"), ensure_ascii=False).
    const pythonCanonical = '{"candidate":{"call_id":"call-1","reason":"approved_frozen_cohort","status":"eligible"},"snapshot":{"cutoff":"2026-08-11T16:21:44.777859Z","funnel_counts":[378,101,89,88,65,57]}}'

    expect(canonicalizeJson(value)).toEqual({
      _tag: "success",
      value: pythonCanonical,
    })
    expect(await sha256CanonicalJson(value)).toEqual({
      _tag: "success",
      value: "4376a887b95e0fee3c7373124f871ca6e48815e87e99304ae8f0c876dedb1d75",
    })
  })
})
