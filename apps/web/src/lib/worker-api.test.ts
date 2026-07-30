import { describe, expect, it } from "vitest";

import {
  readBoundedRequestBody,
  resolveWorkerConfiguration,
  WorkerRequestTooLargeError,
} from "./worker-api";

describe("worker request boundary", () => {
  it("requires an explicit worker URL and keeps tokens server-side", () => {
    expect(resolveWorkerConfiguration({})).toEqual({ enabled: false });
    expect(
      resolveWorkerConfiguration({
        RELAY_WORKER_URL: " http://127.0.0.1:3213 ",
        RELAY_WORKER_AUTH_TOKEN: " local-token ",
      }),
    ).toEqual({
      enabled: true,
      baseUrl: "http://127.0.0.1:3213",
      authToken: "local-token",
    });
  });

  it("reads request bodies only within the configured byte limit", async () => {
    await expect(
      readBoundedRequestBody(
        new Request("http://relay.local", {
          method: "POST",
          body: "éé",
        }),
        4,
      ),
    ).resolves.toBe("éé");
  });

  it("rejects declared and streamed bodies before forwarding them", async () => {
    const declared = new Request("http://relay.local", {
      method: "POST",
      body: "small",
      headers: { "content-length": "100" },
    });
    const streamed = new Request("http://relay.local", {
      method: "POST",
      body: "six!!!",
    });

    await expect(readBoundedRequestBody(declared, 10)).rejects.toBeInstanceOf(
      WorkerRequestTooLargeError,
    );
    await expect(readBoundedRequestBody(streamed, 5)).rejects.toBeInstanceOf(
      WorkerRequestTooLargeError,
    );
  });
});
