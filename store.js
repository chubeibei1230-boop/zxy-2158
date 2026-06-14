'use strict';

let idCounter = 0;
function generateId() {
  return `${Date.now()}-${++idCounter}`;
}

const store = {
  batches: new Map(),
  credentials: new Map(),
  credentialNoIndex: new Map(),
  areas: new Map(),
  users: new Map(),
  anomalies: new Map(),
  rules: new Map(),
  auditLogs: [],
  extensionApplications: new Map()
};

function initSeedData() {
  const users = [
    { id: generateId(), username: 'admin', password: 'admin123', role: 'admin', name: '系统管理员' },
    { id: generateId(), username: 'window1', password: 'window123', role: 'window', name: '窗口人员A' },
    { id: generateId(), username: 'window2', password: 'window123', role: 'window', name: '窗口人员B' },
    { id: generateId(), username: 'observer1', password: 'observer123', role: 'observer', name: '观察员A' }
  ];
  users.forEach(u => store.users.set(u.username, u));

  const areas = [
    { id: generateId(), name: 'A区', entryPoints: ['A1入口', 'A2入口', 'A3入口'], createdAt: new Date().toISOString() },
    { id: generateId(), name: 'B区', entryPoints: ['B1入口', 'B2入口'], createdAt: new Date().toISOString() },
    { id: generateId(), name: 'C区', entryPoints: ['C1入口'], createdAt: new Date().toISOString() }
  ];
  areas.forEach(a => store.areas.set(a.id, a));

  const rules = [
    { id: generateId(), key: 'concentration_threshold', value: 10, description: '同入口异常集中阈值（时间窗口内核销次数）', unit: '次', updatedAt: new Date().toISOString() },
    { id: generateId(), key: 'concentration_window_minutes', value: 5, description: '异常集中检测时间窗口', unit: '分钟', updatedAt: new Date().toISOString() },
    { id: generateId(), key: 'max_validity_days', value: 30, description: '凭证最大有效天数', unit: '天', updatedAt: new Date().toISOString() }
  ];
  rules.forEach(r => store.rules.set(r.key, r));
}

function getUserByUsername(username) {
  return store.users.get(username) || null;
}

function createArea(data) {
  const area = {
    id: generateId(),
    name: data.name,
    entryPoints: data.entryPoints || [],
    createdAt: new Date().toISOString()
  };
  store.areas.set(area.id, area);
  return area;
}

function getAreas() {
  return Array.from(store.areas.values());
}

function getAreaById(id) {
  return store.areas.get(id) || null;
}

function updateArea(id, data) {
  const area = store.areas.get(id);
  if (!area) return null;
  if (data.name !== undefined) area.name = data.name;
  if (data.entryPoints !== undefined) area.entryPoints = data.entryPoints;
  area.updatedAt = new Date().toISOString();
  return area;
}

function checkNumberRangeOverlap(prefix, startSeq, endSeq, excludeBatchId) {
  for (const [, batch] of store.batches) {
    if (batch.id === excludeBatchId) continue;
    if (batch.status === 'voided') continue;
    if (batch.prefix !== prefix) continue;
    if (Math.max(startSeq, batch.startSeq) <= Math.min(endSeq, batch.endSeq)) {
      return batch;
    }
  }
  return null;
}

function createBatch(data) {
  const overlap = checkNumberRangeOverlap(data.prefix, data.startSeq, data.endSeq);
  if (overlap) {
    const err = new Error(`号段与批次 ${overlap.batchNo} 冲突`);
    err.code = 'RANGE_OVERLAP';
    throw err;
  }

  const area = store.areas.get(data.areaId);
  if (!area) {
    const err = new Error('区域不存在');
    err.code = 'AREA_NOT_FOUND';
    throw err;
  }

  const maxDays = getRuleValue('max_validity_days');
  const validDays = (new Date(data.validTo) - new Date(data.validFrom)) / (1000 * 60 * 60 * 24);
  if (validDays > maxDays) {
    const err = new Error(`有效天数 ${Math.ceil(validDays)} 超过最大限制 ${maxDays} 天`);
    err.code = 'INVALID_VALIDITY';
    throw err;
  }

  const batch = {
    id: generateId(),
    batchNo: data.batchNo,
    prefix: data.prefix,
    startSeq: data.startSeq,
    endSeq: data.endSeq,
    padLength: data.padLength || 4,
    areaId: data.areaId,
    area: area.name,
    validFrom: data.validFrom,
    validTo: data.validTo,
    status: 'active',
    total: data.endSeq - data.startSeq + 1,
    remark: data.remark || '',
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy
  };

  store.batches.set(batch.id, batch);

  for (let seq = batch.startSeq; seq <= batch.endSeq; seq++) {
    const no = `${batch.prefix}${String(seq).padStart(batch.padLength, '0')}`;
    const cred = {
      id: generateId(),
      credentialNo: no,
      batchId: batch.id,
      batchNo: batch.batchNo,
      prefix: batch.prefix,
      seq: seq,
      areaId: batch.areaId,
      area: batch.area,
      validFrom: batch.validFrom,
      validTo: batch.validTo,
      status: '待发放',
      recipientName: null,
      recipientIdCard: null,
      recipientPhone: null,
      issuedAt: null,
      issuedBy: null,
      verifiedAt: null,
      verifiedBy: null,
      entryPoint: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      inventoryAt: null,
      anomalies: []
    };
    store.credentials.set(cred.id, cred);
    store.credentialNoIndex.set(no, cred.id);
  }

  addAuditLog('BATCH_CREATE', batch.id, data.createdBy, `创建批次 ${batch.batchNo}，号段 ${batch.prefix}${String(batch.startSeq).padStart(batch.padLength, '0')}-${batch.prefix}${String(batch.endSeq).padStart(batch.padLength, '0')}`);
  return batch;
}

function getBatches(filter) {
  let result = Array.from(store.batches.values());
  if (filter) {
    if (filter.status) result = result.filter(b => b.status === filter.status);
    if (filter.area) result = result.filter(b => b.area === filter.area);
    if (filter.batchNo) result = result.filter(b => b.batchNo.includes(filter.batchNo));
  }
  return result;
}

function getBatchById(id) {
  return store.batches.get(id) || null;
}

function updateBatch(id, data) {
  const batch = store.batches.get(id);
  if (!batch) return null;

  if (data.validFrom !== undefined) batch.validFrom = data.validFrom;
  if (data.validTo !== undefined) batch.validTo = data.validTo;
  if (data.remark !== undefined) batch.remark = data.remark;
  if (data.areaId !== undefined) {
    const area = store.areas.get(data.areaId);
    if (area) {
      batch.areaId = data.areaId;
      batch.area = area.name;
    }
  }
  batch.updatedAt = new Date().toISOString();

  if (data.validFrom !== undefined || data.validTo !== undefined) {
    for (const [, cred] of store.credentials) {
      if (cred.batchId === id && (cred.status === '待发放' || cred.status === '已发放')) {
        if (data.validFrom !== undefined) cred.validFrom = data.validFrom;
        if (data.validTo !== undefined) cred.validTo = data.validTo;
      }
    }
  }

  if (data.areaId !== undefined) {
    const area = store.areas.get(data.areaId);
    if (area) {
      for (const [, cred] of store.credentials) {
        if (cred.batchId === id && cred.status === '待发放') {
          cred.areaId = data.areaId;
          cred.area = area.name;
        }
      }
    }
  }

  return batch;
}

function voidBatch(id, voidedBy, reason) {
  const batch = store.batches.get(id);
  if (!batch) return null;
  if (batch.status === 'voided') {
    const err = new Error('批次已作废');
    err.code = 'ALREADY_VOIDED';
    throw err;
  }

  batch.status = 'voided';
  batch.voidedAt = new Date().toISOString();
  batch.voidedBy = voidedBy;
  batch.voidReason = reason || '';

  for (const [, cred] of store.credentials) {
    if (cred.batchId === id && cred.status === '待发放') {
      cred.status = '已作废';
      cred.voidedAt = new Date().toISOString();
      cred.voidedBy = voidedBy;
      cred.voidReason = reason || '批次作废';
    }
  }

  addAuditLog('BATCH_VOID', id, voidedBy, `作废批次 ${batch.batchNo}${reason ? '：' + reason : ''}`);
  return batch;
}

function getCredentialById(id) {
  return store.credentials.get(id) || null;
}

function getCredentialByNo(no) {
  const id = store.credentialNoIndex.get(no);
  return id ? store.credentials.get(id) : null;
}

function getCredentials(filter) {
  let result = Array.from(store.credentials.values());
  if (filter) {
    if (filter.batchId) result = result.filter(c => c.batchId === filter.batchId);
    if (filter.batchNo) result = result.filter(c => c.batchNo === filter.batchNo);
    if (filter.area) result = result.filter(c => c.area === filter.area);
    if (filter.areaId) result = result.filter(c => c.areaId === filter.areaId);
    if (filter.status) result = result.filter(c => c.status === filter.status);
    if (filter.recipientName) result = result.filter(c => c.recipientName && c.recipientName.includes(filter.recipientName));
    if (filter.recipientIdCard) result = result.filter(c => c.recipientIdCard === filter.recipientIdCard);
    if (filter.issuedBy) result = result.filter(c => c.issuedBy === filter.issuedBy);
    if (filter.verifiedBy) result = result.filter(c => c.verifiedBy === filter.verifiedBy);
    if (filter.entryPoint) result = result.filter(c => c.entryPoint === filter.entryPoint);
    if (filter.dateFrom) result = result.filter(c => c.issuedAt && c.issuedAt >= filter.dateFrom);
    if (filter.dateTo) result = result.filter(c => c.issuedAt && c.issuedAt <= filter.dateTo);
  }
  return result;
}

function updateCredential(id, data) {
  const cred = store.credentials.get(id);
  if (!cred) return null;
  Object.assign(cred, data);
  return cred;
}

function getNextAvailableCredential(batchId) {
  const creds = Array.from(store.credentials.values())
    .filter(c => c.batchId === batchId && c.status === '待发放')
    .sort((a, b) => a.seq - b.seq);
  return creds.length > 0 ? creds[0] : null;
}

function checkDuplicateRecipient(recipientIdCard, validFrom, validTo, excludeCredId) {
  for (const [, cred] of store.credentials) {
    if (excludeCredId && cred.id === excludeCredId) continue;
    if (cred.recipientIdCard !== recipientIdCard) continue;
    if (cred.status !== '已发放' && cred.status !== '待盘点') continue;
    if (cred.validFrom <= validTo && cred.validTo >= validFrom) {
      return cred;
    }
  }
  return null;
}

function createAnomaly(data) {
  const anomaly = {
    id: generateId(),
    credentialId: data.credentialId,
    credentialNo: data.credentialNo,
    batchNo: data.batchNo,
    area: data.area,
    entryPoint: data.entryPoint,
    type: data.type,
    description: data.description,
    detectedAt: new Date().toISOString()
  };
  store.anomalies.set(anomaly.id, anomaly);
  return anomaly;
}

function getAnomalies(filter) {
  let result = Array.from(store.anomalies.values());
  if (filter) {
    if (filter.type) result = result.filter(a => a.type === filter.type);
    if (filter.batchNo) result = result.filter(a => a.batchNo === filter.batchNo);
    if (filter.area) result = result.filter(a => a.area === filter.area);
    if (filter.dateFrom) result = result.filter(a => a.detectedAt >= filter.dateFrom);
    if (filter.dateTo) result = result.filter(a => a.detectedAt <= filter.dateTo);
  }
  return result;
}

function addAuditLog(action, targetId, operator, detail) {
  store.auditLogs.push({
    id: generateId(),
    action,
    targetId,
    operator,
    detail,
    timestamp: new Date().toISOString()
  });
}

function getAuditLogs(filter) {
  let result = [...store.auditLogs];
  if (filter) {
    if (filter.action) result = result.filter(l => l.action === filter.action);
    if (filter.operator) result = result.filter(l => l.operator === filter.operator);
  }
  return result;
}

function getRules() {
  return Array.from(store.rules.values());
}

function getRuleValue(key) {
  const rule = store.rules.get(key);
  return rule ? rule.value : null;
}

function updateRule(key, value) {
  const rule = store.rules.get(key);
  if (!rule) return null;
  rule.value = value;
  rule.updatedAt = new Date().toISOString();
  return rule;
}

function getStats() {
  return {
    batches: store.batches.size,
    credentials: store.credentials.size,
    anomalies: store.anomalies.size,
    areas: store.areas.size,
    extensionApplications: store.extensionApplications.size
  };
}

function createExtensionApplication(data) {
  const cred = store.credentials.get(data.credentialId);
  if (!cred) {
    const err = new Error('凭证不存在');
    err.code = 'CREDENTIAL_NOT_FOUND';
    throw err;
  }

  if (cred.status === '已作废') {
    const err = new Error('凭证已作废，不可申请延期');
    err.code = 'CREDENTIAL_VOIDED';
    throw err;
  }

  if (cred.status !== '已发放' && cred.status !== '待盘点' && cred.status !== '异常留置') {
    const err = new Error(`凭证状态为"${cred.status}"，不可申请延期`);
    err.code = 'INVALID_STATUS';
    throw err;
  }

  if (data.recipientName !== cred.recipientName || data.recipientIdCard !== cred.recipientIdCard) {
    const err = new Error('领取人信息与凭证记录不一致');
    err.code = 'RECIPIENT_MISMATCH';
    throw err;
  }

  const maxDays = getRuleValue('max_validity_days');
  const validDays = (new Date(data.newValidTo) - new Date(cred.validFrom)) / (1000 * 60 * 60 * 24);
  if (validDays > maxDays) {
    const err = new Error(`延期后总有效天数 ${Math.ceil(validDays)} 超过最大限制 ${maxDays} 天`);
    err.code = 'INVALID_VALIDITY';
    throw err;
  }

  if (new Date(data.newValidTo) <= new Date(cred.validTo)) {
    const err = new Error('延期后有效期必须晚于当前有效期');
    err.code = 'INVALID_EXTENSION';
    throw err;
  }

  const pending = getExtensionApplications({ credentialId: data.credentialId, status: 'pending' });
  if (pending.length > 0) {
    const err = new Error('该凭证已有待审批的延期申请');
    err.code = 'PENDING_EXISTS';
    throw err;
  }

  const app = {
    id: generateId(),
    credentialId: data.credentialId,
    credentialNo: cred.credentialNo,
    batchNo: cred.batchNo,
    area: cred.area,
    originalValidFrom: cred.validFrom,
    originalValidTo: cred.validTo,
    newValidTo: data.newValidTo,
    reason: data.reason || '',
    recipientName: cred.recipientName,
    recipientIdCard: cred.recipientIdCard,
    recipientPhone: cred.recipientPhone,
    status: 'pending',
    applicant: data.applicant,
    applicantUsername: data.applicantUsername,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    approver: null,
    rejectedAt: null,
    rejectReason: null
  };

  store.extensionApplications.set(app.id, app);

  addAuditLog('EXTENSION_APPLY', app.id, data.applicant,
    `提交凭证 ${cred.credentialNo} 延期申请，有效期从 ${cred.validTo} 延至 ${data.newValidTo}，原因：${data.reason || '未填写'}`);

  return app;
}

function getExtensionApplications(filter) {
  let result = Array.from(store.extensionApplications.values());
  if (filter) {
    if (filter.status) result = result.filter(a => a.status === filter.status);
    if (filter.credentialId) result = result.filter(a => a.credentialId === filter.credentialId);
    if (filter.credentialNo) result = result.filter(a => a.credentialNo === filter.credentialNo);
    if (filter.area) result = result.filter(a => a.area === filter.area);
    if (filter.applicant) result = result.filter(a => a.applicant === filter.applicant);
    if (filter.approver) result = result.filter(a => a.approver === filter.approver);
    if (filter.batchNo) result = result.filter(a => a.batchNo === filter.batchNo);
  }
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getExtensionApplicationById(id) {
  return store.extensionApplications.get(id) || null;
}

function approveExtensionApplication(id, approver) {
  const app = store.extensionApplications.get(id);
  if (!app) {
    const err = new Error('延期申请不存在');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (app.status !== 'pending') {
    const err = new Error(`申请状态为"${app.status}"，不可审批`);
    err.code = 'INVALID_STATUS';
    throw err;
  }

  const cred = store.credentials.get(app.credentialId);
  if (!cred || cred.status === '已作废') {
    const err = new Error('凭证不存在或已作废');
    err.code = 'CREDENTIAL_INVALID';
    throw err;
  }

  const duplicate = checkDuplicateRecipient(
    cred.recipientIdCard,
    cred.validFrom,
    app.newValidTo,
    cred.id
  );
  if (duplicate) {
    const err = new Error(`领取人 ${cred.recipientName} 在延期时段内已有凭证 ${duplicate.credentialNo}（区域：${duplicate.area}，${duplicate.validFrom} ~ ${duplicate.validTo}）`);
    err.code = 'DUPLICATE_RECIPIENT';
    throw err;
  }

  app.status = 'approved';
  app.approvedAt = new Date().toISOString();
  app.approver = approver;

  updateCredential(app.credentialId, {
    validTo: app.newValidTo
  });

  addAuditLog('EXTENSION_APPROVE', app.id, approver,
    `批准凭证 ${app.credentialNo} 延期申请，有效期从 ${app.originalValidTo} 延至 ${app.newValidTo}`);

  return app;
}

function rejectExtensionApplication(id, approver, rejectReason) {
  const app = store.extensionApplications.get(id);
  if (!app) {
    const err = new Error('延期申请不存在');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (app.status !== 'pending') {
    const err = new Error(`申请状态为"${app.status}"，不可审批`);
    err.code = 'INVALID_STATUS';
    throw err;
  }

  app.status = 'rejected';
  app.rejectedAt = new Date().toISOString();
  app.approver = approver;
  app.rejectReason = rejectReason || '';

  addAuditLog('EXTENSION_REJECT', app.id, approver,
    `驳回凭证 ${app.credentialNo} 延期申请，原因：${rejectReason || '未填写'}`);

  return app;
}

function getUsers() {
  return Array.from(store.users.values());
}

module.exports = {
  store,
  generateId,
  initSeedData,
  getUserByUsername,
  getUsers,
  createArea,
  getAreas,
  getAreaById,
  updateArea,
  checkNumberRangeOverlap,
  createBatch,
  getBatches,
  getBatchById,
  updateBatch,
  voidBatch,
  getCredentialById,
  getCredentialByNo,
  getCredentials,
  updateCredential,
  getNextAvailableCredential,
  checkDuplicateRecipient,
  createAnomaly,
  getAnomalies,
  addAuditLog,
  getAuditLogs,
  getRules,
  getRuleValue,
  updateRule,
  getStats,
  createExtensionApplication,
  getExtensionApplications,
  getExtensionApplicationById,
  approveExtensionApplication,
  rejectExtensionApplication
};
