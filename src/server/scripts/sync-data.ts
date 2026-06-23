import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { DataSyncService } from "../services/data-sync.js";
import { UniversityRepository } from "../services/university-repository.js";

const config = loadConfig();
const database = new AppDatabase(config.dbPath);
const universities = new UniversityRepository(database);
const sync = new DataSyncService(config, database, universities);

try {
  const result = await sync.sync();
  console.log(`Synced ${result.totalUniversities}/${result.totalFiles} files at ${result.commitSha}`);
} finally {
  database.close();
}

