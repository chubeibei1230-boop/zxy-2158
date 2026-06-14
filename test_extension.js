'use strict';

const http = require('http');

const baseUrl = 'localhost';
const port = 8113;

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: baseUrl,
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function test() {
  const adminHeader = { 'X-User': 'admin' };
  const windowHeader = { 'X-User': 'window1' };
  const observerHeader = { 'X-User': 'observer1' };

  console.log('=== 1. 健康检查 ===');
  const health = await request('GET', '/health', {});
  console.log('  状态:', health.body.status);
  console.log('  延期申请统计:', health.body.stats.extensionApplications);

  console.log('\n=== 2. 获取区域列表 ===');
  const areas = await request('GET', '/api/queries/areas', adminHeader);
  const areaId = areas.body.data[0].id;
  console.log('  区域:', areas.body.data[0].name, 'ID:', areaId);

  console.log('\n=== 3. 创建批次 (管理员) ===');
  const batchBody = {
    batchNo: 'TEST-BATCH-EXT-001',
    prefix: 'TEX',
    startSeq: 1,
    endSeq: 5,
    padLength: 4,
    areaId: areaId,
    validFrom: '2026-06-10T00:00:00.000Z',
    validTo: '2026-06-15T23:59:59.999Z'
  };
  const batch = await request('POST', '/api/batches', adminHeader, batchBody);
  const batchId = batch.body.data.id;
  console.log('  批次创建成功:', batch.body.data.batchNo);

  console.log('\n=== 4. 发放凭证 (窗口人员) ===');
  const issueBody = {
    batchId: batchId,
    recipientName: '张三',
    recipientIdCard: '110101199001011234',
    recipientPhone: '13800138000'
  };
  const credential = await request('POST', '/api/credentials/issue', windowHeader, issueBody);
  const credId = credential.body.data.id;
  const credNo = credential.body.data.credentialNo;
  console.log('  凭证发放成功:', credNo);
  console.log('  有效期至:', credential.body.data.validTo);

  console.log('\n=== 5. 提交延期申请 (窗口人员) ===');
  const extApplyBody = {
    credentialId: credId,
    newValidTo: '2026-06-30T23:59:59.999Z',
    reason: '工作需要延长',
    recipientName: '张三',
    recipientIdCard: '110101199001011234'
  };
  const extApp = await request('POST', '/api/extensions/apply', windowHeader, extApplyBody);
  const extAppId = extApp.body.data.id;
  console.log('  延期申请提交成功, ID:', extAppId);
  console.log('  状态:', extApp.body.data.status);
  console.log('  原有效期至:', extApp.body.data.originalValidTo);
  console.log('  申请延期至:', extApp.body.data.newValidTo);

  console.log('\n=== 6. 查询待审批延期申请列表 ===');
  const pendingExts = await request('GET', '/api/extensions?status=pending', adminHeader);
  console.log('  待审批申请数量:', pendingExts.body.data.total);

  console.log('\n=== 7. 查看凭证详情 (含延期信息) ===');
  const credDetail = await request('GET', `/api/queries/credentials/${credId}`, windowHeader);
  console.log('  凭证是否有待审批延期:', credDetail.body.data.credential.hasPendingExtension);
  console.log('  延期申请总数:', credDetail.body.data.extensionApplications.length);

  console.log('\n=== 8. 审批通过延期申请 (管理员) ===');
  const approved = await request('POST', `/api/extensions/${extAppId}/approve`, adminHeader);
  console.log('  审批结果:', approved.body.data.status);
  console.log('  审批人:', approved.body.data.approver);

  console.log('\n=== 9. 验证凭证有效期已更新 ===');
  const credAfter = await request('GET', `/api/queries/credentials/${credId}`, windowHeader);
  console.log('  凭证当前有效期至:', credAfter.body.data.credential.validTo);
  console.log('  批准延期数量:', credAfter.body.data.credential.approvedExtensionCount);

  console.log('\n=== 10. 测试驳回延期申请 ===');
  const extApplyBody2 = {
    credentialId: credId,
    newValidTo: '2026-07-05T23:59:59.999Z',
    reason: '继续延长',
    recipientName: '张三',
    recipientIdCard: '110101199001011234'
  };
  const extApp2 = await request('POST', '/api/extensions/apply', windowHeader, extApplyBody2);
  console.log('  第二次申请状态码:', extApp2.statusCode);
  console.log('  第二次申请响应:', JSON.stringify(extApp2.body));
  const extAppId2 = extApp2.body.data.id;
  console.log('  第二次延期申请提交成功, ID:', extAppId2);

  const rejectBody = { reason: '延期时间过长' };
  const rejected = await request('POST', `/api/extensions/${extAppId2}/reject`, adminHeader, rejectBody);
  console.log('  驳回结果:', rejected.body.data.status);
  console.log('  驳回原因:', rejected.body.data.rejectReason);

  console.log('\n=== 11. 测试权限控制 (观察员无权提交) ===');
  const extApplyBody3 = {
    credentialId: credId,
    newValidTo: '2026-07-06T23:59:59.999Z',
    reason: '再试一次',
    recipientName: '张三',
    recipientIdCard: '110101199001011234'
  };
  const observerApply = await request('POST', '/api/extensions/apply', observerHeader, extApplyBody3);
  console.log('  状态码:', observerApply.statusCode, '(预期403)');
  console.log('  错误码:', observerApply.body.code);

  console.log('\n=== 12. 测试领取人信息校验 ===');
  const extApplyBody4 = {
    credentialId: credId,
    newValidTo: '2026-07-31T23:59:59.999Z',
    reason: '测试错误信息',
    recipientName: '李四',
    recipientIdCard: '110101199001011234'
  };
  const wrongRecipient = await request('POST', '/api/extensions/apply', windowHeader, extApplyBody4);
  console.log('  状态码:', wrongRecipient.statusCode, '(预期400)');
  console.log('  错误码:', wrongRecipient.body.code);

  console.log('\n=== 13. 测试重复申请校验 ===');
  const extApplyBody5 = {
    credentialId: credId,
    newValidTo: '2026-07-08T23:59:59.999Z',
    reason: '测试重复',
    recipientName: '张三',
    recipientIdCard: '110101199001011234'
  };
  const firstPending = await request('POST', '/api/extensions/apply', windowHeader, extApplyBody5);
  console.log('  第一个待审批申请状态码:', firstPending.statusCode);
  console.log('  第一个待审批申请ID:', firstPending.body.data ? firstPending.body.data.id : 'N/A');

  const duplicate = await request('POST', '/api/extensions/apply', windowHeader, extApplyBody5);
  console.log('  重复申请状态码:', duplicate.statusCode, '(预期400)');
  console.log('  错误码:', duplicate.body.code);

  console.log('\n=== 14. 测试最大有效期限制 ===');
  const extApplyBody6 = {
    credentialId: credId,
    newValidTo: '2026-12-31T23:59:59.999Z',
    reason: '测试超长延期',
    recipientName: '张三',
    recipientIdCard: '110101199001011234'
  };
  const tooLong = await request('POST', '/api/extensions/apply', windowHeader, extApplyBody6);
  console.log('  超长延期状态码:', tooLong.statusCode, '(预期400)');
  console.log('  错误码:', tooLong.body.code);

  console.log('\n=== 15. 查看操作审计日志 ===');
  const auditLogs = await request('GET', '/api/queries/audit-logs', adminHeader);
  const extLogs = auditLogs.body.data.filter(l => l.action.startsWith('EXTENSION_'));
  console.log('  延期相关审计日志数量:', extLogs.length);
  extLogs.forEach(log => {
    console.log('   -', log.action, ':', log.detail);
  });

  console.log('\n=== 16. 按凭证号查询 (含延期信息) ===');
  const credByNo = await request('GET', `/api/queries/credentials-by-no/${credNo}`, windowHeader);
  console.log('  凭证号:', credByNo.body.data.credentialNo);
  console.log('  延期申请次数:', credByNo.body.data.extensionCount);
  console.log('  是否有待审批:', credByNo.body.data.hasPendingExtension);

  console.log('\n=== 全部测试完成 ===');
}

test().catch(err => {
  console.error('测试出错:', err.message);
  console.error(err.stack);
  process.exit(1);
});
