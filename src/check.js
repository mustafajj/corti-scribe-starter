// `npm run check`: confirms .env is filled in, the credentials work and the SOAP
// template is reachable, before you spend credits on a full run.
import { checkAuth, createClient, explain, readConfig } from "./corti.js";
import { DEFAULT_TEMPLATE_NAME, findTemplate } from "./templates.js";

const ok = (text) => console.log(`  [ok] ${text}`);
const fail = (text) => {
  console.log(`  [x]  ${text}`);
  process.exitCode = 1;
};

console.log("Checking your Corti setup\n");

const { config, problems } = readConfig();
if (problems.length) {
  problems.forEach(fail);
  console.log('\nFill these in .env (copy .env.example to .env if you don\'t have one), then run "npm run check" again.');
  process.exit();
}

ok(`.env has a client ID (${mask(config.clientId)}) and a client secret`);
ok(`Region "${config.environment}", tenant "${config.tenantName}"`);

try {
  await checkAuth(config);
  ok("Corti accepted the credentials");
} catch (error) {
  fail(explain(error, config, "auth"));
  process.exit();
}

try {
  const template = await findTemplate(createClient(config), DEFAULT_TEMPLATE_NAME);
  ok(`Template "${template.name}" is available (${template.id})`);
} catch (error) {
  fail(explain(error, config, "templates"));
  process.exit();
}

console.log('\nReady. Run "npm start" to turn the sample visit into a SOAP note.');

function mask(value) {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}...${value.slice(-4)}`;
}
