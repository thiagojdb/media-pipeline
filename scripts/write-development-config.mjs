import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const convexUrl = new URL(input.convexUrl);
if (
  convexUrl.protocol !== "https:" ||
  !convexUrl.hostname.endsWith(".convex.cloud")
) {
  throw new Error("convexUrl must be a hosted Convex URL.");
}
if (
  typeof input.projectsServerToken !== "string" ||
  input.projectsServerToken.length < 20
) {
  throw new Error("projectsServerToken is invalid.");
}

const directory = path.join(os.homedir(), ".config", "relay");
const target = path.join(directory, "development.env");
const temporary = `${target}.${process.pid}.tmp`;
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  temporary,
  [
    `CONVEX_URL=${convexUrl.origin}`,
    `NEXT_PUBLIC_CONVEX_URL=${convexUrl.origin}`,
    `PROJECTS_CONVEX_URL=${convexUrl.origin}`,
    `PROJECTS_SERVER_TOKEN=${input.projectsServerToken}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
await rename(temporary, target);
console.log(target);
