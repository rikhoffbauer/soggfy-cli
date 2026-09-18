import { SpotifyInstance } from "../../../src/core/instance.ts";

const socketPath = process.env.SOGGFY_INVESTIGATION_SOCKET ?? "/tmp/soggfy130.sock";
const savePath = process.env.SOGGFY_INVESTIGATION_SAVE ?? "/Volumes/ssd1/tmp/soggfy130-save";
const profilePath = process.env.SOGGFY_INVESTIGATION_PROFILE ?? "/Volumes/ssd1/tmp/soggfy130-profile";
const appPath = process.env.SOGGFY_INVESTIGATION_APP ?? "/Volumes/ssd1/tmp/Spotify-1.3.0.277-Soggfy.app";
const debugPort = Number(process.env.SOGGFY_INVESTIGATION_CDP ?? "9231");

const instance = new SpotifyInstance(socketPath, savePath, profilePath, {
  appPath,
  debugPort,
});

await instance.start();
console.log(JSON.stringify({
  ready: true,
  pid: instance.process?.pid,
  socket: instance.socketPath,
  profile: instance.profileDir,
  save: instance.savePath,
  debugPort,
}));

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await instance.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (true) await Bun.sleep(60_000);
