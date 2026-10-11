import fs from 'node:fs';
import { createRequire } from 'node:module';

// The packaged desktop uses Electron's bundled SQLite, avoiding native addon ABI rebuilds.
// The legacy Node launcher can continue using its existing better-sqlite3 installation.
const useBundled = Boolean(process.versions.electron) || process.env.YACHIYO_SQLITE_DRIVER === 'node';
let Database;
if (useBundled) {
  const { DatabaseSync } = await import('node:sqlite');
  Database = class {
    constructor(filename, options = {}) {
      if (options.fileMustExist && !fs.existsSync(filename)) throw new Error(`Database does not exist: ${filename}`);
      this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly) });
      this.transactionId = 0;
    }
    exec(sql) { return this.db.exec(sql); }
    close() { return this.db.close(); }
    prepare(sql) {
      const statement = this.db.prepare(sql);
      statement.setAllowBareNamedParameters(true);
      statement.setAllowUnknownNamedParameters(true);
      return statement;
    }
    pragma(sql, options = {}) {
      const rows = this.db.prepare(`PRAGMA ${sql}`).all();
      return options.simple ? Object.values(rows[0] || {})[0] : rows;
    }
    transaction(fn) {
      return (...args) => {
        const name = `memory_tx_${++this.transactionId}`;
        this.db.exec(`SAVEPOINT ${name}`);
        try {
          const result = fn(...args);
          if (result?.then) throw new Error('SQLite transactions must be synchronous');
          this.db.exec(`RELEASE ${name}`);
          return result;
        } catch (error) {
          this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
          throw error;
        }
      };
    }
  };
} else {
  Database = createRequire(import.meta.url)('better-sqlite3');
}
export default Database;
