const { MongoClient } = require("mongodb");

(async () => {
  const c = new MongoClient("mongodb://127.0.0.1:27017");
  await c.connect();
  const db = c.db("devices");
  const jobs = await db
    .collection("scrape_jobs")
    .find({ source: "prodconfirmedcmp" })
    .project({ key: 1, done: 1, items: 1, name: 1, finishedAt: 1 })
    .toArray();
  const done = jobs.filter((j) => j.done);
  console.log({
    jobs: jobs.length,
    done: done.length,
    companies: await db.collection("companies").countDocuments(),
    withProfile: await db.collection("companies").countDocuments({
      registerNo: { $exists: true, $nin: [null, ""] },
    }),
    sampleDone: done.slice(0, 5),
    recentJob: jobs.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0],
  });
  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
