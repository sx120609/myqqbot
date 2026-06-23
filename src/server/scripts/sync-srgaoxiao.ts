import { loadConfig } from "../config.js";
import { AppDatabase } from "../db.js";
import { SrgaoxiaoSyncService } from "../services/srgaoxiao-sync.js";
import { UniversityRepository } from "../services/university-repository.js";

const config = loadConfig();
const database = new AppDatabase(config.dbPath);
const universities = new UniversityRepository(database);
const sync = new SrgaoxiaoSyncService(config, universities, (message) => {
  console.log(`[sync:srgaoxiao] ${message}`);
});

try {
  const result = await sync.sync({
    query: process.env.SRGAOXIAO_SYNC_QUERY,
    limit: Number(process.env.SRGAOXIAO_SYNC_LIMIT ?? "50")
  });
  console.log(
    `Synced ${result.saved}/${result.total} srgaoxiao profiles from ${result.baseUrl}. Errors: ${result.errors.length}`
  );
  if (result.errors.length) {
    for (const error of result.errors.slice(0, 10)) {
      console.log(`- ${error.university}: ${error.message}`);
    }
  }
} finally {
  database.close();
}
