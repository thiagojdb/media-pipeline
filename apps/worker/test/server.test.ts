import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createWorkerServer } from "../src/server.js";

const servers = new Set<ReturnType<typeof createWorkerServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  servers.clear();
});

describe("worker health endpoint", () => {
  it("reports the worker boundary as ready", async () => {
    const server = createWorkerServer().listen(0, "127.0.0.1");
    servers.add(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "relay-worker",
      status: "ready",
    });
  });
});
