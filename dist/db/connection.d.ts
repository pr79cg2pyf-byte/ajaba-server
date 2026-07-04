import { Database as SqlJsDatabase } from 'sql.js';
export declare function getDb(): Promise<SqlJsDatabase>;
export declare function saveToDisk(): void;
export declare function closeDb(): void;
export declare function queryAll(db: SqlJsDatabase, sql: string, params?: any[]): any[];
export declare function queryOne(db: SqlJsDatabase, sql: string, params?: any[]): any | null;
export declare function execute(db: SqlJsDatabase, sql: string, params?: any[]): void;
//# sourceMappingURL=connection.d.ts.map