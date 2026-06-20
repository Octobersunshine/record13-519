class MeteringPool {
  constructor(options = {}) {
    this.pool = new Map();
    this.maxRecordsPerPile = options.maxRecordsPerPile || 1000;
    this.retentionTimeMs = options.retentionTimeMs || 3600000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60000;
    this._startCleanupTimer();
  }

  addRecord(pileId, data) {
    if (!pileId) {
      throw new Error('充电桩ID不能为空');
    }

    const record = {
      timestamp: Date.now(),
      voltage: data.voltage,
      current: data.current,
      power: data.voltage * data.current,
      ...data
    };

    if (!this.pool.has(pileId)) {
      this.pool.set(pileId, []);
    }

    const records = this.pool.get(pileId);
    records.push(record);

    if (records.length > this.maxRecordsPerPile) {
      records.shift();
    }

    return record;
  }

  getRecords(pileId, startTime, endTime) {
    const records = this.pool.get(pileId) || [];
    
    if (!startTime && !endTime) {
      return [...records];
    }

    return records.filter(r => {
      const inRange = (!startTime || r.timestamp >= startTime) &&
                      (!endTime || r.timestamp <= endTime);
      return inRange;
    });
  }

  getLatestRecord(pileId) {
    const records = this.pool.get(pileId);
    return records && records.length > 0 ? records[records.length - 1] : null;
  }

  getStatistics(pileId, startTime, endTime) {
    const records = this.getRecords(pileId, startTime, endTime);
    
    if (records.length === 0) {
      return null;
    }

    const voltages = records.map(r => r.voltage);
    const currents = records.map(r => r.current);
    const powers = records.map(r => r.power);

    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const avg = arr => sum(arr) / arr.length;

    const energy = this.calculateEnergy(records);

    return {
      pileId,
      recordCount: records.length,
      timeRange: {
        start: records[0].timestamp,
        end: records[records.length - 1].timestamp
      },
      voltage: {
        min: Math.min(...voltages),
        max: Math.max(...voltages),
        avg: avg(voltages)
      },
      current: {
        min: Math.min(...currents),
        max: Math.max(...currents),
        avg: avg(currents)
      },
      power: {
        min: Math.min(...powers),
        max: Math.max(...powers),
        avg: avg(powers)
      },
      energy: energy
    };
  }

  calculateEnergy(records) {
    if (records.length < 2) {
      return 0;
    }

    let energy = 0;
    for (let i = 1; i < records.length; i++) {
      const timeDiffHours = (records[i].timestamp - records[i - 1].timestamp) / 3600000;
      const avgPower = (records[i].power + records[i - 1].power) / 2;
      energy += avgPower * timeDiffHours;
    }
    return energy;
  }

  getAllPileIds() {
    return Array.from(this.pool.keys());
  }

  clearPile(pileId) {
    this.pool.delete(pileId);
  }

  clearAll() {
    this.pool.clear();
  }

  getPoolSize() {
    let total = 0;
    for (const records of this.pool.values()) {
      total += records.length;
    }
    return {
      pileCount: this.pool.size,
      totalRecords: total
    };
  }

  _startCleanupTimer() {
    if (this.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this._cleanupExpired();
      }, this.cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  _cleanupExpired() {
    const now = Date.now();
    const cutoffTime = now - this.retentionTimeMs;

    for (const [pileId, records] of this.pool.entries()) {
      const validRecords = records.filter(r => r.timestamp >= cutoffTime);
      if (validRecords.length === 0) {
        this.pool.delete(pileId);
      } else if (validRecords.length < records.length) {
        this.pool.set(pileId, validRecords);
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearAll();
  }
}

module.exports = MeteringPool;
