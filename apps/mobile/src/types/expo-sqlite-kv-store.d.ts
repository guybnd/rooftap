declare module 'expo-sqlite/kv-store' {
  export class SQLiteStorage {
    constructor(databaseName: string);
    getItemSync(key: string): string | null;
    setItemSync(key: string, value: string): void;
  }
}
