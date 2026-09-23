// Regenerates the policy block in the roles migration from src/lib/roles-core.ts.
// Run: npm run gen:policies   (Node 22+, uses --experimental-strip-types)
import { readFileSync, writeFileSync } from "node:fs";
import { buildRolePolicySql } from "../src/lib/roles-core.ts";

const FILE = new URL("../supabase/migrations/20260923140100_roles_audit.sql", import.meta.url);
const BEGIN = "-- BEGIN GENERATED (roles-core.ts)\n";
const END = "-- END GENERATED (roles-core.ts)";

const src = readFileSync(FILE, "utf8");
const a = src.indexOf(BEGIN);
const b = src.indexOf(END);
if (a < 0 || b < a) throw new Error("generated block markers not found");
writeFileSync(FILE, src.slice(0, a + BEGIN.length) + buildRolePolicySql() + src.slice(b));
console.log("policy block regenerated");
