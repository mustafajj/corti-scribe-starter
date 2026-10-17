// `npm start [audio file]`: one recorded visit in, one SOAP note out.
//
// An ambient scribe on Corti is four calls, in order:
//   1. create an interaction (the encounter everything attaches to)
//   2. upload the recording to it
//   3. transcribe the recording
//   4. generate a note from a template, reading the interaction's transcript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createClient, explain, readConfig } from "./corti.js";
import { DEFAULT_TEMPLATE_NAME, findTemplate, listTemplates } from "./templates.js";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: "string", default: DEFAULT_TEMPLATE_NAME },
    lang: { type: "string", default: "en" },
    "output-lang": { type: "string" },
    "list-templates": { type: "boolean", default: false },
  },
});

// Transcription takes a spoken-language code ("en"); document generation takes
// a full language tag ("en-US"). Mixing them up is an easy first-run error.
const outputLanguage = opts["output-lang"] ?? (opts.lang === "en" ? "en-US" : opts.lang);

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
  const templates = await run("templates", () => listTemplates(client));
  console.log(`${templates.length} Corti templates. Use one with: npm start -- --template "<name>"\n`);
  for (const t of templates) {
    const tags = [...t.specialties, ...t.languages].join(", ");
    console.log(`  ${t.name}${tags ? `  (${tags})` : ""}`);
  }
  process.exit();
}

const audioPath = resolve(positionals[0] ?? "samples/sample-visit.wav");
if (!existsSync(audioPath)) {
  console.log(`[x] No audio file at ${audioPath}`);
  process.exit(1);
}

console.log(`Turning ${relative(process.cwd(), audioPath)} into a "${opts.template}" note\n`);
const startedAt = Date.now();
let credits = 0;

const { interactionId } = await step("1/4", "Create interaction", "POST /interactions", () =>
  client.interactions.create({
    encounter: { identifier: `scribe-starter-${Date.now()}`, status: "planned", type: "first_consultation" },
  }),
);

const { recordingId } = await step("2/4", "Upload recording", "POST /interactions/{id}/recordings", () =>
  client.recordings.upload(
    { path: audioPath, contentType: CONTENT_TYPES[extname(audioPath).toLowerCase()] },
    interactionId,
    { timeoutInSeconds: 300 },
  ),
);

const transcript = await step("3/4", "Transcribe", "POST /interactions/{id}/transcripts", () =>
  transcribe(interactionId, recordingId),
);
credits += transcript.usageInfo?.creditsConsumed ?? 0;

const template = await step("   ", "Find template", "GET /documents/templates", () => findTemplate(client, opts.template));

const { document, usageInfo } = await step("4/4", "Generate note", "POST /documents", () =>
  client.documents.generate(
    { outputLanguage, interactionId, templateRef: { templateId: template.id } },
    { timeoutInSeconds: 300 },
  ),
);
credits += usageInfo?.creditsConsumed ?? 0;

const noteText = renderNote(document);
const outDir = saveOutputs({ document, transcript, noteText, interactionId });

console.log(`\n${"=".repeat(64)}\n${noteText}${"=".repeat(64)}\n`);
console.log(`Done in ${seconds(Date.now() - startedAt)}, ${round(credits)} credits used.`);
console.log(`Saved note.md, note.json and transcript.txt to ${relative(process.cwd(), outDir)}\n`);
console.log("Next:");
console.log("  Your own recording   npm start -- path/to/visit.mp3");
console.log('  Another template     npm start -- --list-templates, then --template "<name>"');
console.log("  Real-time scribing   https://docs.corti.ai/get_started/ambient-scribe");

// Creates the transcript and waits for it if Corti is still processing it.
async function transcribe(interactionId, recordingId) {
  let result = await client.transcripts.create(
    interactionId,
    { recordingId, primaryLanguage: opts.lang, diarize: true },
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

function saveOutputs({ document, transcript, noteText, interactionId }) {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const dir = join("output", stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), noteText);
  writeFileSync(join(dir, "note.json"), JSON.stringify({ interactionId, ...document }, null, 2));
  const lines = (transcript.transcripts ?? []).map((t) => `Speaker ${t.speakerId + 1}: ${t.text}`);
  writeFileSync(join(dir, "transcript.txt"), `${lines.join("\n")}\n`);
  return dir;
}

async function step(number, label, endpoint, call) {
  const t0 = Date.now();
  process.stdout.write(`${number}  ${label.padEnd(20, ".")} `);
  const result = await run(label, call);
  const used = result?.usageInfo?.creditsConsumed;
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
