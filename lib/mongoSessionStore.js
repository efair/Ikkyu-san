"use strict";

const session = require("express-session");

class MongoSessionStore extends session.Store {
  constructor(collection, { ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    super();
    this.col = collection;
    this.ttlMs = ttlMs;
  }

  async ensureIndexes() {
    await this.col.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  }

  get(sid, cb) {
    this.col
      .findOne({ _id: sid })
      .then((doc) => {
        if (!doc) return cb(null, null);
        if (doc.expires && doc.expires.getTime() < Date.now()) {
          this.col.deleteOne({ _id: sid }).catch(() => {});
          return cb(null, null);
        }
        return cb(null, doc.session);
      })
      .catch(cb);
  }

  set(sid, sess, cb) {
    const cookieExp = sess && sess.cookie && sess.cookie.expires;
    const expires = cookieExp ? new Date(cookieExp) : new Date(Date.now() + this.ttlMs);
    this.col
      .updateOne({ _id: sid }, { $set: { session: sess, expires, updatedAt: new Date() } }, { upsert: true })
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb) {
    this.col
      .deleteOne({ _id: sid })
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = { MongoSessionStore };
