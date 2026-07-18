import { describe, expect, it } from "vitest";

import {
  readBoundedRequestBody,
  WorkerRequestTooLargeError,
} from "./worker-api";

describe("worker request boundary", () => {
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
