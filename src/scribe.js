// `npm start [audio file]`: one recorded visit in, one SOAP note out.
//
// An ambient scribe on Corti is four calls, in order:
//   1. create an interaction (the encounter everything attaches to)
//   2. upload the recording to it
//   3. transcribe the recording
//   4. generate a note from a template, reading the interaction's transcript
// Optional: --facts extracts clinical facts and stores them on the interaction
// before the note is written; --codes predicts ICD-10 codes from the finished note.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createClient, explain, readConfig } from "./corti.js";
import { DEFAULT_TEMPLATE_NAME, findTemplate, listTemplates } from "./templates.js";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: "string" },
    lang: { type: "string" },
    "output-lang": { type: "string" },
    facts: { type: "boolean", default: false },
    codes: { type: "boolean", default: false },
    "code-system": { type: "string", default: "icd10cm-outpatient" },
    "list-templates": { type: "boolean", default: false },
  },
});

// Transcription takes a spoken-language code ("en"); document generation takes
// a language tag ("en-US"). Mixing them up is an easy first-run error.
const lang = opts.lang ?? "en";
const outputLanguage = opts["output-lang"] ?? (lang === "en" ? "en-US" : lang);

const CONTENT_TYPES = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

const { config, problems } = readConfig();
if (problems.length) {
  problems.forEach((p) => console.log(`[x] ${p}`));
  console.log('\nFix .env, then run "npm run check".');
  process.exit(1);
}
const client = createClient(config);

if (opts["list-templates"]) {
  const templates = await run("List templates", () => listTemplates(client, opts.lang));
  const scope = opts.lang ? ` for "${opts.lang}"` : "";
  console.log(`${templates.length} Corti templates${scope}. Use one with: npm start -- --template "<name>"\n`);
  for (const t of templates) {
    const tags = [...t.specialties, ...t.languages].join(", ");
    console.log(`  ${t.name}${tags ? `  (${tags})` : ""}`);
  }
  process.exit();
}

// The default template is English. Other languages need a template written for them.
if (lang !== "en" && !opts.template) {
  console.log(`[x] The default "${DEFAULT_TEMPLATE_NAME}" template is English.`);
  console.log(`    List templates for "${lang}" with:  npm start -- --list-templates --lang ${lang}`);
  console.log(`    Then run:  npm start -- <audio file> --lang ${lang} --template "<name>"`);
  process.exit(1);
}
const templateName = opts.template ?? DEFAULT_TEMPLATE_NAME;

const audioPath = resolve(positionals[0] ?? "samples/sample-visit.wav");
if (!existsSync(audioPath)) {
  console.log(`[x] No audio file at ${audioPath}`);
  process.exit(1);
}

const totalSteps = 4 + (opts.facts ? 2 : 0) + (opts.codes ? 1 : 0);
let stepNumber = 0;
let credits = 0;
const startedAt = Date.now();
console.log(`Turning ${relative(process.cwd(), audioPath)} into a "${templateName}" note\n`);

// Looked up first, so a wrong template name fails before any paid call.
const template = await step("Find template", "GET /documents/templates", () => findTemplate(client, templateName, lang), {
  numbered: false,
});

const { interactionId } = await step("Create interaction", "POST /interactions", () =>
  client.interactions.create({
    encounter: { identifier: `scribe-starter-${Date.now()}`, status: "planned", type: "first_consultation" },
  }),
);

const { recordingId } = await step("Upload recording", "POST /interactions/{id}/recordings", () =>
  client.recordings.upload(
    {
      path: audioPath,
      contentType: CONTENT_TYPES[extname(audioPath).toLowerCase()] ?? "application/octet-stream",
    },
    interactionId,
    { timeoutInSeconds: 300 },
  ),
);

const transcript = await step("Transcribe", "POST /interactions/{id}/transcripts", () =>
  transcribe(interactionId, recordingId),
);
const transcriptText = (transcript.transcripts ?? []).map((t) => t.text).join("\n");

let facts = [];
if (opts.facts) {
  // Extraction is stateless; storing the facts on the interaction is what lets
  // the note generation below read them alongside the transcript.
  ({ facts } = await step("Extract facts", "POST /tools/extract-facts", () =>
    client.facts.extract({ context: [{ type: "text", text: transcriptText }], outputLanguage: lang }),
  ));
  await step("Store facts", "POST /interactions/{id}/facts", () =>
    client.facts.create(interactionId, { facts: facts.map(({ text, group }) => ({ text, group })) }),
  );
}

const { document } = await step("Generate note", "POST /documents", () =>
  client.documents.generate(
    { outputLanguage, interactionId, templateRef: { templateId: template.id } },
    { timeoutInSeconds: 300 },
  ),
);
const noteText = renderNote(document);

let codes = [];
if (opts.codes) {
  ({ codes } = await step("Predict codes", "POST /tools/coding", () =>
    client.codes.predict({ system: [opts["code-system"]], context: [{ type: "text", text: noteText }] }),
  ));
}

const outDir = saveOutputs({ document, transcript, noteText, interactionId, facts, codes });

if (facts.length) {
  console.log(`\nFacts stored on the interaction (${facts.length}):`);
  for (const f of facts) console.log(`  [${f.group}] ${f.text}`);
}
console.log(`\n${"=".repeat(64)}\n${noteText}${"=".repeat(64)}`);
if (opts.codes) {
  console.log(`\nPredicted ${opts["code-system"]} codes:`);
  if (!codes.length) console.log("  (none)");
  for (const c of codes) console.log(`  ${c.code.padEnd(10)} ${c.display}`);
}
console.log(`\nDone in ${seconds(Date.now() - startedAt)}, ${round(credits)} credits used.`);
console.log(`Saved the note, transcript${facts.length ? ", facts" : ""}${opts.codes ? " and codes" : ""} to ${relative(process.cwd(), outDir)}\n`);
console.log("Next:");
console.log("  Your own recording    npm start -- path/to/visit.mp3");
console.log("  Facts and codes       npm start -- --facts --codes");
console.log('  Another template      npm start -- --list-templates, then --template "<name>"');
console.log("  Real-time scribing    https://docs.corti.ai/get_started/ambient-scribe");

// Creates the transcript and waits for it if Corti is still processing it.
async function transcribe(interactionId, recordingId) {
  let result = await client.transcripts.create(
    interactionId,
    { recordingId, primaryLanguage: lang, diarize: true },
    { timeoutInSeconds: 300 },
  );
  const deadline = Date.now() + 10 * 60_000;
  while (result.status === "processing") {
    if (Date.now() > deadline) throw new Error("Transcription is still processing after 10 minutes.");
    await sleep(2000);
    const { status } = await client.transcripts.getStatus(interactionId, result.id);
    if (status !== "processing") result = await client.transcripts.get(interactionId, result.id);
  }
  if (result.status === "failed") throw new Error("Corti could not transcribe this recording.");
  return result;
}

// Sections come back keyed by ID; the `sections` array gives their headings and order.
function renderNote(document) {
  const lines = [`# ${document.name}`, ""];
  for (const { sectionId, heading } of document.sections ?? []) {
    const body = document.stringDocument[sectionId]?.trim();
    lines.push(`## ${heading}`, body || "(nothing documented)", "");
  }
  return lines.join("\n");
}

function saveOutputs({ document, transcript, noteText, interactionId, facts, codes }) {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const dir = join("output", stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), noteText);
  writeFileSync(join(dir, "note.json"), JSON.stringify({ interactionId, ...document }, null, 2));
  const lines = (transcript.transcripts ?? []).map((t) => `Speaker ${t.speakerId + 1}: ${t.text}`);
  writeFileSync(join(dir, "transcript.txt"), `${lines.join("\n")}\n`);
  if (facts.length) writeFileSync(join(dir, "facts.json"), JSON.stringify(facts, null, 2));
  if (codes.length) writeFileSync(join(dir, "codes.json"), JSON.stringify(codes, null, 2));
  return dir;
}

async function step(label, endpoint, call, { numbered = true } = {}) {
  const number = numbered ? `${++stepNumber}/${totalSteps}` : "   ";
  const t0 = Date.now();
  process.stdout.write(`${number}  ${label.padEnd(20, ".")} `);
  const result = await run(label, call);
  const used = result?.usageInfo?.creditsConsumed;
  credits += used ?? 0;
  const cost = used == null ? "" : `${round(used)} credits`;
  console.log(`${seconds(Date.now() - t0).padStart(6)}  ${cost.padEnd(14)} ${endpoint}`);
  return result;
}

async function run(label, call) {
  try {
    return await call();
  } catch (error) {
    console.log(`\n\n[x] ${label} failed: ${explain(error, config)}`);
    console.log('    Run "npm run check" to test your setup.');
    process.exit(1);
  }
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
