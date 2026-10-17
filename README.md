# Corti Scribe Starter

From a recorded clinical visit to a structured SOAP note through [Corti's APIs](https://docs.corti.ai), one command per run.

```
     Find template.......   0.7s                 GET /documents/templates
1/4  Create interaction..   0.3s                 POST /interactions
2/4  Upload recording....   0.9s                 POST /interactions/{id}/recordings
3/4  Transcribe..........   3.6s  0.007 credits  POST /interactions/{id}/transcripts
4/4  Generate note.......   3.6s  0.074 credits  POST /documents
```

AI Studio shows that an ambient scribe works. This starter shows the same thing working in your own code: the four API calls a scribe needs, in order, with the setup details handled for you. Add `--facts` and `--codes` to include clinical facts and ICD-10 codes.

> Unofficial starter built on Corti's public SDK for a product marketing case study. Not maintained by Corti.

## Quick start (about 5 minutes)

You need Node.js 20.12 or later and a Corti account. Sign up at [console.corti.app](https://console.corti.app) (it comes with $50 of free credits).

1. In AI Studio, create an API client. Note its **client ID**, **client secret** and your project's **region** (`eu` or `us`). The **tenant name** is usually `base`; AI Studio may not show it, and `npm run check` will tell you if it's wrong.
2. Install and add your credentials:

   ```bash
   npm install
   cp .env.example .env
   ```

   Then open `.env` and fill in the values.
3. Check your setup, then run the sample visit:

   ```bash
   npm run check
   npm start
   ```

You get the SOAP note in your terminal, plus `note.md`, `note.json` and `transcript.txt` in `output/<timestamp>/`.

## Options

| Command | What it does |
| --- | --- |
| `npm start -- path/to/visit.mp3` | Uses your own recording (wav, mp3, m4a, webm, ogg, flac) |
| `npm start -- --facts` | Extracts clinical facts, stores them on the interaction, then writes the note from transcript and facts |
| `npm start -- --codes` | Predicts ICD-10-CM codes from the finished note. Pick another system with `--code-system`, e.g. `cpt` |
| `npm start -- --list-templates --lang de` | Lists Corti's standard templates, optionally for one language |
| `npm start -- visit.mp3 --lang de --template "<name>"` | Transcribes another language and writes the note with a template in that language |

The default template, "SOAP (comprehensive)", is English. For other languages, pick a template from `--list-templates --lang <code>`.

Use test recordings only, until your organization has the right agreements with Corti in place for patient data.

## What the code does

[`src/scribe.js`](src/scribe.js) makes these calls with the official [`@corti/sdk`](https://www.npmjs.com/package/@corti/sdk):

| Step | SDK call | Why |
| --- | --- | --- |
| lookup | `client.documents.templates.list()` | Finds the template's ID from its name, before any paid call |
| 1 | `client.interactions.create()` | The encounter that the recording, transcript, facts and note attach to |
| 2 | `client.recordings.upload()` | Sends the audio file |
| 3 | `client.transcripts.create()` | Transcribes it, separating speakers (`diarize: true`) |
| `--facts` | `client.facts.extract()`, then `client.facts.create()` | Pulls clinical facts from the transcript and stores them so the note can use them |
| 4 | `client.documents.generate()` | Writes the note from everything on the interaction, using the template |
| `--codes` | `client.codes.predict()` | Suggests codes from the note's text |

## What it handles for you

These are the places a first scribe build tends to stall:

- **Credentials.** `npm run check` tests them on their own and tells you which value to fix.
- **Template IDs.** Notes need a template ID. The starter looks it up by name in Corti's standard templates. These are the guided templates in `client.documents.templates`, not the older `client.templates`.
- **Language codes.** Transcription takes `en`; document generation takes a tag like `en-US`.
- **Section order.** The note comes back keyed by section ID. The starter prints sections in template order using the `sections` list.
- **Waiting.** Short recordings come back transcribed in one call. If Corti is still processing, the starter polls until the transcript is ready.

## Cost

In testing, the 66-second sample used 0.081 credits for a plain run (0.007 to transcribe, 0.074 for the note) and 0.111 with `--facts --codes`. Each step's cost prints as it runs. See [pricing](https://corti.ai/pricing).

## The sample visit

`samples/sample-visit.wav` is a fictional 66-second visit (a patient with a cough, fever and a penicillin allergy), spoken by the two voices built into Windows. It contains no patient data. It's clean, synthetic audio, so it shows the flow working, not how accuracy holds up on real recordings. Try your own. [`samples/sample-note.md`](samples/sample-note.md) is the note it produced in testing. To regenerate the audio, run `samples/make-sample.ps1`.

## Going further

- **Real-time scribing.** Stream audio during the visit instead of uploading it afterwards: [ambient scribe guide](https://docs.corti.ai/get_started/ambient-scribe).
- **Clinician review.** Let clinicians confirm or discard facts before the note is written: same guide.
- **A ready-made UI.** Embed Corti's scribe instead of building screens: [Embedded Assistant](https://docs.corti.ai/assistant/welcome).

## Notes

- Keep your client secret on the server side. Never call Corti from a browser with it.
- Each API request carries an `X-Corti-Analytics` header naming this starter, so its use can be counted. To opt out, remove the `analytics` option in [`src/corti.js`](src/corti.js).

## License

MIT
