"use strict";

const fs = require("fs");

try {
  if (process.stdout._handle && typeof process.stdout._handle.setBlocking === "function") {
    process.stdout._handle.setBlocking(true);
  }
  if (process.stderr._handle && typeof process.stderr._handle.setBlocking === "function") {
    process.stderr._handle.setBlocking(true);
  }
} catch {
  // ignore
}

function now() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function writeLine(stream, line) {
  const text = String(line) + "\n";
  try {
    fs.writeSync(stream.fd, text);
  } catch {
    try {
      stream.write(text);
    } catch {
      // ignore
    }
  }
}

class Progress {
  constructor(script) {
    this.script = script;
    this.section = "";
    this.detected = 0;
    this.done = 0;
    this.total = 0;
    this.lastItem = "";
    this.lastError = "";
    this.title = "";
    this._lastWrite = 0;
  }

  start(title) {
    this.title = title;
    writeLine(process.stdout, `[${now()}] === ${this.script} === ${title}`);
    this.flush(true);
  }

  setSection(section) {
    this.section = section;
    writeLine(process.stdout, `[${now()}] [${this.script}] بخش جاری: ${section}`);
    this.flush(true);
  }

  setDetected(n, label = "مورد") {
    this.detected = n;
    this.total = n;
    this.done = 0;
    this.label = label;
    writeLine(
      process.stdout,
      `[${now()}] [${this.script}] تشخیص داد: ${n} ${label} | بخش: ${this.section}`
    );
    this.flush(true);
  }

  tick(item) {
    this.done += 1;
    this.lastItem = item || "";
    const itemText = item ? ` | الان: ${item}` : "";
    writeLine(
      process.stdout,
      `[${now()}] [${this.script}] ${this.progressText()} | بخش: ${this.section}${itemText}`
    );
    this.flush(true);
  }

  note(msg) {
    this.lastItem = msg || this.lastItem;
    writeLine(process.stdout, `[${now()}] [${this.script}] ${msg}`);
    this.flush(false);
  }

  /** فقط وضعیت پنل را عوض می‌کند؛ برای آپدیت‌های پرتکرار بدون شلوغ کردن لاگ */
  updateSection(section, lastItem) {
    this.section = section;
    if (lastItem != null) this.lastItem = lastItem;
    this.flush(true);
  }

  skip(why) {
    writeLine(process.stdout, `[${now()}] [${this.script}] رد شد: ${why}`);
    this.flush(false);
  }

  error(why) {
    this.lastError = why;
    writeLine(process.stderr, `[${now()}] [${this.script}] خطا: ${why} | بخش: ${this.section}`);
    this.flush(true);
  }

  finish(extra) {
    this.extra = extra || "";
    writeLine(
      process.stdout,
      `[${now()}] [${this.script}] تمام شد. تشخیص: ${this.detected} | رفته: ${this.done}${extra ? ` | ${extra}` : ""}`
    );
    this.flush(true);
  }

  remaining() {
    return Math.max(0, (this.total || this.detected || 0) - (this.done || 0));
  }

  progressText() {
    const total = this.total || this.detected || 0;
    const label = this.label || "مورد";
    return `رفته ${this.done}/${total} ${label} | مانده ${this.remaining()}`;
  }

  snapshot() {
    const total = this.total || this.detected || 0;
    return {
      script: this.script,
      title: this.title,
      section: this.section,
      detected: this.detected,
      done: this.done,
      total,
      remaining: this.remaining(),
      label: this.label || "",
      lastItem: this.lastItem,
      lastError: this.lastError,
      extra: this.extra || "",
      updatedAt: new Date().toISOString(),
    };
  }

  flush(force) {
    const file = process.env.WORKER_STATUS_PATH;
    if (!file) return;
    const nowMs = Date.now();
    if (!force && nowMs - this._lastWrite < 800) return;
    this._lastWrite = nowMs;
    try {
      fs.writeFileSync(file, JSON.stringify(this.snapshot()));
    } catch {
      // ignore status-file failures so scraping continues
    }
  }
}

module.exports = { Progress, now };
