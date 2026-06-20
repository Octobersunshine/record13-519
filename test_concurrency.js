const http = require('http');

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
            data: JSON.parse(body)
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
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

function randomVoltage() {
  return 220 + Math.random() * 20 - 10;
}

function randomCurrent() {
  return 10 + Math.random() * 20;
}

async function sendReport(pileId, timestamp) {
  const data = {
    pileId,
    voltage: parseFloat(randomVoltage().toFixed(2)),
    current: parseFloat(randomCurrent().toFixed(2)),
    status: 'charging',
    temperature: parseFloat((25 + Math.random() * 10).toFixed(1))
  };
  
  if (timestamp) {
    data.timestamp = timestamp;
  }

  return makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/report',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, data);
}

async function runConcurrencyTest() {
  console.log('=== 并发与电量计算修复验证测试 ===\n');

  console.log('1. 清空所有数据...');
  await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering',
    method: 'DELETE'
  });
  await sleep(500);
  const healthCheck = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/health',
    method: 'GET'
  });
  console.log(`   清空后池状态: ${healthCheck.data.poolSize.pileCount} 桩, ${healthCheck.data.poolSize.totalRecords} 条记录`);
  console.log('   ✓ 数据已清空\n');

  console.log('2. 测试 1: 单桩连续上报 - 验证序列号连续性');
  const pileId = 'TEST-CONC-001';
  const reportCount = 100;
  const results = [];

  for (let i = 0; i < reportCount; i++) {
    const res = await sendReport(pileId);
    results.push(res.data.data);
    await sleep(10);
  }

  console.log(`   上报 ${reportCount} 条数据`);
  
  const seqNos = results.map(r => r.seqNo).sort((a, b) => a - b);
  let seqErrors = 0;
  for (let i = 1; i < seqNos.length; i++) {
    if (seqNos[i] !== seqNos[i - 1] + 1) {
      seqErrors++;
    }
  }
  
  console.log(`   序列号范围: ${seqNos[0]} - ${seqNos[seqNos.length - 1]}`);
  console.log(`   序列号不连续次数: ${seqErrors}`);
  console.log(`   结果: ${seqErrors === 0 ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('3. 测试 2: 多桩并发上报 - 验证数据隔离');
  const pileIds = ['TEST-CONC-002', 'TEST-CONC-003', 'TEST-CONC-004', 'TEST-CONC-005'];
  const concurrentPromises = [];
  const perPileCount = 50;

  const baseTime = Date.now();
  for (let i = 0; i < perPileCount; i++) {
    for (const pid of pileIds) {
      concurrentPromises.push(sendReport(pid, baseTime + i * 100));
    }
  }

  console.log(`   ${pileIds.length} 个桩并发上报，每桩 ${perPileCount} 条...`);
  const concurrentResults = await Promise.all(concurrentPromises);
  
  const successCount = concurrentResults.filter(r => r.statusCode === 200).length;
  console.log(`   成功上报: ${successCount}/${concurrentResults.length}`);

  const seqMap = {};
  let debugCount = 0;
  for (const res of concurrentResults) {
    if (res.statusCode === 200 && res.data && res.data.data) {
      const data = res.data.data;
      if (!seqMap[data.pileId]) {
        seqMap[data.pileId] = [];
      }
      seqMap[data.pileId].push(data.seqNo);
    } else {
      debugCount++;
      if (debugCount <= 5) {
        console.log(`   异常响应 #${debugCount}: ${res.statusCode} - ${typeof res.data === 'string' ? res.data.substring(0, 100) : JSON.stringify(res.data).substring(0, 100)}`);
      }
    }
  }
  console.log(`   收集到 ${Object.keys(seqMap).length} 个桩的数据, 异常: ${debugCount}`);
  console.log(`   桩ID列表: ${Object.keys(seqMap).join(', ')}`);

  let allPass = true;
  for (const pid of pileIds) {
    const seqs = seqMap[pid];
    if (!seqs || seqs.length === 0) {
      console.log(`   [${pid}] 无数据`);
      allPass = false;
      continue;
    }
    const sortedSeqs = seqs.sort((a, b) => a - b);
    let errors = 0;
    for (let i = 1; i < sortedSeqs.length; i++) {
      if (sortedSeqs[i] !== sortedSeqs[i - 1] + 1) {
        errors++;
      }
    }
    console.log(`   [${pid}] 序列号范围: ${sortedSeqs[0]}-${sortedSeqs[sortedSeqs.length - 1]}, 不连续: ${errors}`);
    if (errors > 0) allPass = false;
  }
  console.log(`   结果: ${allPass ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('4. 测试 3: 电量累加准确性验证');
  const pileId3 = 'TEST-ENERGY-001';
  const energyResults = [];
  const interval = 100;
  const count = 20;
  const fixedVoltage = 220;
  const fixedCurrent = 10;
  const fixedPower = fixedVoltage * fixedCurrent;

  for (let i = 0; i < count; i++) {
    const res = await makeRequest({
      hostname: BASE_URL,
      port: PORT,
      path: '/api/metering/report',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      pileId: pileId3,
      voltage: fixedVoltage,
      current: fixedCurrent,
      timestamp: baseTime + i * interval
    });
    energyResults.push(res.data.data);
    await sleep(10);
  }

  const lastRecord = energyResults[energyResults.length - 1];
  const totalEnergyFromApi = lastRecord.totalEnergy;
  
  const expectedEnergy = (fixedPower * (count - 1) * interval) / 3600000;
  
  console.log(`   固定功率: ${fixedPower}W = ${fixedVoltage}V × ${fixedCurrent}A`);
  console.log(`   上报间隔: ${interval}ms, 次数: ${count}`);
  console.log(`   预期电量: ${expectedEnergy.toFixed(6)} Wh`);
  console.log(`   API 返回累计电量: ${totalEnergyFromApi.toFixed(6)} Wh`);
  console.log(`   误差: ${Math.abs(totalEnergyFromApi - expectedEnergy).toFixed(6)} Wh`);
  console.log(`   结果: ${Math.abs(totalEnergyFromApi - expectedEnergy) < 0.001 ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('5. 测试 4: 时段预聚合验证');
  const statsRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/metering/${pileId3}/statistics?groupBy=hour`,
    method: 'GET'
  });

  console.log(`   /statistics?groupBy=hour 响应:`);
  console.log(`     序列号范围: ${statsRes.data.data.seqNoRange.start} - ${statsRes.data.data.seqNoRange.end}`);
  console.log(`     预期序列号数: ${statsRes.data.data.seqNoRange.expected}`);
  console.log(`     实际序列号数: ${statsRes.data.data.recordCount}`);
  console.log(`     缺失序列号数: ${statsRes.data.data.seqNoRange.missing}`);
  console.log(`     记录累加电量: ${statsRes.data.data.energy.total.toFixed(6)} Wh`);
  console.log(`     桶聚合电量: ${statsRes.data.data.energy.fromBuckets.toFixed(6)} Wh`);
  console.log(`     累计总电量: ${statsRes.data.data.totalEnergy.toFixed(6)} Wh`);
  
  const seqPass = statsRes.data.data.seqNoRange.missing === 0;
  const energyPass = Math.abs(statsRes.data.data.energy.total - statsRes.data.data.energy.fromBuckets) < 0.001;
  console.log(`     序列号连续: ${seqPass ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`     电量计算一致: ${energyPass ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`     结果: ${seqPass && energyPass ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('6. 测试 5: 获取充电桩状态');
  const stateRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: `/api/metering/${pileId3}/state`,
    method: 'GET'
  });

  console.log(`   /state 响应:`);
  console.log(`     当前序列号: ${stateRes.data.data.seqNo}`);
  console.log(`     累计电量: ${stateRes.data.data.totalEnergy.toFixed(6)} Wh`);
  console.log(`     记录数: ${stateRes.data.data.recordCount}`);
  console.log(`     小时桶数: ${stateRes.data.data.hourlyBucketCount}`);
  console.log(`     天桶数: ${stateRes.data.data.dailyBucketCount}`);
  console.log(`     结果: ${stateRes.data.data.seqNo === count ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('7. 测试 6: 同一时段多桩电量互不干扰');
  console.log('   清空数据准备测试...');
  await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering',
    method: 'DELETE'
  });
  await sleep(200);
  
  const pileIdsMulti = ['TEST-MULTI-001', 'TEST-MULTI-002', 'TEST-MULTI-003'];
  const multiBaseTime = Date.now();
  
  for (const pid of pileIdsMulti) {
    for (let i = 0; i < 10; i++) {
      await makeRequest({
        hostname: BASE_URL,
        port: PORT,
        path: '/api/metering/report',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, {
        pileId: pid,
        voltage: 200 + parseInt(pid.split('-')[2]) * 10,
        current: 10 + parseInt(pid.split('-')[2]),
        timestamp: multiBaseTime + i * 200
      });
    }
  }

  console.log(`   ${pileIdsMulti.length} 个桩同时段上报完成`);
  let totalAllEnergy = 0;
  for (const pid of pileIdsMulti) {
    const state = await makeRequest({
      hostname: BASE_URL,
      port: PORT,
      path: `/api/metering/${pid}/state`,
      method: 'GET'
    });
    console.log(`   [${pid}] 累计电量: ${state.data.data.totalEnergy.toFixed(6)} Wh, 序列号: ${state.data.data.seqNo}`);
    totalAllEnergy += state.data.data.totalEnergy;
  }

  const poolSize = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/piles',
    method: 'GET'
  });
  console.log(`   汇总池总电量: ${poolSize.data.data.poolSize.totalEnergy.toFixed(6)} Wh`);
  console.log(`   累加各桩电量: ${totalAllEnergy.toFixed(6)} Wh`);
  console.log(`   结果: ${Math.abs(poolSize.data.data.poolSize.totalEnergy - totalAllEnergy) < 0.001 ? '✓ PASS' : '✗ FAIL'}\n`);

  console.log('=== 测试完成 ===');
}

runConcurrencyTest().catch(console.error);
