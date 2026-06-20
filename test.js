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

async function runTests() {
  console.log('=== 充电桩数据服务测试 ===\n');

  console.log('1. 检查服务健康状态...');
  const healthRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/health',
    method: 'GET'
  });
  console.log('   状态:', healthRes.statusCode);
  console.log('   响应:', JSON.stringify(healthRes.data, null, 2));
  console.log();

  console.log('2. 模拟 3 个充电桩连续上报数据...');
  const pileIds = ['CP-001', 'CP-002', 'CP-003'];
  
  for (let i = 0; i < 5; i++) {
    for (const pileId of pileIds) {
      const reportData = {
        pileId,
        voltage: parseFloat(randomVoltage().toFixed(2)),
        current: parseFloat(randomCurrent().toFixed(2)),
        status: 'charging',
        temperature: parseFloat((25 + Math.random() * 10).toFixed(1))
      };

      const reportRes = await makeRequest({
        hostname: BASE_URL,
        port: PORT,
        path: '/api/metering/report',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, reportData);

      console.log(`   [${pileId}] 上报 #${i + 1} - 状态: ${reportRes.statusCode}`);
    }
    await sleep(200);
  }
  console.log();

  console.log('3. 获取所有充电桩列表...');
  const pilesRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/piles',
    method: 'GET'
  });
  console.log('   状态:', pilesRes.statusCode);
  console.log('   充电桩列表:', JSON.stringify(pilesRes.data, null, 2));
  console.log();

  console.log('4. 获取 CP-001 最新数据...');
  const latestRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/CP-001/latest',
    method: 'GET'
  });
  console.log('   状态:', latestRes.statusCode);
  console.log('   最新数据:', JSON.stringify(latestRes.data, null, 2));
  console.log();

  console.log('5. 获取 CP-001 全部历史数据...');
  const recordsRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/CP-001/records',
    method: 'GET'
  });
  console.log('   状态:', recordsRes.statusCode);
  console.log('   数据条数:', recordsRes.data.data.count);
  console.log('   第一条:', JSON.stringify(recordsRes.data.data.records[0], null, 2));
  console.log();

  console.log('6. 获取 CP-001 统计数据...');
  const statsRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/CP-001/statistics',
    method: 'GET'
  });
  console.log('   状态:', statsRes.statusCode);
  console.log('   统计数据:', JSON.stringify(statsRes.data, null, 2));
  console.log();

  console.log('7. 测试数据验证 - 无效电压值...');
  const invalidRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/report',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, {
    pileId: 'CP-001',
    voltage: 9999,
    current: 10
  });
  console.log('   状态:', invalidRes.statusCode);
  console.log('   错误信息:', invalidRes.data.error);
  console.log();

  console.log('8. 测试数据验证 - 缺少 pileId...');
  const missingRes = await makeRequest({
    hostname: BASE_URL,
    port: PORT,
    path: '/api/metering/report',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, {
    voltage: 220,
    current: 10
  });
  console.log('   状态:', missingRes.statusCode);
  console.log('   错误信息:', missingRes.data.error);
  console.log();

  console.log('=== 测试完成 ===');
}

runTests().catch(console.error);
