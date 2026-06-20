const express = require('express');
const config = require('./config');
const MeteringPool = require('./meteringPool');
const { validateMeteringData } = require('./middleware/validator');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();
const meteringPool = new MeteringPool(config.meteringPool);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.post('/api/metering/report', validateMeteringData, async (req, res, next) => {
  try {
    const { pileId, voltage, current, ...extra } = req.body;
    const record = await meteringPool.addRecord(pileId, { pileId, voltage, current, ...extra });

    res.json({
      success: true,
      message: '数据上报成功',
      data: record
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/metering/piles', (req, res, next) => {
  try {
    const pileIds = meteringPool.getAllPileIds();
    const poolSize = meteringPool.getPoolSize();

    res.json({
      success: true,
      data: {
        pileIds,
        poolSize
      }
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/metering/:pileId/state', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const state = meteringPool.getPileState(pileId);

    if (!state) {
      return res.status(404).json({
        success: false,
        error: '未找到该充电桩'
      });
    }

    res.json({
      success: true,
      data: state
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/metering/:pileId/latest', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const record = meteringPool.getLatestRecord(pileId);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: '未找到该充电桩的数据'
      });
    }

    res.json({
      success: true,
      data: record
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/metering/:pileId/records', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const { startTime, endTime } = req.query;

    const startTs = startTime ? parseInt(startTime) : null;
    const endTs = endTime ? parseInt(endTime) : null;

    const records = meteringPool.getRecords(pileId, startTs, endTs);

    res.json({
      success: true,
      data: {
        pileId,
        count: records.length,
        records
      }
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/metering/:pileId/statistics', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const { startTime, endTime, groupBy } = req.query;

    const startTs = startTime ? parseInt(startTime) : null;
    const endTs = endTime ? parseInt(endTime) : null;
    const group = groupBy === 'hour' || groupBy === 'day' ? groupBy : 'none';

    const stats = meteringPool.getStatistics(pileId, startTs, endTs, group);

    if (!stats) {
      return res.status(404).json({
        success: false,
        error: '未找到该充电桩的数据'
      });
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/metering/:pileId', (req, res, next) => {
  try {
    const { pileId } = req.params;
    meteringPool.clearPile(pileId);

    res.json({
      success: true,
      message: `充电桩 ${pileId} 数据已清空`
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/metering', (req, res, next) => {
  try {
    meteringPool.clearAll();

    res.json({
      success: true,
      message: '所有充电桩数据已清空'
    });
  } catch (err) {
    next(err);
  }
});

const {
  generateSingleBillCSV,
  generateBillsSummaryCSV,
  generateDetailedHourlyCSV,
  saveCSVToFile
} = require('./utils/csvExporter');

function parseDateParam(dateStr) {
  if (!dateStr) return Date.now();
  const ts = parseInt(dateStr);
  if (!isNaN(ts)) return ts;
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? Date.now() : parsed;
}

app.get('/api/bills/:pileId/daily', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const { date } = req.query;
    const dateTimestamp = parseDateParam(date);

    const bill = meteringPool.generateDailyBill(pileId, dateTimestamp, config.pricing);

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: '未找到该充电桩'
      });
    }

    res.json({
      success: true,
      data: bill
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/bills/:pileId/daily/csv', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const { date, download } = req.query;
    const dateTimestamp = parseDateParam(date);

    const bill = meteringPool.generateDailyBill(pileId, dateTimestamp, config.pricing);

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: '未找到该充电桩'
      });
    }

    const csvContent = generateSingleBillCSV(bill);
    const filename = `bill_${pileId}_${bill.date}.csv`;

    if (download === 'true' || download === '1') {
      const filepath = saveCSVToFile(csvContent, filename);
      return res.json({
        success: true,
        message: 'CSV 已保存',
        data: {
          filename,
          filepath,
          bill
        }
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvContent);
  } catch (err) {
    next(err);
  }
});

app.get('/api/bills/daily', (req, res, next) => {
  try {
    const { date } = req.query;
    const dateTimestamp = parseDateParam(date);

    const billsData = meteringPool.generateAllDailyBills(dateTimestamp, config.pricing);

    res.json({
      success: true,
      data: billsData
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/bills/daily/csv', (req, res, next) => {
  try {
    const { date, download } = req.query;
    const dateTimestamp = parseDateParam(date);

    const billsData = meteringPool.generateAllDailyBills(dateTimestamp, config.pricing);
    const csvContent = generateBillsSummaryCSV(billsData);
    const filename = `bills_summary_${billsData.date}.csv`;

    if (download === 'true' || download === '1') {
      const filepath = saveCSVToFile(csvContent, filename);
      return res.json({
        success: true,
        message: 'CSV 汇总已保存',
        data: {
          filename,
          filepath,
          summary: billsData.summary,
          billCount: billsData.billCount
        }
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvContent);
  } catch (err) {
    next(err);
  }
});

app.get('/api/bills/:pileId/detailed/csv', (req, res, next) => {
  try {
    const { pileId } = req.params;
    const { date, download } = req.query;
    const dateTimestamp = parseDateParam(date);

    const dateObj = new Date(dateTimestamp);
    dateObj.setHours(0, 0, 0, 0);
    const startOfDay = dateObj.getTime();
    const endOfDay = startOfDay + 86400000 - 1;

    const records = meteringPool.getRecords(pileId, startOfDay, endOfDay);
    const dateStr = dateObj.toISOString().split('T')[0];
    const csvContent = generateDetailedHourlyCSV(pileId, records);
    const filename = `detailed_${pileId}_${dateStr}.csv`;

    if (download === 'true' || download === '1') {
      const filepath = saveCSVToFile(csvContent, filename);
      return res.json({
        success: true,
        message: '明细 CSV 已保存',
        data: {
          filename,
          filepath,
          recordCount: records.length,
          date: dateStr
        }
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvContent);
  } catch (err) {
    next(err);
  }
});

app.get('/api/bills/daily/batch-download', (req, res, next) => {
  try {
    const { date } = req.query;
    const dateTimestamp = parseDateParam(date);

    const billsData = meteringPool.generateAllDailyBills(dateTimestamp, config.pricing);
    const summaryCSV = generateBillsSummaryCSV(billsData);
    const dateStr = billsData.date;

    const summaryPath = saveCSVToFile(summaryCSV, `bills_summary_${dateStr}.csv`);

    const savedFiles = [{ type: 'summary', path: summaryPath }];

    for (const bill of billsData.bills) {
      if (bill.recordCount > 0) {
        const records = meteringPool.getRecords(
          bill.pileId,
          bill.dateTimestamp,
          bill.dateTimestamp + 86400000 - 1
        );
        if (records.length > 0) {
          const detailedCSV = generateDetailedHourlyCSV(bill.pileId, records);
          const detailPath = saveCSVToFile(detailedCSV, `detailed_${bill.pileId}_${dateStr}.csv`);
          savedFiles.push({ type: 'detail', pileId: bill.pileId, path: detailPath });
        }
      }
    }

    res.json({
      success: true,
      message: '批量导出完成',
      data: {
        date: dateStr,
        billCount: billsData.billCount,
        summary: billsData.summary,
        files: savedFiles
      }
    });
  } catch (err) {
    next(err);
  }
});

app.get('/health', (req, res) => {
  const poolSize = meteringPool.getPoolSize();
  res.json({
    success: true,
    status: 'ok',
    timestamp: Date.now(),
    poolSize
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(`\n========================================`);
  console.log(`充电桩数据接收服务已启动`);
  console.log(`服务地址: http://${config.server.host}:${config.server.port}`);
  console.log(`启动时间: ${new Date().toISOString()}`);
  console.log(`========================================\n`);
});

process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务...');
  meteringPool.destroy();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在关闭服务...');
  meteringPool.destroy();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
});

module.exports = app;
