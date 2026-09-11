import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { authorize } from "./authorization.mjs";
import { atomicWrite, createIO, inspectJob, loadState, lock, stateDirectory } from "./io.mjs";
import { createScheduler } from "./scheduler.mjs";
import { initialState, policyHash, tick, validate, validateState } from "./worker.mjs";

export const SERVICE_DIRECTORY = join(homedir(), ".local/state/glue/services/gas");

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function job(record) {
  const config = validate(await readJson(record.policy));
  if (policyHash(config) !== record.policyHash)
    throw new Error("Installed policy changed. Restore it before continuing.");
  const state = await loadState(record.stateDirectory);
  if (!state)
    throw new Error("Installed job state is missing. Restore it; do not create a fresh budget.");
  validateState(config, state);
  return { config, state };
}

export async function serviceCommand(
  command,
  options = {},
  {
    directory = SERVICE_DIRECTORY,
    scheduler = createScheduler(directory),
    ioFactory = createIO,
  } = {},
) {
  const definition = join(directory, "service.json");
  const logs = join(directory, "events.json");
  let record = await readJson(definition);
  if (command === "logs") return readJson(logs, []);
  if (command === "status") {
    if (!record) return { service: "gas", installed: false };
    const events = await readJson(logs, []);
    const status = {
      service: "gas",
      ...record,
      manager: scheduler.manager,
      scheduled: await scheduler.loaded(),
      lastRun: events.at(-1) ?? null,
    };
    try {
      const { config, state } = await job(record);
      status.job = {
        chain: config.chain,
        recipient: config.recipient,
        token: config.token,
        belowEth: config.belowEth,
        amount: config.amount,
        maxSpend: config.maxSpend,
        feeReserve: config.feeReserve,
      };
      status.spent = state.spent;
      status.pending = state.pending?.key ?? null;
      status.paused = state.paused;
      status.lock = await readJson(join(record.stateDirectory, "run.lock"));
      const details = await inspectJob(state, ioFactory(config, record.stateDirectory, record));
      status.balance = details.balance;
      status.authorization = details.authority;
      if (details.errors.length) status.error = details.errors.join("; ");
    } catch (error) {
      status.error = error.message;
    }
    return status;
  }
  // Service control is separate from the payment lock so stop can interrupt a running check.
  const unlock = await lock(directory);
  try {
    record = await readJson(definition);
    if (["stop", "uninstall"].includes(command)) {
      if (!record || !record.installed) return { service: "gas", status: "not_installed" };
      record.enabled = false;
      await atomicWrite(definition, record);
      await scheduler.stop();
      if (command === "uninstall") {
        await scheduler.remove();
        record.installed = false;
        await atomicWrite(definition, record);
      }
      return {
        service: "gas",
        status: command === "stop" ? "stopped" : "uninstalled",
        stateDirectory: record.stateDirectory,
      };
    }
    if (!["install", "start"].includes(command)) throw new Error("Unknown service command.");
    if (command === "start") {
      if (!record?.installed) throw new Error("Install gas first.");
      options = { ...record, "state-dir": record.stateDirectory };
    } else if (!options["accept-network-fees"]) {
      throw new Error(
        "Installing enables payments. Supply --accept-network-fees and approve the Tempo grant.",
      );
    }
    if (!options.policy)
      throw new Error("Use glue install gas --policy FILE --accept-network-fees [--approve].");
    const policy = await realpath(options.policy);
    const config = validate(await readJson(policy));
    const stateDir = stateDirectory(policy, options["state-dir"]);
    const next = {
      version: 1,
      policy,
      policyHash: policyHash(config),
      stateDirectory: stateDir,
      intervalSeconds: config.intervalSeconds,
      ...(options.api ? { api: options.api } : {}),
      ...(options.rpc ? { rpc: options.rpc } : {}),
    };
    const different =
      record &&
      ["policy", "policyHash", "stateDirectory", "api", "rpc"].some(
        (key) => record[key] !== next[key],
      );
    if (different) {
      if (record.installed || (await scheduler.loaded()))
        throw new Error("Uninstall the existing gas service before choosing another job.");
      const previous = await job(record);
      if (previous.state.pending?.phase === "submitting")
        throw new Error("Reconcile the previous payment before replacing the service.");
      await atomicWrite(join(directory, `previous-${record.policyHash}.json`), record);
    }
    if (record && !different) await job(record);
    if (!record) {
      if (await scheduler.loaded())
        throw new Error(
          "An existing scheduler job has no Glue service record. Inspect it before installing.",
        );
      for (const file of scheduler.files) {
        const exists = await access(file).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        if (exists)
          throw new Error(`Scheduler file already exists without a Glue service record: ${file}`);
      }
    }
    const release = await lock(stateDir);
    try {
      const state = (await loadState(stateDir)) ?? initialState(config);
      validateState(config, state);
      if (config.version !== 2)
        throw new Error(
          "Local services require a native Tempo grant; create a job with --duration.",
        );
      // An existing submitted payment can finish even if its authority expired.
      if (state.pending?.phase !== "submitting") {
        const approval = await authorize(config, state, ioFactory(config, stateDir, options), {
          approve: Boolean(options.approve),
        });
        if (approval.status === "approval_required") return approval;
        await ioFactory(config, stateDir, options).verifyWallet();
      }
    } finally {
      await release();
    }
    record = { ...next, installed: true, enabled: true };
    await atomicWrite(definition, record);
    try {
      await scheduler.start(config.intervalSeconds);
    } catch (error) {
      record.enabled = false;
      await atomicWrite(definition, record);
      throw error;
    }
    return {
      service: "gas",
      status: "scheduled",
      manager: scheduler.manager,
      intervalSeconds: config.intervalSeconds,
      policy,
      stateDirectory: stateDir,
    };
  } finally {
    await unlock();
  }
}

export async function serviceTick(
  directory = SERVICE_DIRECTORY,
  { ioFactory = createIO, signal } = {},
) {
  const definition = join(directory, "service.json");
  let record = await readJson(definition);
  if (!record?.installed || !record.enabled) return { status: "stopped" };
  const started = Date.now();
  const lockedDirectory = record.stateDirectory;
  let release;
  try {
    release = await lock(lockedDirectory);
  } catch (error) {
    if (error.code === "GLUE_LOCKED") return { status: "busy", message: error.message };
    throw error;
  }
  try {
    let result;
    try {
      record = await readJson(definition);
      if (!record?.enabled || !record.installed || record.stateDirectory !== lockedDirectory)
        return { status: "stopped" };
      const { config, state } = await job(record);
      signal?.throwIfAborted();
      const io = ioFactory(config, record.stateDirectory, { ...record, signal });
      result = await tick(config, state, io, { execute: true });
    } catch (error) {
      result = { status: "error", message: error.message.slice(0, 1024) };
    }
    // Keep only the last 100 compact events, never SDK stores or payment credentials.
    const path = join(directory, "events.json");
    const events = await readJson(path, []);
    events.push({ at: new Date().toISOString(), durationMs: Date.now() - started, ...result });
    await atomicWrite(path, events.slice(-100));
    return result;
  } finally {
    await release();
  }
}
