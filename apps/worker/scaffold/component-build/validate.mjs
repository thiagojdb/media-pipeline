import { readFile, readdir, writeFile } from "node:fs/promises";

const source = await readFile("/workspace/candidate-source.tsx", "utf8");
if (!source.trim()) throw new Error("Candidate source is empty.");
if (source.includes("FIXTURE_CRASH")) process.abort();
if (source.includes("FIXTURE_TIMEOUT")) await new Promise(() => undefined);
if (source.includes("FIXTURE_INVALID")) {
  console.error("candidate-source.tsx: deterministic invalid fixture");
  process.exit(2);
}
if (source.includes("ISOLATION_PROBE")) {
  if (process.env.RELAY_ISOLATION_PROBE_SECRET)
    throw new Error("Parent environment leaked into the sandbox.");
  const rootEntries = await readdir("/");
  if (rootEntries.includes("home") || rootEntries.includes("root"))
    throw new Error("Host home directories are visible in the sandbox.");
  await expectFailure(() =>
    writeFile("/workspace/sandbox-write-probe", "forbidden"),
  );
  await writeFile("/host-write-probe", "sandbox namespace only");
  await expectFailure(() =>
    fetch("http://1.1.1.1", { signal: AbortSignal.timeout(500) }),
  );
  console.log("isolation probes passed");
}
console.log("candidate source validated");

async function expectFailure(operation) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error("Isolation probe unexpectedly succeeded.");
}
