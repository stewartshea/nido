// Type shim for better-sqlite3-multiple-ciphers (SQLCipher-enabled fork of
// better-sqlite3). The package ships no bundled types. Cipher configuration
// is done via PRAGMA (cipher/legacy/key) after construction, so the class
// surface mirrors better-sqlite3 without cipher constructor options.
declare module 'better-sqlite3-multiple-ciphers' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface ColumnDefinition {
    name: string;
  }

  interface Statement {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): RunResult;
    columns(): ColumnDefinition[];
  }

  interface DatabaseOptions {
    fileMustExist?: boolean;
    timeout?: number;
    readonly?: boolean;
  }

  class Database {
    constructor(filename: string, options?: DatabaseOptions);
    prepare(source: string): Statement;
    exec(source: string): this;
    pragma(source: string): Record<string, unknown>[];
    close(): this;
  }

  export = Database;
}