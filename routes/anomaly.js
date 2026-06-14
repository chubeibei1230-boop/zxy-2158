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

function maskSensitive(anomaly, role) {
  if (role === 'observer') {
    return {
      ...anomaly,
      recipientIdCard: anomaly.recipientIdCard ? maskField(anomaly.recipientIdCard, 3, 4) : null,
      recipientPhone: anomaly.recipientPhone ? maskField(anomaly.recipientPhone, 3, 4) : null
    };
  }
  return anomaly;
}

function maskCredentialAnomalies(anomalies, role) {
  if (!anomalies) return [];
  return anomalies.map(a => {
    if (role === 'observer') {
      return a;
    }
    return a;
  });
}

router.get('/', auth(['admin', 'window', 'observer']), (req, res) => {
  try {
    const {
      status, result, type, batchNo, area,
      credentialNo, dateFrom, dateTo,
      page, pageSize
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (result) filter.result = result;
    if (type) filter.type = type;
    if (batchNo) filter.batchNo = batchNo;
    if (area) filter.area = area;
    if (credentialNo) filter.credentialNo = credentialNo;
    if (dateFrom) filter.dateFrom = dateFrom;
    if (dateTo) filter.dateTo = dateTo;

    const anomalies = store.getAnomalies(filter);

    const stats = {
      total: anomalies.length,
      pending: anomalies.filter(a => a.status === 'pending').length,
      accepted: anomalies.filter(a => a.status === 'accepted').length,
      handled: anomalies.filter(a => a.status === 'handled').length,
      released: anomalies.filter(a => a.result === 'released').length,
      voided: anomalies.filter(a => a.result === 'voided').length,
      byType: {},
      byArea: {}
    };
    for (const a of anomalies) {
      if (!stats.byType[a.type]) stats.byType[a.type] = 0;
      stats.byType[a.type]++;
      if (!stats.byArea[a.area]) stats.byArea[a.area] = 0;
      stats.byArea[a.area]++;
    }

    const total = anomalies.length;
    const p = parseInt(page) || 1;
    const ps = parseInt(pageSize) || 20;
    const start = (p - 1) * ps;
    const paginated = anomalies.slice(start, start + ps).map(a => {
      const cred = store.getCredentialById(a.credentialId);
      const enriched = {
        ...a,
        recipientName: cred ? cred.recipientName : null,
        recipientIdCard: cred ? cred.recipientIdCard : null,
        recipientPhone: cred ? cred.recipientPhone : null,
        credentialStatus: cred ? cred.status : null,
        validFrom: cred ? cred.validFrom : null,
        validTo: cred ? cred.validTo : null,
        issuedBy: cred ? cred.issuedBy : null,
        verifiedBy: cred ? cred.verifiedBy : null
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
    const anomaly = store.getAnomalyById(req.params.id);
    if (!anomaly) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '异常记录不存在' });
    }

    const credential = store.getCredentialById(anomaly.credentialId);
    if (!credential) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '关联凭证不存在' });
    }

    const relatedAnomalies = store.getAnomalies({ credentialId: credential.id });
    const batch = store.getBatchById(credential.batchId);
    const area = store.getAreaById(credential.areaId);

    const credentialInfo = maskSensitive({
      id: credential.id,
      credentialNo: credential.credentialNo,
      batchNo: credential.batchNo,
      area: credential.area,
      status: credential.status,
      recipientName: credential.recipientName,
      recipientIdCard: credential.recipientIdCard,
      recipientPhone: credential.recipientPhone,
      validFrom: credential.validFrom,
      validTo: credential.validTo,
      issuedAt: credential.issuedAt,
      issuedBy: credential.issuedBy,
      verifiedAt: credential.verifiedAt,
      verifiedBy: credential.verifiedBy,
      entryPoint: credential.entryPoint,
      voidedAt: credential.voidedAt,
      voidedBy: credential.voidedBy,
      voidReason: credential.voidReason,
      anomalies: maskCredentialAnomalies(credential.anomalies, req.user.role)
    }, req.user.role);

    const anomalyDetail = {
      ...anomaly,
      credential: credentialInfo,
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
      } : null,
      relatedAnomalies: relatedAnomalies.map(a => ({
        id: a.id,
        type: a.type,
        description: a.description,
        detectedAt: a.detectedAt,
        status: a.status,
        acceptedBy: a.acceptedBy,
        acceptedAt: a.acceptedAt,
        result: a.result,
        handledBy: a.handledBy,
        handledAt: a.handledAt,
        handleRemark: a.handleRemark
      }))
    };

    res.json({ code: 'OK', data: anomalyDetail });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/:id/accept', auth(['admin']), (req, res) => {
  try {
    const result = store.acceptAnomaly(
      req.params.id,
      req.user.name
    );
    res.json({ code: 'OK', data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/:id/release', auth(['admin']), (req, res) => {
  try {
    const { remark } = req.body;
    const result = store.handleAnomalyRelease(
      req.params.id,
      req.user.name,
      remark
    );
    res.json({ code: 'OK', data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/:id/void', auth(['admin']), (req, res) => {
  try {
    const { remark } = req.body;
    const result = store.handleAnomalyVoid(
      req.params.id,
      req.user.name,
      remark
    );
    res.json({ code: 'OK', data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_STATUS') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;
