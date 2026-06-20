class MeteringPool {
  constructor(options = {}) {
    this.pool = new Map();
    this.maxRecordsPerPile = options.maxRecordsPerPile || 1000;
    this.retentionTimeMs = options.retentionTimeMs || 3600000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60000;
    this.bucketIntervalMs = options.bucketIntervalMs || 3600000;
    this._locks = new Map();
    this._startCleanupTimer();
  }

  _initPileState(pileId) {
    if (!this.pool.has(pileId)) {
      this.pool.set(pileId, {
        records: [],
        seqNo: 0,
        totalEnergy: 0,
        lastRecord: null,
        hourlyBuckets: new Map(),
        dailyBuckets: new Map(),
        created_at: Date.now()
      });
    }
    return this.pool.get(pileId);
  }

  async _acquireLock(pileId) {
    return new Promise((resolve) => {
      const tryLock = () => {
        if (!this._locks.has(pileId)) {
          this._locks.set(pileId, true);
          resolve();
        } else {
          setImmediate(tryLock);
        }
      };
      tryLock();
    });
  }

  _releaseLock(pileId) {
    this._locks.delete(pileId);
  }

  _getBucketKey(timestamp, intervalMs) {
    return Math.floor(timestamp / intervalMs) * intervalMs;
  }

  _calculateDeltaEnergy(currentRecord, lastRecord) {
    if (!lastRecord) return 0;
    const timeDiffHours = (currentRecord.timestamp - lastRecord.timestamp) / 3600000;
    if (timeDiffHours <= 0) return 0;
    const avgPower = (currentRecord.power + lastRecord.power) / 2;
    return avgPower * timeDiffHours;
  }

  async addRecord(pileId, data) {
    if (!pileId) {
      throw new Error('充电桩ID不能为空');
    }

    await this._acquireLock(pileId);

    try {
      const state = this._initPileState(pileId);

      const record = {
        seqNo: ++state.seqNo,
        timestamp: data.timestamp || Date.now(),
        voltage: data.voltage,
        current: data.current,
        power: data.voltage * data.current,
        deltaEnergy: 0,
        ...data
      };

      const deltaEnergy = this._calculateDeltaEnergy(record, state.lastRecord);
      record.deltaEnergy = deltaEnergy;

      state.totalEnergy += deltaEnergy;

      const hourKey = this._getBucketKey(record.timestamp, 3600000);
      const dayKey = this._getBucketKey(record.timestamp, 86400000);

      if (!state.hourlyBuckets.has(hourKey)) {
        state.hourlyBuckets.set(hourKey, {
          energy: 0,
          recordCount: 0,
          voltageSum: 0,
          currentSum: 0,
          powerSum: 0,
          voltageMin: Infinity,
          voltageMax: -Infinity,
          currentMin: Infinity,
          currentMax: -Infinity,
          powerMin: Infinity,
          powerMax: -Infinity
        });
      }
      const hourBucket = state.hourlyBuckets.get(hourKey);
      hourBucket.energy += deltaEnergy;
      hourBucket.recordCount++;
      hourBucket.voltageSum += record.voltage;
      hourBucket.currentSum += record.current;
      hourBucket.powerSum += record.power;
      hourBucket.voltageMin = Math.min(hourBucket.voltageMin, record.voltage);
      hourBucket.voltageMax = Math.max(hourBucket.voltageMax, record.voltage);
      hourBucket.currentMin = Math.min(hourBucket.currentMin, record.current);
      hourBucket.currentMax = Math.max(hourBucket.currentMax, record.current);
      hourBucket.powerMin = Math.min(hourBucket.powerMin, record.power);
      hourBucket.powerMax = Math.max(hourBucket.powerMax, record.power);

      if (!state.dailyBuckets.has(dayKey)) {
        state.dailyBuckets.set(dayKey, {
          energy: 0,
          recordCount: 0
        });
      }
      state.dailyBuckets.get(dayKey).energy += deltaEnergy;
      state.dailyBuckets.get(dayKey).recordCount++;

      state.records.push(record);
      if (state.records.length > this.maxRecordsPerPile) {
        const removed = state.records.shift();
        if (removed && state.hourlyBuckets.size > 24) {
          this._cleanupOldBuckets(state);
        }
      }

      state.lastRecord = record;

      return {
        ...record,
        totalEnergy: state.totalEnergy
      };
    } finally {
      this._releaseLock(pileId);
    }
  }

  _cleanupOldBuckets(state) {
    const now = Date.now();
    const cutoffHour = this._getBucketKey(now - this.retentionTimeMs, 3600000);
    const cutoffDay = this._getBucketKey(now - this.retentionTimeMs * 30, 86400000);

    for (const key of state.hourlyBuckets.keys()) {
      if (key < cutoffHour) {
        state.hourlyBuckets.delete(key);
      }
    }

    for (const key of state.dailyBuckets.keys()) {
      if (key < cutoffDay) {
        state.dailyBuckets.delete(key);
      }
    }
  }

  getRecords(pileId, startTime, endTime) {
    const state = this.pool.get(pileId);
    const records = state ? state.records : [];
    
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
    const state = this.pool.get(pileId);
    if (!state || state.records.length === 0) return null;
    
    const latest = state.records[state.records.length - 1];
    return {
      ...latest,
      totalEnergy: state.totalEnergy
    };
  }

  getPileState(pileId) {
    const state = this.pool.get(pileId);
    if (!state) return null;

    return {
      pileId,
      seqNo: state.seqNo,
      totalEnergy: state.totalEnergy,
      recordCount: state.records.length,
      lastRecord: state.lastRecord,
      hourlyBucketCount: state.hourlyBuckets.size,
      dailyBucketCount: state.dailyBuckets.size,
      created_at: state.created_at
    };
  }

  getStatistics(pileId, startTime, endTime, groupBy = 'none') {
    const state = this.pool.get(pileId);
    if (!state) return null;

    const records = this.getRecords(pileId, startTime, endTime);
    if (records.length === 0) {
      return null;
    }

    const voltages = records.map(r => r.voltage);
    const currents = records.map(r => r.current);
    const powers = records.map(r => r.power);
    const deltaEnergies = records.map(r => r.deltaEnergy || 0);

    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const avg = arr => arr.length > 0 ? sum(arr) / arr.length : 0;

    const baseStats = {
      pileId,
      recordCount: records.length,
      seqNoRange: {
        start: records[0].seqNo,
        end: records[records.length - 1].seqNo,
        expected: records[records.length - 1].seqNo - records[0].seqNo + 1,
        missing: (records[records.length - 1].seqNo - records[0].seqNo + 1) - records.length
      },
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
      energy: {
        total: sum(deltaEnergies),
        fromBuckets: this._calculateEnergyFromBuckets(state, startTime, endTime)
      },
      totalEnergy: state.totalEnergy
    };

    if (groupBy === 'hour' || groupBy === 'day') {
      baseStats.groups = this._getGroupedStats(state, records, groupBy);
    }

    return baseStats;
  }

  _calculateEnergyFromBuckets(state, startTime, endTime) {
    const now = Date.now();
    const start = startTime || 0;
    const end = endTime || now;

    let totalEnergy = 0;
    const intervalMs = 3600000;
    const startBucket = this._getBucketKey(start, intervalMs);
    const endBucket = this._getBucketKey(end, intervalMs);

    for (let bucket = startBucket; bucket <= endBucket; bucket += intervalMs) {
      const bucketData = state.hourlyBuckets.get(bucket);
      if (bucketData) {
        totalEnergy += bucketData.energy;
      }
    }

    return totalEnergy;
  }

  _getGroupedStats(state, records, groupBy) {
    const intervalMs = groupBy === 'hour' ? 3600000 : 86400000;
    const buckets = new Map();

    for (const record of records) {
      const key = this._getBucketKey(record.timestamp, intervalMs);
      if (!buckets.has(key)) {
        buckets.set(key, {
          startTime: key,
          endTime: key + intervalMs - 1,
          recordCount: 0,
          energy: 0,
          voltageSum: 0,
          currentSum: 0,
          powerSum: 0
        });
      }
      const bucket = buckets.get(key);
      bucket.recordCount++;
      bucket.energy += record.deltaEnergy || 0;
      bucket.voltageSum += record.voltage;
      bucket.currentSum += record.current;
      bucket.powerSum += record.power;
    }

    return Array.from(buckets.values()).map(b => ({
      ...b,
      voltageAvg: b.voltageSum / b.recordCount,
      currentAvg: b.currentSum / b.recordCount,
      powerAvg: b.powerSum / b.recordCount
    })).sort((a, b) => a.startTime - b.startTime);
  }

  getAllPileIds() {
    return Array.from(this.pool.keys());
  }

  clearPile(pileId) {
    this.pool.delete(pileId);
    this._locks.delete(pileId);
  }

  clearAll() {
    this.pool.clear();
    this._locks.clear();
  }

  getPoolSize() {
    let totalRecords = 0;
    let totalEnergy = 0;
    for (const state of this.pool.values()) {
      totalRecords += state.records.length;
      totalEnergy += state.totalEnergy;
    }
    return {
      pileCount: this.pool.size,
      totalRecords,
      totalEnergy
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

    for (const [pileId, state] of this.pool.entries()) {
      const validRecords = state.records.filter(r => r.timestamp >= cutoffTime);
      if (validRecords.length === 0) {
        this.pool.delete(pileId);
        this._locks.delete(pileId);
      } else {
        state.records = validRecords;
        this._cleanupOldBuckets(state);
      }
    }
  }

  _getDayStartEnd(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const start = date.getTime();
    const end = start + 86400000 - 1;
    return { start, end, date };
  }

  _isPeakHour(timestamp, peakHours) {
    const hour = new Date(timestamp).getHours();
    return hour >= peakHours.start && hour < peakHours.end;
  }

  _calculateCostByRecords(records, pricing) {
    let peakEnergy = 0;
    let offPeakEnergy = 0;
    let flatEnergy = 0;

    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1];
      const curr = records[i];
      const timeDiffMs = curr.timestamp - prev.timestamp;
      if (timeDiffMs <= 0) continue;

      const timeDiffHours = timeDiffMs / 3600000;
      const avgPower = (curr.power + prev.power) / 2;
      const segmentEnergy = avgPower * timeDiffHours;

      const midTimestamp = prev.timestamp + timeDiffMs / 2;
      if (this._isPeakHour(midTimestamp, pricing.peakHours)) {
        peakEnergy += segmentEnergy;
      } else {
        offPeakEnergy += segmentEnergy;
      }
    }

    flatEnergy = peakEnergy + offPeakEnergy;

    const peakCost = peakEnergy * pricing.peakRate;
    const offPeakCost = offPeakEnergy * pricing.offPeakRate;
    const flatCost = flatEnergy * pricing.flatRate;
    const serviceCost = pricing.serviceFee;
    const totalCost = peakCost + offPeakCost + serviceCost;

    return {
      energyBreakdown: {
        peak: peakEnergy,
        offPeak: offPeakEnergy,
        flat: flatEnergy
      },
      costBreakdown: {
        peak: peakCost,
        offPeak: offPeakCost,
        flat: flatCost,
        service: serviceCost,
        total: totalCost
      }
    };
  }

  generateDailyBill(pileId, dateTimestamp, pricing) {
    const state = this.pool.get(pileId);
    if (!state) return null;

    const { start, end, date } = this._getDayStartEnd(dateTimestamp || Date.now());
    const dayRecords = this.getRecords(pileId, start, end);

    if (dayRecords.length === 0) {
      return {
        pileId,
        date: date.toISOString().split('T')[0],
        dateTimestamp: start,
        recordCount: 0,
        totalEnergy: 0,
        energyBreakdown: { peak: 0, offPeak: 0, flat: 0 },
        costBreakdown: { peak: 0, offPeak: 0, flat: 0, service: pricing.serviceFee, total: pricing.serviceFee },
        priceInfo: { ...pricing },
        status: 'no_data',
        generatedAt: Date.now()
      };
    }

    const calcResult = this._calculateCostByRecords(dayRecords, pricing);
    const bucketData = state.dailyBuckets.get(this._getBucketKey(start, 86400000));

    return {
      pileId,
      date: date.toISOString().split('T')[0],
      dateTimestamp: start,
      recordCount: dayRecords.length,
      seqNoRange: {
        start: dayRecords[0].seqNo,
        end: dayRecords[dayRecords.length - 1].seqNo
      },
      timeRange: {
        start: dayRecords[0].timestamp,
        end: dayRecords[dayRecords.length - 1].timestamp
      },
      totalEnergy: calcResult.energyBreakdown.flat,
      bucketEnergy: bucketData ? bucketData.energy : 0,
      energyBreakdown: calcResult.energyBreakdown,
      costBreakdown: calcResult.costBreakdown,
      avgVoltage: dayRecords.reduce((s, r) => s + r.voltage, 0) / dayRecords.length,
      avgCurrent: dayRecords.reduce((s, r) => s + r.current, 0) / dayRecords.length,
      avgPower: dayRecords.reduce((s, r) => s + r.power, 0) / dayRecords.length,
      priceInfo: { ...pricing },
      status: 'generated',
      generatedAt: Date.now()
    };
  }

  generateAllDailyBills(dateTimestamp, pricing) {
    const pileIds = this.getAllPileIds();
    const bills = [];

    for (const pileId of pileIds) {
      const bill = this.generateDailyBill(pileId, dateTimestamp, pricing);
      if (bill) {
        bills.push(bill);
      }
    }

    const summary = bills.reduce(
      (acc, bill) => ({
        totalEnergy: acc.totalEnergy + bill.totalEnergy,
        peakEnergy: acc.peakEnergy + bill.energyBreakdown.peak,
        offPeakEnergy: acc.offPeakEnergy + bill.energyBreakdown.offPeak,
        peakCost: acc.peakCost + bill.costBreakdown.peak,
        offPeakCost: acc.offPeakCost + bill.costBreakdown.offPeak,
        serviceCost: acc.serviceCost + bill.costBreakdown.service,
        totalCost: acc.totalCost + bill.costBreakdown.total,
        pileCount: acc.pileCount + (bill.recordCount > 0 ? 1 : 0)
      }),
      { totalEnergy: 0, peakEnergy: 0, offPeakEnergy: 0, peakCost: 0, offPeakCost: 0, serviceCost: 0, totalCost: 0, pileCount: 0 }
    );

    return {
      date: bills.length > 0 ? bills[0].date : new Date(dateTimestamp || Date.now()).toISOString().split('T')[0],
      billCount: bills.length,
      summary,
      bills
    };
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
