import { startMocks } from '../helpers/adbHelpers.js';
import { logStepMessage } from '../helpers/logger.js';

(async () => {
  try {
    logStepMessage("▶️ Starting mock services");
    await startMocks();
    logStepMessage("✅ Mocks started");
    process.exit(0);
  } catch (err) {
    logStepMessage(`❌ Failed to start mocks: ${err.message}`, "error");
    process.exit(1);
  }
})();
