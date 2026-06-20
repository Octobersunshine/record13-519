const config = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0'
  },
  meteringPool: {
    maxRecordsPerPile: parseInt(process.env.MAX_RECORDS_PER_PILE) || 1000,
    retentionTimeMs: parseInt(process.env.RETENTION_TIME_MS) || 86400000,
    cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS) || 60000
  },
  validation: {
    minVoltage: 0,
    maxVoltage: 1000,
    minCurrent: 0,
    maxCurrent: 500
  },
  pricing: {
    peakRate: parseFloat(process.env.PEAK_RATE) || 1.2,
    offPeakRate: parseFloat(process.env.OFF_PEAK_RATE) || 0.5,
    flatRate: parseFloat(process.env.FLAT_RATE) || 0.8,
    peakHours: {
      start: 8,
      end: 22
    },
    serviceFee: parseFloat(process.env.SERVICE_FEE) || 0.0
  }
};

module.exports = config;
