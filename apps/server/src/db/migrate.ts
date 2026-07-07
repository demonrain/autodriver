import { ensureSchema, openSqliteFromUrl } from ".";
import { loadConfig } from "../config";

const config = loadConfig();
const sqlite = openSqliteFromUrl(config.databaseUrl);
ensureSchema(sqlite);
sqlite.close();
console.log("Database schema is ready.");
