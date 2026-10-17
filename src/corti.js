// Shared setup for `npm run check` and `npm start`: reads credentials from .env,
// builds the SDK client, and turns common API errors into plain-language fixes.
import { CortiAuth, CortiClient, CortiEnvironment, CortiError } from "@corti/sdk";

// Load .env if there is one. process.loadEnvFile needs Node.js 20.12 or later.
if (typeof process.loadEnvFile !== "function") {
  console.log(`This starter needs Node.js 20.12 or later (you have ${process.version}).`);
  process.exit(1);
}
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const ENVIRONMENTS = { eu: CortiEnvironment.Eu, us: CortiEnvironment.Us };

export function readConfig() {
  const config = {
    clientId: process.env.CORTI_CLIENT_ID?.trim(),
    clientSecret: process.env.CORTI_CLIENT_SECRET?.trim(),
    // Most AI Studio projects use the tenant "base".
    tenantName: process.env.CORTI_TENANT_NAME?.trim() || "base",
    environment: (process.env.CORTI_ENVIRONMENT?.trim() || "eu").toLowerCase(),
  };

  const problems = [];
  if (!config.clientId) {
    problems.push("CORTI_CLIENT_ID is empty. Copy it from AI Studio > API clients.");
  }
  if (!config.clientSecret) {
    problems.push("CORTI_CLIENT_SECRET is empty. It's on the same API client page; reveal it and copy it.");
  }
  if (!ENVIRONMENTS[config.environment]) {
    problems.push(`CORTI_ENVIRONMENT is "${config.environment}". Use "eu" or "us", the region you picked when you created the project.`);
  }
  return { config, problems };
}

export function createClient(config) {
  return new CortiClient({
    environment: ENVIRONMENTS[config.environment],
    tenantName: config.tenantName,
    auth: { clientId: config.clientId, clientSecret: config.clientSecret },
    // Tags every API request so Corti can count starter runs. No patient data is sent here.
    analytics: { integration: "scribe-starter", workflow: "ambient-scribe" },
  });
}

// Fetches a token on its own, so a credentials problem is reported as one
// instead of surfacing later as a confusing error from another endpoint.
export async function checkAuth(config) {
  const auth = new CortiAuth({ environment: ENVIRONMENTS[config.environment], tenantName: config.tenantName });
  await auth.getToken({ clientId: config.clientId, clientSecret: config.clientSecret });
}

export function explain(error, config, step) {
  const where = `region "${config.environment}", tenant "${config.tenantName}"`;

  if (!(error instanceof CortiError)) {
    const cause = error?.cause?.code || error?.code;
    if (cause === "ENOTFOUND" || cause === "ECONNREFUSED" || cause === "ETIMEDOUT") {
      return `Couldn't reach Corti (${cause}). Check your internet connection or proxy.`;
    }
    return error?.message || String(error);
  }

  const status = error.statusCode;
  const detail = summarizeBody(error.body);

  if (step === "auth") {
    if (status === 404) {
      return `Corti couldn't find tenant "${config.tenantName}" in the ${config.environment.toUpperCase()} region. Check CORTI_TENANT_NAME (usually "base") and CORTI_ENVIRONMENT.`;
    }
    if (status === 400 || status === 401) {
      return `Corti rejected the client ID or secret (${where}). Re-copy both from AI Studio without quotes or spaces, and make sure CORTI_ENVIRONMENT matches the project's region.`;
    }
  }
  if (status === 401) return `Your token was rejected (${where}). Run "npm run check".`;
  if (status === 403) return `These credentials can't call this endpoint (${where}).${detail}`;
  if (status === 402) return `Corti says payment is required: your credits may be used up.${detail}`;
  if (status === 429) return `Rate limited by Corti. Wait a moment and try again.${detail}`;
  if (status >= 500) return `Corti returned a server error (${status}). Try again in a minute.${detail}`;
  return `Corti returned ${status}.${detail}`;
}

function summarizeBody(body) {
  if (!body) return "";
  const text = typeof body === "string" ? body : body.detail || body.message || body.title || JSON.stringify(body);
  return ` Details: ${String(text).slice(0, 300)}`;
}
