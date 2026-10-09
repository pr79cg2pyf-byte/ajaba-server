import { Database as SqlJsDatabase } from 'sql.js';
export declare const DB_PATH: string;
export declare function getDb(): Promise<SqlJsDatabase>;
export declare function saveToDisk(): void;
/** Roll back in-memory changes too if the durable snapshot cannot be written. */
export declare function durableWrite<T>(database: SqlJsDatabase, write: () => T): T;
export declare function closeDb(): void;
export declare function queryAll(db: SqlJsDatabase, sql: string, params?: any[]): any[];
export declare function queryOne(db: SqlJsDatabase, sql: string, params?: any[]): any | null;
export declare function execute(db: SqlJsDatabase, sql: string, params?: any[]): void;
//# sourceMappingURL=connection.d.ts.map