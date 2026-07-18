import { createWorkerServer } from "./server.js";

const port = Number.parseInt(process.env.WORKER_PORT ?? "3212", 10);
const server = createWorkerServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`Relay worker ready at http://127.0.0.1:${port}/health`);
});

let shuttingDown = false;

const shutdown = (): void => {
  if (shuttingDown || !server.listening) {
    return;
  }

  shuttingDown = true;
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
