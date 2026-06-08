export * from "./config.js";
export * from "./httpServer.js";
export * from "./taskManager.js";

import { createDaemon, type StartedDaemon } from "./httpServer.js";

export async function startDaemonCli(): Promise<StartedDaemon> {
  const daemon = await createDaemon();
  console.log(`CCAgent daemon listening on ${daemon.baseUrl}`);

  const stop = async () => {
    await daemon.stop();
  };

  process.once("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  return daemon;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startDaemonCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
