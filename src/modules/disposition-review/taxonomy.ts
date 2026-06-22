import type { Disposition } from "../types"

/** Placeholder in the prompt template replaced with the live taxonomy at runtime. */
export const TAXONOMY_PLACEHOLDER = "{{DISPOSITION_TAXONOMY}}"

/** Who dispositioned the call — picks which vocabulary the model suggests from. */
export type DispositionAudience = "human" | "ai"

/**
 * Renders the disposition-review system prompt by replacing the taxonomy
 * placeholder with a taxonomy built from the live catalog. Always resolves the
 * placeholder so the literal token never reaches the model.
 */
export function renderSystemPrompt(
  template: string,
  dispositions: Disposition[],
  audience: DispositionAudience = "human",
): string {
  return template.split(TAXONOMY_PLACEHOLDER).join(buildDispositionTaxonomy(dispositions, audience))
}

/**
 * Builds the <disposition_taxonomy> block injected into the disposition-review
 * system prompt from the live CRM disposition catalog (eavesly_dispositions).
 *
 * Scoped by who dispositioned the call: human-agent calls are offered only the
 * human-visible dispositions; AI-agent (Zoe) calls are offered only the AI-Agent
 * dispositions. Offering a value the dispositioner cannot apply produces false
 * "mismatch" flags, so the two vocabularies are kept separate.
 */
export function buildDispositionTaxonomy(
  dispositions: Disposition[],
  audience: DispositionAudience = "human",
): string {
  const wantAi = audience === "ai"
  const suggestable = dispositions.filter((d) => d.name && d.ai_only === wantAi)

  if (suggestable.length === 0) {
    return `<disposition_taxonomy>
        <note>The disposition catalog is unavailable. Suggest the single most accurate disposition for this call using the standard CRM dispositions and your best judgement from the transcript. A human reviews every suggestion; you never apply changes.</note>
    </disposition_taxonomy>`
  }

  const values = suggestable
    .map((d) => {
      const attrs = [`name="${d.name}"`]
      if (d.visibility) attrs.push(`visibility="${d.visibility}"`)
      if (d.conversation_happened)
        attrs.push(`conversation_happened="${d.conversation_happened}"`)
      const open = `<value ${attrs.join(" ")}`
      return d.description ? `${open}>${d.description}</value>` : `${open} />`
    })
    .map((line) => `        ${line}`)
    .join("\n")

  const who = wantAi ? "the AI agent applies" : "human agents apply"
  return `<disposition_taxonomy>
        <note>Suggest the single most accurate disposition for THIS call from the values below. These are the dispositions ${who} in the CRM. Each entry's "name" is the exact value to output; body text, when present, is the official CRM definition; "conversation_happened" is the call outcome the disposition implies; a "visibility" of "Manager" or a team name means the disposition is restricted — only suggest it when the transcript clearly calls for it. A human reviews every suggestion; you never apply changes.</note>
${values}
    </disposition_taxonomy>`
}
