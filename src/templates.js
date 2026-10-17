// Notes are generated from a template, referenced by ID. This finds a Corti
// standard template by its name, so you never have to copy an ID around.

export const DEFAULT_TEMPLATE_NAME = "SOAP (comprehensive)";

// ID of the Corti standard "SOAP (comprehensive)" template, as seen in AI Studio.
// Only used if the template list can't be read.
const FALLBACK_SOAP_TEMPLATE_ID = "f901c06a-70db-59f6-8d0a-0a4bef4b8c77";

export async function listTemplates(client) {
  const templates = await client.documents.templates.list({ source: "corti", published: true });
  return [...templates].sort((a, b) => a.name.localeCompare(b.name));
}

export async function findTemplate(client, name) {
  const wanted = name.trim().toLowerCase();
  let templates;
  try {
    templates = await listTemplates(client);
  } catch (error) {
    if (wanted === DEFAULT_TEMPLATE_NAME.toLowerCase()) {
      return { id: FALLBACK_SOAP_TEMPLATE_ID, name: DEFAULT_TEMPLATE_NAME };
    }
    throw error;
  }

  const match =
    templates.find((t) => t.name.trim().toLowerCase() === wanted) ??
    templates.find((t) => t.name.toLowerCase().includes(wanted));
  if (match) return match;

  throw new Error(`No Corti template is named "${name}". Run "npm start -- --list-templates" to see the options.`);
}
