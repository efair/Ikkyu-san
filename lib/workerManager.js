"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { ObjectId } = require("mongodb");
const { WORKERS, findWorker, workerByScript } = require("./workerCatalog");
const { runAudit, verdict } = require("./siteAudit");

class WorkerManager {
  constructor(db, rootDir) {
    this.db = db;
    this.rootDir = rootDir;
    this.runs = db.collection("worker_runs");
    this.audits = db.collection("worker_audits");
    this.jobs = db.collection("scrape_jobs");
    this.active = new Map();
    this.auditing = new Map();
  }

  async init() {
    await this.runs.createIndex({ workerId: 1, startedAt: -1 });
    await this.audits.createIndex({ workerId: 1, startedAt: -1 });
    const hanging = await this.runs.find({ status: { $in: ["starting", "running", "stopping"] } }).toArray();
    for (const run of hanging) {
      if (run.pid && this.pidAlive(run.pid)) {
        this.active.set(run.workerId, { pid: run.pid, runId: String(run._id), adopted: true });
        continue;
      }
      await this.runs.updateOne(
        { _id: run._id },
        { $set: { status: "stopped", finishedAt: new Date(), summary: "پس از راه‌اندازی مجدد پنل متوقف دیده شد" } }
      );
    }
    await this.discoverExternal();
  }

  pidAlive(pid) {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return Boolean(err && err.code === "EPERM");
    }
  }

  listNodeProcesses() {
    return new Promise((resolve) => {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ],
        { windowsHide: true, timeout: 8000 },
        (err, stdout) => {
          if (err || !stdout) return resolve([]);
          try {
            const parsed = JSON.parse(stdout);
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            resolve(rows.filter((row) => row && row.ProcessId));
          } catch {
            resolve([]);
          }
        }
      );
    });
  }

  async discoverExternal() {
    const procs = await this.listNodeProcesses();
    const known = new Set([...this.active.values()].map((row) => row.pid));
    for (const proc of procs) {
      const cmd = String(proc.CommandLine || "");
      if (/panel\.js/i.test(cmd)) continue;
      const worker = workerByScript(cmd);
      if (!worker) continue;
      const pid = Number(proc.ProcessId);
      if (!pid || pid === process.pid || known.has(pid)) continue;
      if (this.active.has(worker.id) && this.pidAlive(this.active.get(worker.id).pid)) continue;
      const run = {
        workerId: worker.id,
        script: worker.script,
        args: [],
        status: "running",
        pid,
        adopted: true,
        startedAt: new Date(),
        startedBy: "external",
        logs: [`فرایند خارجی با PID ${pid} شناسایی شد`],
        errors: [],
        progress: {},
      };
      const result = await this.runs.insertOne(run);
      this.active.set(worker.id, { pid, runId: String(result.insertedId), adopted: true });
    }
  }

  async jobStats(source) {
    const [done, total] = await Promise.all([
      this.jobs.countDocuments({ source, done: true }),
      this.jobs.countDocuments({ source }),
    ]);
    return { doneJobs: done, recordedJobs: total };
  }

  async localCount(def) {
    if (!def.local) return 0;
    return this.db.collection(def.local.collection).countDocuments(def.local.filter || {});
  }

  expectedJobs(def, extras = {}) {
    if (extras.expectedJobs != null) return extras.expectedJobs;
    return null;
  }

  async snapshotWorker(def) {
    const live = this.active.get(def.id);
    const lastRun = await this.runs.find({ workerId: def.id }).sort({ startedAt: -1 }).limit(1).next();
    const lastAudit = await this.audits.find({ workerId: def.id }).sort({ startedAt: -1 }).limit(1).next();
    const localCount = await this.localCount(def);
    const jobs = await this.jobStats(def.source);
    let progress = (lastRun && lastRun.progress) || {};
    if (live && lastRun) {
      progress = this.readStatus(lastRun) || progress;
    }
    const running = Boolean(live && this.pidAlive(live.pid));
    if (live && !running) {
      this.active.delete(def.id);
    }
    return {
      id: def.id,
      label: def.label,
      script: def.script,
      source: def.source,
      running,
      pid: running ? live.pid : null,
      adopted: Boolean(live && live.adopted),
      localCount,
      jobs,
      progress,
      lastRun: lastRun
        ? {
            id: String(lastRun._id),
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            summary: lastRun.summary || "",
            errorCount: (lastRun.errors || []).length,
            exitCode: lastRun.exitCode,
          }
        : null,
      lastAudit: lastAudit
        ? {
            id: String(lastAudit._id),
            status: lastAudit.status,
            verdict: lastAudit.verdict,
            note: lastAudit.note,
            localCount: lastAudit.localCount,
            siteCount: lastAudit.siteCount,
            method: lastAudit.method,
            startedAt: lastAudit.startedAt,
            finishedAt: lastAudit.finishedAt,
            section: lastAudit.section,
          }
        : null,
      auditing: this.auditing.has(def.id),
    };
  }

  readStatus(run) {
    const file = run.statusPath;
    if (!file || !fs.existsSync(file)) return run.progress || null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return run.progress || null;
    }
  }

  async list() {
    if (!this._lastDiscover || Date.now() - this._lastDiscover > 15000) {
      this._lastDiscover = Date.now();
      await this.discoverExternal();
    }
    const out = [];
    for (const def of WORKERS) out.push(await this.snapshotWorker(def));
    return out;
  }

  async get(id) {
    const def = findWorker(id);
    if (!def) return null;
    const snap = await this.snapshotWorker(def);
    const runs = await this.runs.find({ workerId: id }).sort({ startedAt: -1 }).limit(15).toArray();
    const audits = await this.audits.find({ workerId: id }).sort({ startedAt: -1 }).limit(8).toArray();
    const latest = runs[0];
    return {
      ...snap,
      runs: runs.map((run) => this.serializeRun(run)),
      audits: audits.map((a) => this.serializeAudit(a)),
      liveLog: latest ? latest.logs || [] : [],
      liveErrors: latest ? latest.errors || [] : [],
    };
  }

  serializeRun(run) {
    return {
      id: String(run._id),
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      startedBy: run.startedBy,
      adopted: run.adopted,
      pid: run.pid,
      args: run.args,
      summary: run.summary || "",
      exitCode: run.exitCode,
      progress: run.progress,
      errorCount: (run.errors || []).length,
      errors: (run.errors || []).slice(-30),
      logs: (run.logs || []).slice(-120),
    };
  }

  serializeAudit(doc) {
    return {
      id: String(doc._id),
      status: doc.status,
      verdict: doc.verdict,
      note: doc.note,
      localCount: doc.localCount,
      siteCount: doc.siteCount,
      method: doc.method,
      section: doc.section,
      samples: doc.samples || [],
      jobs: doc.jobs,
      startedAt: doc.startedAt,
      finishedAt: doc.finishedAt,
      error: doc.error || "",
    };
  }

  async append(runId, field, line) {
    await this.runs.updateOne(
      { _id: runId },
      {
        $push: { [field]: { $each: [line], $slice: -400 } },
        $set: { updatedAt: new Date() },
      }
    );
  }

  async start(workerId, { noResume = false, startedBy = "panel" } = {}) {
    const def = findWorker(workerId);
    if (!def) throw new Error("ورکر پیدا نشد");
    await this.discoverExternal();
    if (this.active.has(workerId) && this.pidAlive(this.active.get(workerId).pid)) {
      throw new Error("همین ورکر الان در حال اجراست");
    }
    const args = [...(def.defaultArgs || [])];
    if (noResume) args.push("--no-resume");
    const runId = new ObjectId();
    const statusPath = path.join(os.tmpdir(), `imed-worker-${runId}.json`);
    await this.runs.insertOne({
      _id: runId,
      workerId,
      script: def.script,
      args,
      status: "starting",
      startedAt: new Date(),
      startedBy,
      statusPath,
      logs: [],
      errors: [],
      progress: {},
    });
    const child = spawn(process.execPath, [path.join(this.rootDir, def.script), ...args], {
      cwd: this.rootDir,
      env: {
        ...process.env,
        WORKER_RUN_ID: String(runId),
        WORKER_STATUS_PATH: statusPath,
      },
      windowsHide: true,
    });
    this.active.set(workerId, { pid: child.pid, runId: String(runId), child });
    await this.runs.updateOne({ _id: runId }, { $set: { status: "running", pid: child.pid } });

    const ingest = (chunk, isErr) => {
      const text = String(chunk || "");
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const errorLike = isErr || /خطا:|کپچا برای|Error:|MongoServerError/.test(line);
        this.append(runId, errorLike ? "errors" : "logs", line).catch(() => {});
      }
    };
    child.stdout.on("data", (buf) => ingest(buf, false));
    child.stderr.on("data", (buf) => ingest(buf, true));
    child.on("exit", async (code, signal) => {
      this.active.delete(workerId);
      const progress = this.readStatus({ statusPath }) || {};
      const status = signal === "SIGTERM" || signal === "SIGKILL" ? "stopped" : code === 0 ? "success" : "error";
      const summary =
        status === "success"
          ? progress.extra || "با خروج موفق تمام شد"
          : status === "stopped"
            ? "توسط پنل متوقف شد"
            : `خروج با کد ${code}`;
      await this.runs.updateOne(
        { _id: runId },
        {
          $set: {
            status,
            exitCode: code,
            signal,
            finishedAt: new Date(),
            progress,
            summary,
          },
        }
      );
    });
    return { runId: String(runId), pid: child.pid };
  }

  async stop(workerId) {
    const live = this.active.get(workerId);
    if (!live) throw new Error("ورکر در حال اجرا نیست");
    await this.runs.updateOne({ _id: new ObjectId(live.runId) }, { $set: { status: "stopping" } });
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(live.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try {
        process.kill(live.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    return { ok: true, pid: live.pid };
  }

  async startAudit(workerId, onProgress) {
    const def = findWorker(workerId);
    if (!def) throw new Error("ورکر پیدا نشد");
    if (this.auditing.has(workerId)) throw new Error("بررسی این ورکر الان در جریان است");
    const auditId = new ObjectId();
    const localCount = await this.localCount(def);
    const jobs = await this.jobStats(def.source);
    await this.audits.insertOne({
      _id: auditId,
      workerId,
      status: "running",
      startedAt: new Date(),
      localCount,
      jobs,
      section: "شروع بررسی سایت",
    });
    this.auditing.set(workerId, String(auditId));
    const updateSection = async (section) => {
      await this.audits.updateOne({ _id: auditId }, { $set: { section, updatedAt: new Date() } });
      if (onProgress) onProgress(section);
    };
    try {
      const site = await runAudit(def, this.db, updateSection);
      const expectedJobs = site.expectedJobs || jobs.recordedJobs;
      const doneJobs = jobs.doneJobs;
      const result = verdict({
        localCount,
        siteCount: site.siteCount,
        doneJobs,
        expectedJobs,
      });
      const doc = {
        status: "done",
        finishedAt: new Date(),
        localCount,
        siteCount: site.siteCount,
        method: site.method,
        samples: site.samples || [],
        siteGroups: site.siteGroups,
        localGroups: site.localGroups,
        extra: site.extra,
        jobs: { ...jobs, expectedJobs },
        verdict: result.verdict,
        note: result.note,
        section: "تمام",
      };
      if (def.audit === "prod" && site.siteGroups) {
        doc.note = `گروه سایت ${site.siteGroups} / گروه محلی ${site.localGroups}. ${result.note}`;
        if (site.localGroups < site.siteGroups) doc.verdict = "incomplete";
      }
      if ((def.audit === "import" || def.audit === "foriati" || def.audit === "equipment") && site.samples) {
        const bad = site.samples.filter((s) => s.match === false).length;
        if (doneJobs < (site.expectedJobs || 0)) {
          doc.verdict = "incomplete";
          doc.note = `فقط ${doneJobs} از ${site.expectedJobs} جستجو انجام شده`;
        } else if (bad) {
          doc.verdict = "close";
          doc.note = `${bad} نمونه با سایت فرق دارد`;
        }
      }
      await this.audits.updateOne({ _id: auditId }, { $set: doc });
      return { id: String(auditId), ...doc };
    } catch (err) {
      await this.audits.updateOne(
        { _id: auditId },
        { $set: { status: "error", error: err.message, finishedAt: new Date(), verdict: "error", note: err.message } }
      );
      throw err;
    } finally {
      this.auditing.delete(workerId);
    }
  }
}

module.exports = { WorkerManager, WORKERS };
