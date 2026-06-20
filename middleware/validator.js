const config = require('../config');

function validateMeteringData(req, res, next) {
  const { pileId, voltage, current } = req.body;

  if (!pileId) {
    return res.status(400).json({
      success: false,
      error: '缺少充电桩ID (pileId)'
    });
  }

  if (typeof voltage !== 'number' || isNaN(voltage)) {
    return res.status(400).json({
      success: false,
      error: '电压值无效，必须为数字'
    });
  }

  if (typeof current !== 'number' || isNaN(current)) {
    return res.status(400).json({
      success: false,
      error: '电流值无效，必须为数字'
    });
  }

  const { minVoltage, maxVoltage, minCurrent, maxCurrent } = config.validation;
  
  if (voltage < minVoltage || voltage > maxVoltage) {
    return res.status(400).json({
      success: false,
      error: `电压值超出范围，应在 ${minVoltage}V - ${maxVoltage}V 之间`
    });
  }

  if (current < minCurrent || current > maxCurrent) {
    return res.status(400).json({
      success: false,
      error: `电流值超出范围，应在 ${minCurrent}A - ${maxCurrent}A 之间`
    });
  }

  next();
}

module.exports = { validateMeteringData };
