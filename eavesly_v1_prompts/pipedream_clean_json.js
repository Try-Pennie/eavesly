// To use previous step data, pass the `steps` object to the run() function
export default defineComponent({
    async run({ steps, $ }) {
      const json_to_clean = steps.openrouter_qa_script.$return_value.choices[0].message.content;
  
      function escapeSmartQuotesForJSON(s) {
        // Keep single smart quotes as plain apostrophes,
        // but escape double smart quotes so they don't break JSON strings.
        return String(s).replace(/[“”]/g, '\\"').replace(/[‘’]/g, "'");
      }
  
      
      function removeTrailingCommas(s) {
        return String(s)
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/(\{\s*),\s*(\})/g, "$1$2")
          .replace(/(\[\s*),\s*(\])/g, "$1$2");
      }
      
      function recoverLongestBalancedJsonPrefix(s) {
        const start = s.indexOf("{");
        if (start === -1) return null;
        let inString = false, escape = false, depth = 0, lastComplete = -1;
        for (let i = start; i < s.length; i++) {
          const ch = s[i];
          if (inString) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') inString = true;
          else if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) lastComplete = i;
            if (depth < 0) break;
          }
        }
        return lastComplete !== -1 ? s.slice(start, lastComplete + 1) : null;
      }
      
      // Function to extract and parse JSON from markdown code blocks
      function cleanMarkdownJson(input) {
        try {
          // Remove markdown code fences if present
          let cleaned = String(input).trim();
          const fence = cleaned.match(/```json([\s\S]*?)```/i) || cleaned.match(/```([\s\S]*?)```/);
          if (fence) {
            cleaned = fence[1].trim();
          } else {
            if (cleaned.startsWith("```json")) cleaned = cleaned.substring(7);
            else if (cleaned.startsWith("```")) cleaned = cleaned.substring(3);
            if (cleaned.endsWith("```")) cleaned = cleaned.substring(0, cleaned.length - 3);
          }
      
          // Try straight parse first (don't touch quotes yet)
          cleaned = cleaned.trim();
          return JSON.stringify(JSON.parse(cleaned), null, 2);
  
      
        } catch (error) {
          console.error("Error cleaning JSON:", error.message);
      
          // Attempt 2: naive {...} region
          try {
            const span = recoverLongestBalancedJsonPrefix(String(input));
            if (span) {
              const fixed = removeTrailingCommas(escapeSmartQuotesForJSON(span));
              return JSON.stringify(JSON.parse(fixed), null, 2);
            }
          } catch (e2) {
            console.error("Second attempt failed:", e2.message);
          }
      
          // Attempt 3 (last resort): salvage longest balanced JSON prefix
          const prefix = recoverLongestBalancedJsonPrefix(String(input));
          if (prefix) {
            try {
              const fixed = removeTrailingCommas(escapeSmartQuotesForJSON(prefix));
              return JSON.stringify(JSON.parse(fixed), null, 2);
            } catch (e3) {
              console.error("Prefix salvage failed:", e3.message);
            }
          }
  
      
          // Nothing parseable: CRASH the step
          throw new Error("Unable to extract valid JSON from the input");
        }
      }
  
      
      // Clean the JSON
      const cleanedJson = cleanMarkdownJson(json_to_clean);
      
      // Parse it to return as an object (optional - you can return the string instead)
      const jsonObject = JSON.parse(cleanedJson);
      
      // Return the cleaned JSON object
      return {
        ...steps.trigger.event,
        cleanedJson: jsonObject,
        cleanedJsonString: cleanedJson
      };
    },
  })