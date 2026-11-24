import { readFileSync } from "node:fs";

/** 版本唯一来源：package.json。 */
export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
