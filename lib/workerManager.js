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
    this._watches = new Map();
    this._logOffsets = new Map();
  }

  async init() {
    await this.runs.createIndex({ workerId: 1, startedAt: -1 });
    await this.audits.createIndex({ workerId: 1, startedAt: -1 });
    const hanging = await this.runs.find({ status: { $in: ["starting", "running", "stopping"] } }).toArray();
    for (const run of hanging) {
      if (run.pid && this.pidAlive(run.pid)) {
        this.active.set(run.workerId, {
          pid: run.pid,
          runId: String(run._id),
          adopted: true,
          logPath: run.logPath,
          statusPath: run.statusPath,
        });
        this.watchRun(run.workerId);
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
    if (process.platform === "win32") {
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
    return new Promise((resolve) => {
      execFile("ps", ["-eo", "pid=,args="], { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const rows = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const m = trimmed.match(/^(\d+)\s+(.*)$/);
          if (!m) continue;
          rows.push({ ProcessId: Number(m[1]), CommandLine: m[2] });
        }
        resolve(rows);
      });
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
      this.watchRun(worker.id);
    }
  }

  async syncLogTail(runId, logPath) {
    if (!logPath || !fs.existsSync(logPath)) return;
    const key = String(runId);
    let offset = this._logOffsets.get(key) || 0;
    const stat = fs.statSync(logPath);
    if (stat.size < offset) offset = 0;
    if (stat.size === offset) return;
    const fd = fs.openSync(logPath, "r");
    try {
      const length = stat.size - offset;
      const buf = Buffer.alloc(Math.min(length, 256 * 1024));
      const read = fs.readSync(fd, buf, 0, buf.length, offset);
      offset += read;
      this._logOffsets.set(key, offset);
      const text = buf.slice(0, read).toString("utf8");
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const errorLike = /خطا:|کپچا برای|Error:|MongoServerError|FATAL ERROR|heap out of memory/i.test(line);
        await this.append(runId, errorLike ? "errors" : "logs", line);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  watchRun(workerId) {
    if (this._watches.has(workerId)) return;
    const timer = setInterval(() => {
      this.pollRun(workerId).catch(() => {});
    }, 1500);
    this._watches.set(workerId, timer);
  }

  stopWatch(workerId) {
    const timer = this._watches.get(workerId);
    if (timer) clearInterval(timer);
    this._watches.delete(workerId);
  }

  async pollRun(workerId) {
    const live = this.active.get(workerId);
    if (!live) {
      this.stopWatch(workerId);
      return;
    }
    const runId = live.runId;
    const runOid = new ObjectId(runId);
    const run = await this.runs.findOne({ _id: runOid });
    if (run && run.logPath) {
      await this.syncLogTail(runId, run.logPath);
    }
    const progress = this.readStatus(run || live) || {};
    if (Object.keys(progress).length) {
      await this.runs.updateOne({ _id: runOid }, { $set: { progress, updatedAt: new Date() } });
    }
    if (this.pidAlive(live.pid)) return;

    this.stopWatch(workerId);
    this.active.delete(workerId);
    const current = await this.runs.findOne({ _id: runOid });
    if (current && current.finishedAt) return;
    const finalProgress = this.readStatus(run || live) || progress;
    await this.runs.updateOne(
      { _id: runOid },
      {
        $set: {
          status: "stopped",
          finishedAt: new Date(),
          progress: finalProgress,
          summary: finalProgress.extra || "فرایند ورکر دیگر در حال اجرا نیست",
        },
      }
    );
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
      pagePath: def.pagePath || "",
      url: def.url || "",
      pageNote: def.note || "",
      countLabels: def.countLabels || { local: "محلی", site: "سایت" },
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
            siteCountSoFar: lastAudit.siteCountSoFar,
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
    const file = run && run.statusPath;
    if (!file || !fs.existsSync(file)) return (run && run.progress) || null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return (run && run.progress) || null;
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
    const live = this.active.get(id);
    if (live && live.runId) {
      const run = await this.runs.findOne({ _id: new ObjectId(live.runId) });
      if (run && run.logPath) await this.syncLogTail(live.runId, run.logPath);
    }
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

  serializeAudit(a) {
    return {
      id: String(a._id),
      status: a.status,
      verdict: a.verdict,
      note: a.note,
      localCount: a.localCount,
      siteCount: a.siteCount,
      method: a.method,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      section: a.section,
    };
  }

  async append(runId, field, line) {
    await this.runs.updateOne(
      { _id: runId instanceof ObjectId ? runId : new ObjectId(runId) },
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
    const logPath = path.join(os.tmpdir(), `imed-worker-${runId}.log`);
    await this.runs.insertOne({
      _id: runId,
      workerId,
      script: def.script,
      args,
      status: "starting",
      startedAt: new Date(),
      startedBy,
      statusPath,
      logPath,
      logs: [],
      errors: [],
      progress: {},
    });

    const logFd = fs.openSync(logPath, "a");
    let child;
    try {
      child = spawn(process.execPath, [path.join(this.rootDir, def.script), ...args], {
        cwd: this.rootDir,
        env: {
          ...process.env,
          ...(def.env || {}),
          WORKER_RUN_ID: String(runId),
          WORKER_STATUS_PATH: statusPath,
        },
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    child.unref();

    this.active.set(workerId, {
      pid: child.pid,
      runId: String(runId),
      child,
      logPath,
      statusPath,
    });
    await this.runs.updateOne({ _id: runId }, { $set: { status: "running", pid: child.pid } });
    this.watchRun(workerId);

    child.on("exit", async (code, signal) => {
      this.stopWatch(workerId);
      const still = this.active.get(workerId);
      if (still && String(still.runId) === String(runId)) this.active.delete(workerId);
      await this.syncLogTail(runId, logPath).catch(() => {});
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
      setTimeout(() => {
        if (this.pidAlive(live.pid)) {
          try {
            process.kill(live.pid, "SIGKILL");
          } catch {
            // ignore
          }
        }
      }, 8000);
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
      const text = String(section || "");
      const soFar = text.match(/جمع(?: کل| تا الان)?\s*(\d+)/);
      const patch = { section: text, updatedAt: new Date() };
      if (soFar) patch.siteCountSoFar = Number(soFar[1]);
      await this.audits.updateOne({ _id: auditId }, { $set: patch });
      if (onProgress) onProgress(text);
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
        siteCountSoFar: site.siteCount,
        method: site.method,
        samples: site.samples || [],
        siteGroups: site.siteGroups,
        localGroups: site.localGroups,
        extra: site.extra,
        jobs: { ...jobs, expectedJobs },
        verdict: result.verdict,
        note: result.note,
        section: `تمام — سایت ${site.siteCount == null ? "—" : site.siteCount} رکورد سطح اول`,
      };
      if (def.audit === "prod" && site.siteGroups != null && site.localGroups != null) {
        doc.note = `گروه سایت ${site.siteGroups} / گروه محلی ${site.localGroups}. ${result.note}`;
        if (site.localGroups < site.siteGroups) doc.verdict = "incomplete";
      }
      if (def.audit === "profiles" && site.extra) {
        const pending = site.extra.pending ?? Math.max(0, (site.siteCount || 0) - localCount);
        doc.note =
          pending === 0
            ? `همه ${site.siteCount} شرکت لینک‌دار غنی شده‌اند`
            : `غنی‌شده ${localCount} از ${site.siteCount} لینک‌دار — باقیمانده ${pending}`;
        doc.verdict = pending === 0 ? "complete" : "incomplete";
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
