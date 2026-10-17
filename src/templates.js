// Notes are generated from a template, referenced by ID. This finds a Corti
// standard template by its name, so you never have to copy an ID around.

export const DEFAULT_TEMPLATE_NAME = "SOAP (comprehensive)";

// ID of the Corti standard "SOAP (comprehensive)" template, as seen in AI Studio.
// Only used if the template list can't be read.
const FALLBACK_SOAP_TEMPLATE_ID = "f901c06a-70db-59f6-8d0a-0a4bef4b8c77";

// Templates tagged for a language, plus untagged ones (no language-specific tweaks).
// "en" matches "en", "en-US" and "en-GB".
export function supportsLanguage(template, lang) {
  if (!lang || template.languages.length === 0) return true;
  const base = lang.toLowerCase().split("-")[0];
  return template.languages.some((l) => l.toLowerCase() === lang.toLowerCase() || l.toLowerCase().split("-")[0] === base);
}

export async function listTemplates(client, lang) {
  const templates = await client.documents.templates.list({ source: "corti", published: true });
  return [...templates].filter((t) => supportsLanguage(t, lang)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function findTemplate(client, name, lang) {
  const wanted = name.trim().toLowerCase();
  let templates;
  try {
    templates = await listTemplates(client, lang);
  } catch (error) {
    if (wanted === DEFAULT_TEMPLATE_NAME.toLowerCase()) {
      return { id: FALLBACK_SOAP_TEMPLATE_ID, name: DEFAULT_TEMPLATE_NAME, fallback: true };
    }
    throw error;
  }

  const match =
    templates.find((t) => t.name.trim().toLowerCase() === wanted) ??
    templates.find((t) => t.name.toLowerCase().includes(wanted));
  if (match) return match;

  const hint = lang ? ` -- --list-templates --lang ${lang}` : " -- --list-templates";
  throw new Error(`No Corti template${lang ? ` for "${lang}"` : ""} is named "${name}". Run "npm start${hint}" to see the options.`);
}
