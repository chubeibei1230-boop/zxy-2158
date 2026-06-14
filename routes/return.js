'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store');
const { auth } = require('../middleware');

function maskField(value, keepStart, keepEnd) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= keepStart + keepEnd) return s;
  return s.slice(0, keepStart) + '*'.repeat(s.length - keepStart - keepEnd) + s.slice(-keepEnd);
}

function maskSensitive(record, role) {
  if (role === 'observer') {
    return {
      ...record,
      returnPersonIdCard: record.returnPersonIdCard ? maskField(record.returnPersonIdCard, 3, 4) : null,
      returnPersonPhone: record.returnPersonPhone ? maskField(record.returnPersonPhone, 3, 4) : null,
      recipientIdCard: record.recipientIdCard ? maskField(record.recipientIdCard, 3, 4) : null
    };
  }
  return record;
}

router.post('/', auth(['window', 'admin']), (req, res) => {
  try {
    const { credentialId, returnPersonName, returnPersonIdCard, returnPersonPhone, returnEntryPoint, returnReason, returnRemark } = req.body;

    if (!credentialId) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '凭证ID(credentialId)必填' });
    }

    if (!returnEntryPoint || !String(returnEntryPoint).trim()) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '归还入口/窗口(returnEntryPoint)必填' });
    }

    if (!returnReason || !String(returnReason).trim()) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '归还原因(returnReason)必填' });
    }

    const credential = store.getCredentialById(credentialId);
    if (!credential) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '凭证不存在' });
    }

    if (credential.status !== '已发放') {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `凭证状态为"${credential.status}"，不可归还（仅已发放状态可归还）` });
    }

    const returnRecord = store.returnCredential({
      credentialId,
      returnPersonName,
      returnPersonIdCard,
      returnPersonPhone,
      returnEntryPoint,
      returnReason,
      returnRemark,
      returnedBy: req.user.name
    });

    res.status(201).json({ code: 'OK', data: returnRecord });
  } catch (err) {
    if (err.code === 'CREDENTIAL_NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/by-no', auth(['window', 'admin']), (req, res) => {
  try {
    const { credentialNo, returnPersonName, returnPersonIdCard, returnPersonPhone, returnEntryPoint, returnReason, returnRemark } = req.body;

    if (!credentialNo) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '凭证号(credentialNo)必填' });
    }

    if (!returnEntryPoint || !String(returnEntryPoint).trim()) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '归还入口/窗口(returnEntryPoint)必填' });
    }

    if (!returnReason || !String(returnReason).trim()) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '归还原因(returnReason)必填' });
    }

    const credential = store.getCredentialByNo(credentialNo);
    if (!credential) {
      return res.status(404).json({ code: 'NOT_FOUND', message: `凭证号 ${credentialNo} 不存在` });
    }

    if (credential.status !== '已发放') {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `凭证状态为"${credential.status}"，不可归还（仅已发放状态可归还）` });
    }

    const returnRecord = store.returnCredential({
      credentialId: credential.id,
      returnPersonName,
      returnPersonIdCard,
      returnPersonPhone,
      returnEntryPoint,
      returnReason,
      returnRemark,
      returnedBy: req.user.name
    });

    res.status(201).json({ code: 'OK', data: returnRecord });
  } catch (err) {
    if (err.code === 'CREDENTIAL_NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.get('/', auth(['admin', 'window', 'observer']), (req, res) => {
  try {
    const {
      batchNo, area, credentialNo, returnPersonName,
      returnPersonIdCard, recipientName, recipientIdCard,
      status, returnedBy, returnEntryPoint,
      dateFrom, dateTo, page, pageSize
    } = req.query;

    const filter = {};
    if (batchNo) filter.batchNo = batchNo;
    if (area) filter.area = area;
    if (credentialNo) filter.credentialNo = credentialNo;
    if (returnPersonName) filter.returnPersonName = returnPersonName;
    if (returnPersonIdCard) filter.returnPersonIdCard = returnPersonIdCard;
    if (recipientName) filter.recipientName = recipientName;
    if (recipientIdCard) filter.recipientIdCard = recipientIdCard;
    if (status) filter.status = status;
    if (returnedBy) filter.returnedBy = returnedBy;
    if (returnEntryPoint) filter.returnEntryPoint = returnEntryPoint;
    if (dateFrom) filter.dateFrom = dateFrom;
    if (dateTo) filter.dateTo = dateTo;

    const records = store.getReturnRecords(filter);

    const stats = {
      total: records.length,
      active: records.filter(r => r.status === 'active').length,
      revoked: records.filter(r => r.status === 'revoked').length,
      byArea: {},
      byReason: {}
    };
    for (const r of records) {
      if (!stats.byArea[r.area]) stats.byArea[r.area] = 0;
      stats.byArea[r.area]++;
      if (r.returnReason) {
        if (!stats.byReason[r.returnReason]) stats.byReason[r.returnReason] = 0;
        stats.byReason[r.returnReason]++;
      }
    }

    const total = records.length;
    const p = parseInt(page) || 1;
    const ps = parseInt(pageSize) || 20;
    const start = (p - 1) * ps;
    const paginated = records.slice(start, start + ps).map(r => {
      const cred = store.getCredentialById(r.credentialId);
      const enriched = {
        ...r,
        recipientName: cred ? cred.recipientName : null,
        recipientIdCard: cred ? cred.recipientIdCard : null
      };
      return maskSensitive(enriched, req.user.role);
    });

    res.json({
      code: 'OK',
      data: {
        total,
        page: p,
        pageSize: ps,
        totalPages: Math.ceil(total / ps),
        stats,
        items: paginated
      }
    });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.get('/:id', auth(['admin', 'window', 'observer']), (req, res) => {
  try {
    const returnRecord = store.getReturnRecordById(req.params.id);
    if (!returnRecord) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '归还记录不存在' });
    }

    const credential = store.getCredentialById(returnRecord.credentialId);
    const batch = credential ? store.getBatchById(credential.batchId) : null;
    const area = returnRecord.areaId ? store.getAreaById(returnRecord.areaId) : null;

    const detail = {
      ...maskSensitive(returnRecord, req.user.role),
      credential: credential ? {
        id: credential.id,
        credentialNo: credential.credentialNo,
        status: credential.status,
        recipientName: credential.recipientName,
        recipientIdCard: req.user.role === 'observer' ? maskField(credential.recipientIdCard, 3, 4) : credential.recipientIdCard,
        recipientPhone: req.user.role === 'observer' ? maskField(credential.recipientPhone, 3, 4) : credential.recipientPhone,
        validFrom: credential.validFrom,
        validTo: credential.validTo,
        issuedAt: credential.issuedAt,
        issuedBy: credential.issuedBy
      } : null,
      batch: batch ? {
        id: batch.id,
        batchNo: batch.batchNo,
        status: batch.status,
        total: batch.total
      } : null,
      area: area ? {
        id: area.id,
        name: area.name,
        entryPoints: area.entryPoints
      } : null
    };

    res.json({ code: 'OK', data: detail });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/:id/revoke', auth(['admin']), (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '撤销原因(reason)必填' });
    }

    const result = store.revokeReturn(req.params.id, req.user.name, reason);
    res.json({ code: 'OK', data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    if (err.code === 'MISSING_REASON') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    if (err.code === 'CREDENTIAL_NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'DUPLICATE_RECIPIENT') {
      return res.status(409).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;
