import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPONSORS_PATH = resolve(__dirname, "..", "sponsors.json");

const VALID_TIERS = ["bronze", "silver", "gold"];
const TIERS_REQUIRING_TEXT = ["silver", "gold"];
const NAME_MAX_LENGTH = 20;
const TEXT_MAX_LENGTH = 30;
const SINCE_PATTERN = /^\d{4}-\d{2}$/;

function validate() {
  let raw;
  try {
    raw = readFileSync(SPONSORS_PATH, "utf-8");
  } catch (err) {
    fail(`Could not read sponsors.json: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON: ${err.message}`);
  }

  // Top-level required fields
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) {
    fail('"version" must be an integer');
  }

  if (typeof data.updated !== "string") {
    fail('"updated" must be a string');
  }

  if (!Array.isArray(data.sponsors)) {
    fail('"sponsors" must be an array');
  }

  const seenNames = new Set();

  for (let i = 0; i < data.sponsors.length; i++) {
    const sponsor = data.sponsors[i];
    const prefix = `sponsors[${i}]`;

    // name — required, string, maxLength 20
    if (typeof sponsor.name !== "string") {
      fail(`${prefix}: "name" is required and must be a string`);
    }
    if (sponsor.name.length > NAME_MAX_LENGTH) {
      fail(
        `${prefix}: "name" exceeds max length of ${NAME_MAX_LENGTH} (got ${sponsor.name.length})`
      );
    }

    // duplicate name check
    const nameLower = sponsor.name.toLowerCase();
    if (seenNames.has(nameLower)) {
      fail(`${prefix}: duplicate sponsor name "${sponsor.name}"`);
    }
    seenNames.add(nameLower);

    // tier — required, enum
    if (typeof sponsor.tier !== "string") {
      fail(`${prefix}: "tier" is required and must be a string`);
    }
    if (!VALID_TIERS.includes(sponsor.tier)) {
      fail(
        `${prefix}: "tier" must be one of [${VALID_TIERS.join(", ")}] (got "${sponsor.tier}")`
      );
    }

    // since — required, pattern YYYY-MM
    if (typeof sponsor.since !== "string") {
      fail(`${prefix}: "since" is required and must be a string`);
    }
    if (!SINCE_PATTERN.test(sponsor.since)) {
      fail(
        `${prefix}: "since" must match YYYY-MM pattern (got "${sponsor.since}")`
      );
    }

    // text — optional, string, maxLength 30
    if (sponsor.text !== undefined) {
      if (typeof sponsor.text !== "string") {
        fail(`${prefix}: "text" must be a string`);
      }
      if (sponsor.text.length > TEXT_MAX_LENGTH) {
        fail(
          `${prefix}: "text" exceeds max length of ${TEXT_MAX_LENGTH} (got ${sponsor.text.length})`
        );
      }
    }

    // silver/gold MUST have text
    if (TIERS_REQUIRING_TEXT.includes(sponsor.tier) && !sponsor.text) {
      fail(
        `${prefix}: "${sponsor.tier}" tier sponsors must have a "text" field`
      );
    }

    // url — optional, string
    if (sponsor.url !== undefined && typeof sponsor.url !== "string") {
      fail(`${prefix}: "url" must be a string`);
    }
  }

  console.log(
    `\u2713 sponsors.json is valid (${data.sponsors.length} sponsors)`
  );
  process.exit(0);
}

function fail(message) {
  console.error(`\u2717 Validation error: ${message}`);
  process.exit(1);
}

validate();
