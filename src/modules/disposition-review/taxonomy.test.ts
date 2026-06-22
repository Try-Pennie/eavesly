import { describe, it, expect } from "vitest"
import { buildDispositionTaxonomy, renderSystemPrompt } from "./taxonomy"
import type { Disposition } from "../types"

const humanVisible: Disposition = {
  name: "1.2 - Interested > No Call Scheduled",
  description: "Lead interested, no future call scheduled.",
  visibility: "All Users",
  conversation_happened: "yes",
  ai_only: false,
}

const managerRestricted: Disposition = {
  name: "1.1 - Keep In Automation",
  description: "Keeps lead in automation flow.",
  visibility: "Manager",
  conversation_happened: "no",
  ai_only: false,
}

const aiOnly: Disposition = {
  name: "No Action",
  description: null,
  visibility: "AI Agent",
  conversation_happened: "no",
  ai_only: true,
}

const noDescription: Disposition = {
  name: "Pre-recorded Voicemail",
  description: null,
  visibility: null,
  conversation_happened: "no",
  ai_only: false,
}

describe("buildDispositionTaxonomy", () => {
  it("includes human-visible dispositions with name, definition and conversation_happened", () => {
    const xml = buildDispositionTaxonomy([humanVisible])
    expect(xml).toContain('name="1.2 - Interested > No Call Scheduled"')
    expect(xml).toContain("Lead interested, no future call scheduled.")
    expect(xml).toContain('conversation_happened="yes"')
  })

  it("excludes AI-Agent-only dispositions from the suggestable set", () => {
    const xml = buildDispositionTaxonomy([humanVisible, aiOnly])
    expect(xml).not.toContain('name="No Action"')
  })

  it("offers only AI-Agent dispositions when the audience is ai", () => {
    const xml = buildDispositionTaxonomy([humanVisible, aiOnly], "ai")
    expect(xml).toContain('name="No Action"')
    expect(xml).not.toContain('name="1.2 - Interested > No Call Scheduled"')
  })

  it("marks Manager/Team visibility so restricted values are identifiable", () => {
    const xml = buildDispositionTaxonomy([managerRestricted])
    expect(xml).toContain('visibility="Manager"')
  })

  it("emits a self-closing value when a disposition has no description", () => {
    const xml = buildDispositionTaxonomy([noDescription])
    expect(xml).toContain('name="Pre-recorded Voicemail"')
    expect(xml).not.toContain("<value name=\"Pre-recorded Voicemail\"></value>")
  })

  it("returns a graceful taxonomy with no value entries when the catalog is empty", () => {
    const xml = buildDispositionTaxonomy([])
    expect(xml).toContain("<disposition_taxonomy>")
    expect(xml).not.toContain("<value")
  })
})

describe("renderSystemPrompt", () => {
  const template = "<prompt>before {{DISPOSITION_TAXONOMY}} after</prompt>"

  it("replaces the placeholder with the built taxonomy", () => {
    const out = renderSystemPrompt(template, [humanVisible])
    expect(out).not.toContain("{{DISPOSITION_TAXONOMY}}")
    expect(out).toContain('name="1.2 - Interested > No Call Scheduled"')
    expect(out).toContain("before")
    expect(out).toContain("after")
  })

  it("excludes AI-only dispositions from the rendered prompt", () => {
    const out = renderSystemPrompt(template, [humanVisible, aiOnly])
    expect(out).not.toContain('name="No Action"')
  })

  it("resolves the placeholder even when the catalog is empty", () => {
    const out = renderSystemPrompt(template, [])
    expect(out).not.toContain("{{DISPOSITION_TAXONOMY}}")
    expect(out).toContain("<disposition_taxonomy>")
  })
})
