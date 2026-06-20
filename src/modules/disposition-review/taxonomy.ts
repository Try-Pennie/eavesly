import type { Disposition } from "../types"

/** Placeholder in the prompt template replaced with the live taxonomy at runtime. */
export const TAXONOMY_PLACEHOLDER = "{{DISPOSITION_TAXONOMY}}"

/**
 * Renders the disposition-review system prompt by replacing the taxonomy
 * placeholder with a taxonomy built from the live catalog. Always resolves the
 * placeholder so the literal token never reaches the model.
 */
export function renderSystemPrompt(
  template: string,
  dispositions: Disposition[],
): string {
  return template.split(TAXONOMY_PLACEHOLDER).join(buildDispositionTaxonomy(dispositions))
}

/**
 * Builds the <disposition_taxonomy> block injected into the disposition-review
 * system prompt from the live CRM disposition catalog (eavesly_dispositions).
 *
 * Only human-visible dispositions are offered as suggestable values — AI-Agent-
 * only dispositions are excluded, because the calls under review are dispositioned
 * by human agents and suggesting a value they cannot apply produces false
 * "mismatch" flags.
 */
export function buildDispositionTaxonomy(dispositions: Disposition[]): string {
  const suggestable = dispositions.filter((d) => !d.ai_only && d.name)

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

  return `<disposition_taxonomy>
        <note>Suggest the single most accurate disposition for THIS call from the values below. These are the dispositions human agents apply in the CRM. Each entry's "name" is the exact value to output; body text, when present, is the official CRM definition; "conversation_happened" is the call outcome the disposition implies; a "visibility" of "Manager" or a team name means the disposition is restricted — only suggest it when the transcript clearly calls for it. A human reviews every suggestion; you never apply changes.</note>
${values}
    </disposition_taxonomy>`
}
