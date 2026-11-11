'use strict';

// npm run insights:check — confirms the Insights Drive bridge (google/insights-feed.gs) is reachable and
// shows which tab folders it found and how many blogs each holds.

const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }

const { isInsightsConfigured, pingInsights } = require('../server/insights.js');

const HINTS = {
  insights_not_configured: 'Set INSIGHTS_FEED_URL and INSIGHTS_FEED_SECRET in .env.',
  insights_forbidden: 'INSIGHTS_FEED_SECRET does not match the script property INSIGHTS_SECRET.',
  insights_script_not_configured: 'Add the INSIGHTS_SECRET script property in Apps Script.',
  insights_bad_response: 'The URL did not answer like the script. Check it ends in /exec and the deployment has access "Anyone".',
  insights_unreachable: 'Could not reach Google. Check the URL and this server\'s internet access.',
  insights_script_error: 'The script failed. Check the INSIGHTS_FOLDER_ID property and that you ran "setup" once.'
};

(async () => {
  if (!isInsightsConfigured()) {
    console.error(HINTS.insights_not_configured);
    process.exit(1);
  }
  try {
    const { folders } = await pingInsights();
    console.log('Connected. Insights folders in Drive:');
    for (const [tab, info] of Object.entries(folders || {})) {
      console.log(`  ${info.found ? `${String(info.files).padStart(2)} blogs ` : 'MISSING   '} ${tab}`);
    }
  } catch (error) {
    console.error(`Insights check failed: ${error.message}`);
    if (HINTS[error.code]) console.error(HINTS[error.code]);
    process.exit(1);
  }
})();
