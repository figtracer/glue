import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteText } from "./io.mjs";

const exec = promisify(execFile);
const xml = (value) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c],
  );
const unitArg = (value) =>
  '"' +
  value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", () => "$$") +
  '"';

// Only user services are installed. Arguments are passed directly, never through a shell.
export function createScheduler(
  directory,
  {
    platform = process.platform,
    home = homedir(),
    uid = process.getuid?.(),
    label = "com.figtracer.glue.gas",
    node = process.execPath,
    cli = fileURLToPath(new URL("./cli.mjs", import.meta.url)),
    run = (command, args) => exec(command, args, { timeout: 30000, maxBuffer: 128 * 1024 }),
  } = {},
) {
  if (!["darwin", "linux"].includes(platform))
    throw new Error("Local services support macOS and Linux.");
  const args = [node, cli, "service-tick", "--service-dir", directory];
  // Unit files cannot safely represent embedded control characters.
  // eslint-disable-next-line no-control-regex
  if (args.some((value) => /[\x00-\x1f\x7f]/.test(value)))
    throw new Error("Service paths cannot contain control characters.");
  const folder =
    platform === "darwin" ? join(home, "Library/LaunchAgents") : join(home, ".config/systemd/user");
  const plist = join(folder, `${label}.plist`);
  const service = join(folder, `${label}.service`);
  const timer = join(folder, `${label}.timer`);
  const target = `gui/${uid}/${label}`;
  async function loaded() {
    if (platform === "darwin") {
      try {
        await run("/bin/launchctl", ["print", target]);
        return true;
      } catch (error) {
        if (error.code === 113 || /Could not find service/.test(error.stderr ?? "")) return false;
        throw error;
      }
    }
    const { stdout } = await run("/usr/bin/systemctl", [
      "--user",
      "show",
      `${label}.timer`,
      "--property=ActiveState",
    ]);
    return stdout.trim() === "ActiveState=active";
  }
  return {
    manager: platform === "darwin" ? "launchd" : "systemd",
    files: platform === "darwin" ? [plist] : [service, timer],
    loaded,
    async start(interval) {
      if (await loaded()) return;
      await mkdir(folder, { recursive: true, mode: 0o700 });
      if (platform === "darwin") {
        await atomicWriteText(
          plist,
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>${interval}</integer>
<key>ExitTimeOut</key><integer>45</integer>
<key>Umask</key><integer>63</integer>
</dict></plist>
`,
        );
        await run("/bin/launchctl", ["enable", target]);
        await run("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist]);
      } else {
        await atomicWriteText(
          service,
          `[Unit]
Description=Glue gas balance check and refill

[Service]
Type=oneshot
ExecStart=${args.map(unitArg).join(" ")}
UMask=0077
TimeoutStartSec=5min
TimeoutStopSec=45s
`,
        );
        await atomicWriteText(
          timer,
          `[Unit]
Description=Check gas with Glue

[Timer]
OnActiveSec=1s
OnUnitInactiveSec=${interval}s
AccuracySec=1s

[Install]
WantedBy=timers.target
`,
        );
        await run("/usr/bin/systemctl", ["--user", "daemon-reload"]);
        await run("/usr/bin/systemctl", ["--user", "enable", "--now", `${label}.timer`]);
      }
    },
    async stop() {
      if (platform === "darwin") {
        await run("/bin/launchctl", ["disable", target]);
        if (await loaded()) await run("/bin/launchctl", ["bootout", target]);
      } else {
        await run("/usr/bin/systemctl", ["--user", "disable", "--now", `${label}.timer`]);
        await run("/usr/bin/systemctl", ["--user", "stop", `${label}.service`]);
      }
    },
    async remove() {
      for (const file of this.files) await rm(file, { force: true });
      if (platform === "linux") await run("/usr/bin/systemctl", ["--user", "daemon-reload"]);
    },
  };
}
