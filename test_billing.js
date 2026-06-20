const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'localhost';
const PORT = 3001;

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: JSON.parse(body)
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBillingTest() {
  console.log('=== 按天账单与 CSV 导出功能测试 ===\n');

  console.log('1. 清空历史数据...');
  await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering',
    method: 'DELETE'
  });
  await sleep(200);
  console.log('   ✓ 数据已清空\n');

  console.log('2. 生成测试数据 - 5 个桩不同时段上报...');
  const pileIds = ['BILL-001', 'BILL-002', 'BILL-003', 'BILL-004', 'BILL-005'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const baseTimestamp = today.getTime();

  const pileConfigs = [
    { id: 'BILL-001', voltage: 220, current: 30, startHour: 9, reports: 30 },
    { id: 'BILL-002', voltage: 380, current: 20, startHour: 10, reports: 25 },
    { id: 'BILL-003', voltage: 220, current: 15, startHour: 23, reports: 20 },
    { id: 'BILL-004', voltage: 380, current: 50, startHour: 14, reports: 35 },
    { id: 'BILL-005', voltage: 220, current: 10, startHour: 20, reports: 15 }
  ];

  let totalReports = 0;
  for (const cfg of pileConfigs) {
    for (let i = 0; i < cfg.reports; i++) {
      const reportTs = baseTimestamp + cfg.startHour * 3600000 + i * 120000;
      await makeRequest({
        hostname: BASE_URL,
        port: PORT,
        path: '/api/metering/report',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        pileId: cfg.id,
        voltage: cfg.voltage + (Math.random() * 4 - 2),
        current: cfg.current + (Math.random() * 2 - 1),
        timestamp: reportTs,
        status: 'charging'
      });
      totalReports++;
    }
  }
  console.log(`   共上报 ${totalReports} 条数据\n`);

  console.log('3. 测试 1: 获取单桩日账单 JSON');
  const testPile = pileIds[0];
  const billRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/${testPile}/daily?date=${baseTimestamp}`,
    method: 'GET'
  });

  console.log(`   充电桩: ${testPile}`);
  console.log(`   账单日期: ${billRes.data.data.date}`);
  console.log(`   记录数: ${billRes.data.data.recordCount}`);
  console.log(`   总电量: ${billRes.data.data.totalEnergy.toFixed(4)} kWh`);
  console.log(`   峰时电量: ${billRes.data.data.energyBreakdown.peak.toFixed(4)} kWh`);
  console.log(`   谷时电量: ${billRes.data.data.energyBreakdown.offPeak.toFixed(4)} kWh`);
  console.log(`   峰时电费: ${billRes.data.data.costBreakdown.peak.toFixed(2)} 元`);
  console.log(`   谷时电费: ${billRes.data.data.costBreakdown.offPeak.toFixed(2)} 元`);
  console.log(`   总电费: ${billRes.data.data.costBreakdown.total.toFixed(2)} 元`);
  console.log(`   序列号: ${billRes.data.data.seqNoRange.start}-${billRes.data.data.seqNoRange.end}`);
  console.log(`   平均电压: ${billRes.data.data.avgVoltage.toFixed(2)} V`);
  console.log(`   平均电流: ${billRes.data.data.avgCurrent.toFixed(2)} A`);
  console.log(`   结果: ${billRes.data.data.recordCount > 0 ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('4. 测试 2: 单桩账单 CSV 导出（下载方式）');
  const csvRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/${testPile}/daily/csv?date=${baseTimestamp}&download=true`,
    method: 'GET'
  });

  console.log(`   文件: ${csvRes.data.data.filename}`);
  console.log(`   路径: ${csvRes.data.data.filepath}`);
  const fileExists = fs.existsSync(csvRes.data.data.filepath);
  console.log(`   文件已创建: ${fileExists ? '✓' : '✗'}`);
  
  if (fileExists) {
    const fileContent = fs.readFileSync(csvRes.data.data.filepath, 'utf8');
    const lines = fileContent.split('\n').filter(l => l.trim());
    console.log(`   行数: ${lines.length}`);
    console.log(`   CSV 内容预览:`);
    lines.slice(0, 3).forEach(l => console.log(`     ${l.substring(0, 100)}${l.length > 100 ? '...' : ''}`));
  }
  console.log(`   结果: ${fileExists ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('5. 测试 3: 单桩账单 CSV 流式下载（Content-Disposition）');
  const streamRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/${testPile}/daily/csv?date=${baseTimestamp}`,
    method: 'GET'
  });

  console.log(`   Content-Type: ${streamRes.headers['content-type']}`);
  console.log(`   Content-Disposition: ${streamRes.headers['content-disposition']}`);
  const hasBOM = typeof streamRes.data === 'string' && streamRes.data.charCodeAt(0) === 0xFEFF;
  console.log(`   含 UTF-8 BOM: ${hasBOM ? '✓' : '✗'}`);
  console.log(`   结果: ${streamRes.statusCode === 200 && hasBOM ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('6. 测试 4: 获取全部桩日账单汇总');
  const summaryRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/daily?date=${baseTimestamp}`,
    method: 'GET'
  });

  const sum = summaryRes.data.data.summary;
  console.log(`   账单日期: ${summaryRes.data.data.date}`);
  console.log(`   账单数量: ${summaryRes.data.data.billCount}`);
  console.log(`   有数据桩数: ${sum.pileCount}`);
  console.log(`   汇总总电量: ${sum.totalEnergy.toFixed(4)} kWh`);
  console.log(`   汇总峰时电量: ${sum.peakEnergy.toFixed(4)} kWh`);
  console.log(`   汇总谷时电量: ${sum.offPeakEnergy.toFixed(4)} kWh`);
  console.log(`   汇总总电费: ${sum.totalCost.toFixed(2)} 元`);
  console.log(`   各桩电费明细:`);
  summaryRes.data.data.bills.forEach(b => {
    console.log(`     [${b.pileId}] 电量: ${b.totalEnergy.toFixed(4)}kWh, 电费: ${b.costBreakdown.total.toFixed(2)}元 (${b.status})`);
  });
  console.log(`   结果: ${summaryRes.data.data.billCount === pileIds.length ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('7. 测试 5: 汇总账单 CSV 导出');
  const summaryCsvRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/daily/csv?date=${baseTimestamp}&download=true`,
    method: 'GET'
  });

  console.log(`   文件: ${summaryCsvRes.data.data.filename}`);
  console.log(`   路径: ${summaryCsvRes.data.data.filepath}`);
  const sumFileExists = fs.existsSync(summaryCsvRes.data.data.filepath);
  console.log(`   文件已创建: ${sumFileExists ? '✓' : '✗'}`);
  
  if (sumFileExists) {
    const fileContent = fs.readFileSync(summaryCsvRes.data.data.filepath, 'utf8');
    const lines = fileContent.split('\n').filter(l => l.trim());
    console.log(`   行数: ${lines.length} (表头+${pileIds.length}桩+合计行)`);
  }
  console.log(`   结果: ${sumFileExists ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('8. 测试 6: 单桩明细数据 CSV 导出');
  const detailPile = pileIds[3];
  const detailCsvRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/${detailPile}/detailed/csv?date=${baseTimestamp}&download=true`,
    method: 'GET'
  });

  console.log(`   充电桩: ${detailPile}`);
  console.log(`   文件: ${detailCsvRes.data.data.filename}`);
  console.log(`   记录数: ${detailCsvRes.data.data.recordCount}`);
  const detailExists = fs.existsSync(detailCsvRes.data.data.filepath);
  console.log(`   文件已创建: ${detailExists ? '✓' : '✗'}`);
  
  if (detailExists) {
    const fileContent = fs.readFileSync(detailCsvRes.data.data.filepath, 'utf8');
    const lines = fileContent.split('\n').filter(l => l.trim());
    console.log(`   CSV 行数: ${lines.length} (表头+${detailCsvRes.data.data.recordCount}条)`);
    if (lines.length > 1) {
      console.log(`   首条数据预览: ${lines[1].substring(0, 80)}...`);
    }
  }
  console.log(`   结果: ${detailExists ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('9. 测试 7: 批量导出全部桩汇总+明细');
  const batchRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/daily/batch-download?date=${baseTimestamp}`,
    method: 'GET'
  });

  console.log(`   日期: ${batchRes.data.data.date}`);
  console.log(`   账单数: ${batchRes.data.data.billCount}`);
  console.log(`   生成文件数: ${batchRes.data.data.files.length}`);
  console.log(`   汇总总电量: ${batchRes.data.data.summary.totalEnergy.toFixed(4)} kWh`);
  console.log(`   汇总总电费: ${batchRes.data.data.summary.totalCost.toFixed(2)} 元`);
  console.log(`   文件列表:`);
  
  let allFilesCreated = true;
  batchRes.data.data.files.forEach(f => {
    const exists = fs.existsSync(f.path);
    if (!exists) allFilesCreated = false;
    console.log(`     [${f.type}] ${f.pileId || '汇总'}: ${path.basename(f.path)} ${exists ? '✓' : '✗'}`);
  });
  console.log(`   结果: ${allFilesCreated ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('10. 测试 8: 峰谷电价计算验证');
  const peakPile = pileConfigs[0];
  const offPeakPile = pileConfigs[2];
  
  const peakBillRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/${peakPile.id}/daily?date=${baseTimestamp}`,
    method: 'GET'
  });
  const offPeakBillRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/bills/${offPeakPile.id}/daily?date=${baseTimestamp}`,
    method: 'GET'
  });

  console.log(`   峰时段桩 ${peakPile.id} (开始于 ${peakPile.startHour}:00):`);
  console.log(`     峰时电量占比: ${((peakBillRes.data.data.energyBreakdown.peak / (peakBillRes.data.data.totalEnergy || 1)) * 100).toFixed(1)}%`);
  console.log(`   谷时段桩 ${offPeakPile.id} (开始于 ${offPeakPile.startHour}:00):`);
  console.log(`     谷时电量占比: ${((offPeakBillRes.data.data.energyBreakdown.offPeak / (offPeakBillRes.data.data.totalEnergy || 1)) * 100).toFixed(1)}%`);
  
  const peakIsMostlyPeak = (peakBillRes.data.data.energyBreakdown.peak / (peakBillRes.data.data.totalEnergy || 1)) > 0.5;
  const offPeakIsMostlyOffPeak = (offPeakBillRes.data.data.energyBreakdown.offPeak / (offPeakBillRes.data.data.totalEnergy || 1)) > 0.5;
  console.log(`   峰谷识别结果: 峰时${peakIsMostlyPeak ? '✓' : '✗'}, 谷时${offPeakIsMostlyOffPeak ? '✓' : '✗'}`);
  console.log(`   结果: ${peakIsMostlyPeak && offPeakIsMostlyOffPeak ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('11. 导出目录文件总览');
  const exportsDir = path.join(process.cwd(), 'exports');
  if (fs.existsSync(exportsDir)) {
    const files = fs.readdirSync(exportsDir);
    console.log(`   导出目录: ${exportsDir}`);
    console.log(`   文件数量: ${files.length}`);
    files.forEach(f => {
      const stats = fs.statSync(path.join(exportsDir, f));
      console.log(`     ${f} (${(stats.size / 1024).toFixed(1)} KB)`);
    });
  }
  console.log();

  console.log('=== 账单功能测试完成 ===');
}

runBillingTest().catch(console.error);
