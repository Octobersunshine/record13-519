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
