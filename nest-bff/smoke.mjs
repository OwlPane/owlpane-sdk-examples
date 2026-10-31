import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "README.md"), "utf8");
if (!readme.includes("OwlpaneModule") || !readme.includes("@owlpane/node/nest")) {
  console.error("nest-bff README is missing the OwlpaneModule onboarding path");
  process.exit(1);
}
console.log("nest-bff smoke ok");
