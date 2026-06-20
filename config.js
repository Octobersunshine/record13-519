const config = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0'
  },
  meteringPool: {
    maxRecordsPerPile: parseInt(process.env.MAX_RECORDS_PER_PILE) || 1000,
    retentionTimeMs: parseInt(process.env.RETENTION_TIME_MS) || 3600000,
    cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS) || 60000
  },
  validation: {
    minVoltage: 0,
    maxVoltage: 1000,
    minCurrent: 0,
    maxCurrent: 500
  }
};

module.exports = config;
