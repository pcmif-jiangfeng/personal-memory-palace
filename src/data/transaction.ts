import type { DatabaseSync } from "node:sqlite";

export function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  if (database.isTransaction) {
    database.exec("SAVEPOINT nested_operation");
    try {
      const result = operation();
      database.exec("RELEASE nested_operation");
      return result;
    } catch (error) {
      database.exec("ROLLBACK TO nested_operation");
      database.exec("RELEASE nested_operation");
      throw error;
    }
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
