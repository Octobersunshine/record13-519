const fs = require('fs');
const path = require('path');

function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateSingleBillCSV(bill) {
  const headers = [
    '充电桩ID', '账单日期', '记录数',
    '总电量(kWh)', '峰时电量(kWh)', '谷时电量(kWh)',
    '峰时电费(元)', '谷时电费(元)', '服务费(元)', '总电费(元)',
    '平均电压(V)', '平均电流(A)', '平均功率(W)',
    '峰时电价(元/kWh)', '谷时电价(元/kWh)',
    '起始序列号', '结束序列号',
    '数据状态', '生成时间'
  ];

  const row = [
    bill.pileId,
    bill.date,
    bill.recordCount,
    bill.totalEnergy.toFixed(4),
    bill.energyBreakdown.peak.toFixed(4),
    bill.energyBreakdown.offPeak.toFixed(4),
    bill.costBreakdown.peak.toFixed(2),
    bill.costBreakdown.offPeak.toFixed(2),
    bill.costBreakdown.service.toFixed(2),
    bill.costBreakdown.total.toFixed(2),
    bill.avgVoltage ? bill.avgVoltage.toFixed(2) : '0.00',
    bill.avgCurrent ? bill.avgCurrent.toFixed(2) : '0.00',
    bill.avgPower ? bill.avgPower.toFixed(2) : '0.00',
    bill.priceInfo.peakRate.toFixed(2),
    bill.priceInfo.offPeakRate.toFixed(2),
    bill.seqNoRange ? bill.seqNoRange.start : '-',
    bill.seqNoRange ? bill.seqNoRange.end : '-',
    bill.status,
    new Date(bill.generatedAt).toISOString()
  ];

  return [
    headers.map(escapeCSV).join(','),
    row.map(escapeCSV).join(',')
  ].join('\n') + '\n';
}

function generateBillsSummaryCSV(billsData) {
  const headers = [
    '序号', '充电桩ID', '账单日期', '记录数',
    '总电量(kWh)', '峰时电量(kWh)', '谷时电量(kWh)',
    '峰时电费(元)', '谷时电费(元)', '服务费(元)', '总电费(元)',
    '平均电压(V)', '平均电流(A)', '平均功率(W)',
    '数据状态'
  ];

  const lines = [headers.map(escapeCSV).join(',')];

  billsData.bills.forEach((bill, index) => {
    const row = [
      index + 1,
      bill.pileId,
      bill.date,
      bill.recordCount,
      bill.totalEnergy.toFixed(4),
      bill.energyBreakdown.peak.toFixed(4),
      bill.energyBreakdown.offPeak.toFixed(4),
      bill.costBreakdown.peak.toFixed(2),
      bill.costBreakdown.offPeak.toFixed(2),
      bill.costBreakdown.service.toFixed(2),
      bill.costBreakdown.total.toFixed(2),
      bill.avgVoltage ? bill.avgVoltage.toFixed(2) : '0.00',
      bill.avgCurrent ? bill.avgCurrent.toFixed(2) : '0.00',
      bill.avgPower ? bill.avgPower.toFixed(2) : '0.00',
      bill.status
    ];
    lines.push(row.map(escapeCSV).join(','));
  });

  const summary = billsData.summary;
  const summaryRow = [
    '', '合计', billsData.date, billsData.bills.reduce((s, b) => s + b.recordCount, 0),
    summary.totalEnergy.toFixed(4),
    summary.peakEnergy.toFixed(4),
    summary.offPeakEnergy.toFixed(4),
    summary.peakCost.toFixed(2),
    summary.offPeakCost.toFixed(2),
    summary.serviceCost.toFixed(2),
    summary.totalCost.toFixed(2),
    '', '', '',
    `共${summary.pileCount}个桩有数据`
  ];
  lines.push(summaryRow.map(escapeCSV).join(','));

  return lines.join('\n') + '\n';
}

function generateDetailedHourlyCSV(pileId, records) {
  const headers = [
    '序号', '序列号', '时间戳', '日期时间',
    '电压(V)', '电流(A)', '功率(W)',
    '时段增量电量(kWh)', '数据标签'
  ];

  const lines = [headers.map(escapeCSV).join(',')];

  records.forEach((record, index) => {
    const datetime = new Date(record.timestamp);
    const row = [
      index + 1,
      record.seqNo,
      record.timestamp,
      datetime.toISOString().replace('T', ' ').substring(0, 19),
      record.voltage.toFixed(2),
      record.current.toFixed(2),
      record.power.toFixed(2),
      (record.deltaEnergy || 0).toFixed(4),
      record.status || record.label || ''
    ];
    lines.push(row.map(escapeCSV).join(','));
  });

  return lines.join('\n') + '\n';
}

function saveCSVToFile(content, filename) {
  const exportsDir = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const filepath = path.join(exportsDir, filename);
  fs.writeFileSync(filepath, '\uFEFF' + content, 'utf8');
  return filepath;
}

module.exports = {
  escapeCSV,
  generateSingleBillCSV,
  generateBillsSummaryCSV,
  generateDetailedHourlyCSV,
  saveCSVToFile
};
