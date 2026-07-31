import Database from 'better-sqlite3';

let database = null;
try {
  database = new Database(':memory:');
  const row = database.prepare('SELECT 1 AS ready').get();
  if (Number(row?.ready) !== 1) throw new Error('SQLite probe query returned an unexpected result.');
  process.stdout.write(JSON.stringify({
    success: true,
    nodeVersion: process.version,
    nodeModulesAbi: process.versions.modules || ''
  }));
} catch (error) {
  process.stderr.write(`SQLite runtime probe failed: ${error?.message || error}\n`);
  process.exitCode = 1;
} finally {
  try {
    database?.close();
  } catch (_) {
    // The process is exiting; the probe database is in-memory only.
  }
}
