const workerPort = process.env.RELAY_LOCAL_WORKER_PORT ?? "3213";
const workerUrl = `http://127.0.0.1:${workerPort}/health`;
const deadline = Date.now() + 120_000;

while (Date.now() < deadline) {
  try {
    const response = await fetch(workerUrl);
    if (response.ok) {
      const health = await response.json();
      if (
        health.componentBuilds === "running" &&
        health.authoring === "running" &&
        health.narration === "running" &&
        health.projectRendering === "running" &&
        health.componentLoop === "ready"
      ) {
        process.exit(0);
      }
    }
  } catch {
    // The local worker has not opened its loopback listener yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

throw new Error("Local Relay worker did not become ready within 120 seconds.");
