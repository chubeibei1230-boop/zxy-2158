'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store');
const { auth } = require('../middleware');

function maskSensitive(cred, role) {
  if (role === 'observer') {
    return {
      ...cred,
      recipientIdCard: cred.recipientIdCard ? cred.recipientIdCard.replace(/^(.{3}).*(.{4})$/, '$1***********$2') : null,
      recipientPhone: cred.recipientPhone ? cred.recipientPhone.replace(/^(.{3}).*(.{4})$/, '$1****$2') : null
    };
  }
  return cred;
}

function maskField(value, keepStart, keepEnd) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= keepStart + keepEnd) return s;
  return s.slice(0, keepStart) + '*'.repeat(s.length - keepStart - keepEnd) + s.slice(-keepEnd);
}

function maskReturnRecordSensitive(record, role) {
  if (role === 'observer') {
    return {
      ...record,
      returnPersonIdCard: record.returnPersonIdCard ? maskField(record.returnPersonIdCard, 3, 4) : null,
      returnPersonPhone: record.returnPersonPhone ? maskField(record.returnPersonPhone, 3, 4) : null
    };
  }
  return record;
}

function attachExtensionInfo(credential) {
  const extensions = store.getExtensionApplications({ credentialId: credential.id });
  const pendingExtension = extensions.find(e => e.status === 'pending');
  const approvedExtensions = extensions.filter(e => e.status === 'approved');
  const latestExtension = extensions[0] || null;
  return {
    ...credential,
    hasPendingExtension: !!pendingExtension,
    pendingExtension: pendingExtension || null,
    extensionCount: extensions.length,
    approvedExtensionCount: approvedExtensions.length,
    latestExtensionResult: latestExtension ? {
      id: latestExtension.id,
      status: latestExtension.status,
      newValidTo: latestExtension.newValidTo,
      approver: latestExtension.approver,
      approvedAt: latestExtension.approvedAt,
      rejectedAt: latestExtension.rejectedAt,
      rejectReason: latestExtension.rejectReason
    } : null
  };
}

function attachReturnInfo(credential) {
  const returnRecords = store.getReturnRecordsByCredentialId(credential.id);
  const activeReturn = returnRecords.find(r => r.status === 'active');
  return {
    ...credential,
    hasReturn: !!activeReturn,
    returnRecord: activeReturn ? {
      id: activeReturn.id,
      returnPersonName: activeReturn.returnPersonName,
      returnEntryPoint: activeReturn.returnEntryPoint,
      returnReason: activeReturn.returnReason,
      returnedAt: activeReturn.returnedAt,
      returnedBy: activeReturn.returnedBy,
      status: activeReturn.status
    } : null,
    returnCount: returnRecords.length
  };
}

router.get('/credentials', auth(['admin', 'window', 'observer']), (req, res) => {
  const {
    batchNo, area, recipientName, recipientIdCard,
    issuedBy, verifiedBy, status, entryPoint,
    dateFrom, dateTo, page, pageSize, hasPendingExtension
  } = req.query;

  const filter = {};
  if (batchNo) filter.batchNo = batchNo;
  if (area) filter.area = area;
  if (recipientName) filter.recipientName = recipientName;
  if (recipientIdCard) filter.recipientIdCard = recipientIdCard;
  if (issuedBy) filter.issuedBy = issuedBy;
  if (verifiedBy) filter.verifiedBy = verifiedBy;
  if (status) filter.status = status;
  if (entryPoint) filter.entryPoint = entryPoint;
  if (dateFrom) filter.dateFrom = dateFrom;
  if (dateTo) filter.dateTo = dateTo;

  let credentials = store.getCredentials(filter);

  if (hasPendingExtension === 'true') {
    credentials = credentials.filter(c => {
      const exts = store.getExtensionApplications({ credentialId: c.id, status: 'pending' });
      return exts.length > 0;
    });
  } else if (hasPendingExtension === 'false') {
    credentials = credentials.filter(c => {
      const exts = store.getExtensionApplications({ credentialId: c.id, status: 'pending' });
      return exts.length === 0;
    });
  }

  const total = credentials.length;
  const p = parseInt(page) || 1;
  const ps = parseInt(pageSize) || 20;
  const start = (p - 1) * ps;
  const paginated = credentials.slice(start, start + ps)
    .map(c => attachExtensionInfo(c))
    .map(c => attachReturnInfo(c))
    .map(c => maskSensitive(c, req.user.role));

  res.json({
    code: 'OK',
    data: {
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
      items: paginated
    }
  });
});

router.get('/credentials/:id', auth(['admin', 'window', 'observer']), (req, res) => {
  const credential = store.getCredentialById(req.params.id);
  if (!credential) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '凭证不存在' });
  }
  const batch = store.getBatchById(credential.batchId);
  const extensions = store.getExtensionApplications({ credentialId: credential.id });
  const returnRecords = store.getReturnRecordsByCredentialId(credential.id);
  res.json({
    code: 'OK',
    data: {
      credential: maskSensitive(attachReturnInfo(attachExtensionInfo(credential)), req.user.role),
      batch: batch ? { batchNo: batch.batchNo, status: batch.status, total: batch.total } : null,
      extensionApplications: extensions.map(e => maskSensitive(e, req.user.role)),
      returnRecords: returnRecords.map(r => maskReturnRecordSensitive(r, req.user.role))
    }
  });
});

router.get('/credentials-by-no/:no', auth(['admin', 'window', 'observer']), (req, res) => {
  const credential = store.getCredentialByNo(req.params.no);
  if (!credential) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '凭证不存在' });
  }
  const returnRecords = store.getReturnRecordsByCredentialId(credential.id);
  res.json({
    code: 'OK',
    data: {
      credential: maskSensitive(attachReturnInfo(attachExtensionInfo(credential)), req.user.role),
      returnRecords: returnRecords.map(r => maskReturnRecordSensitive(r, req.user.role))
    }
  });
});

router.get('/areas', auth(['admin', 'window', 'observer']), (req, res) => {
  const areas = store.getAreas();
  const enriched = areas.map(a => {
    const creds = store.getCredentials({ areaId: a.id });
    const stats = {
      total: creds.length,
      '待发放': creds.filter(c => c.status === '待发放').length,
      '已发放': creds.filter(c => c.status === '已发放').length,
      '已核销': creds.filter(c => c.status === '已核销').length,
      '已作废': creds.filter(c => c.status === '已作废').length,
      '待盘点': creds.filter(c => c.status === '待盘点').length,
      '异常留置': creds.filter(c => c.status === '异常留置').length,
      '已归还': creds.filter(c => c.status === '已归还').length
    };
    return {
      ...a,
      stats
    };
  });
  res.json({ code: 'OK', data: enriched });
});

router.get('/audit-logs', auth(['admin']), (req, res) => {
  const { action, operator } = req.query;
  const logs = store.getAuditLogs({ action, operator });
  res.json({ code: 'OK', data: logs });
});

module.exports = router;
