import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SOAK_MS = 7 * 24 * 60 * 60 * 1000;
export function requireMature(name, timestamp, now = Date.now()) {
  const published = Date.parse(timestamp);
  if (!Number.isFinite(published) || now - published < SOAK_MS)
    throw new Error(
      `${name}: release date is missing or less than seven days old (${timestamp ?? "unknown"}).`,
    );
}
async function json(url, github = false) {
  const response = await fetch(url, {
    headers:
      github && process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {},
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Metadata unavailable: ${url} (${response.status}).`);
  return response.json();
}
export async function checkDependencies() {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const packages = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = path.split("node_modules/").at(-1);
    if (
      !entry.version ||
      !entry.integrity ||
      !entry.resolved ||
      new URL(entry.resolved).origin !== "https://registry.npmjs.org"
    )
      throw new Error(`Unverifiable registry dependency: ${path}.`);
    packages.set(`${name}@${entry.version}`, { name, ...entry });
  }
  for (const [id, entry] of packages) {
    const metadata = await json(`https://registry.npmjs.org/${encodeURIComponent(entry.name)}`);
    requireMature(id, metadata.time?.[entry.version]);
    if (metadata.versions?.[entry.version]?.dist?.integrity !== entry.integrity)
      throw new Error(`Registry integrity differs for ${id}.`);
  }
  for (const file of await readdir(".github/workflows")) {
    if (!/\.ya?ml$/.test(file)) continue;
    const yaml = await readFile(`.github/workflows/${file}`, "utf8");
    for (const [, use, comment] of yaml.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)\s*(?:#\s*(.*))?$/gm)) {
      const match = /^(actions\/[\w-]+)@([a-f0-9]{40})$/.exec(use);
      const tag = /^v[\d.]+$/.test(comment?.trim() ?? "") ? comment.trim() : null;
      if (!match || !tag)
        throw new Error(`Expected GitHub-owned Action, full SHA and release comment: ${use}.`);
      const [, repo, sha] = match;
      const commit = await json(`https://api.github.com/repos/${repo}/commits/${sha}`, true);
      requireMature(use, commit.commit?.committer?.date);
      const release = await json(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, true);
      requireMature(`${repo} ${tag}`, release.published_at);
      const tagged = await json(`https://api.github.com/repos/${repo}/commits/${tag}`, true);
      if (tagged.sha !== sha)
        throw new Error(`Action ${repo} release comment does not match its pinned SHA.`);
    }
  }
  console.log(`Seven-day soak passed for ${packages.size} locked packages and workflow Actions.`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkDependencies();
}
