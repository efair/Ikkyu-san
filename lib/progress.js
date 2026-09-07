"use strict";

const fs = require("fs");

function now() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
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
    console.log(`[${now()}] === ${this.script} === ${title}`);
    this.flush(true);
  }

  setSection(section) {
    this.section = section;
    console.log(`[${now()}] [${this.script}] بخش جاری: ${section}`);
    this.flush(true);
  }

  setDetected(n, label = "مورد") {
    this.detected = n;
    this.total = n;
    this.done = 0;
    this.label = label;
    console.log(
      `[${now()}] [${this.script}] تشخیص داد: ${n} ${label} | بخش: ${this.section}`
    );
    this.flush(true);
  }

  tick(item) {
    this.done += 1;
    this.lastItem = item || "";
    const itemText = item ? ` | الان: ${item}` : "";
    console.log(
      `[${now()}] [${this.script}] بخش: ${this.section} | تشخیص: ${this.detected} | رفته: ${this.done}/${this.total || this.detected}${itemText}`
    );
    this.flush(false);
  }

  skip(why) {
    console.log(`[${now()}] [${this.script}] رد شد: ${why}`);
    this.flush(false);
  }

  error(why) {
    this.lastError = why;
    console.error(`[${now()}] [${this.script}] خطا: ${why} | بخش: ${this.section}`);
    this.flush(true);
  }

  finish(extra) {
    this.extra = extra || "";
    console.log(
      `[${now()}] [${this.script}] تمام شد. تشخیص: ${this.detected} | رفته: ${this.done}${extra ? ` | ${extra}` : ""}`
    );
    this.flush(true);
  }

  snapshot() {
    return {
      script: this.script,
      title: this.title,
      section: this.section,
      detected: this.detected,
      done: this.done,
      total: this.total || this.detected,
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
