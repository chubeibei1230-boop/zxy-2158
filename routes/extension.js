'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store');
const { auth } = require('../middleware');

function maskSensitive(app, role) {
  if (role === 'observer') {
    return {
      ...app,
      recipientIdCard: app.recipientIdCard ? app.recipientIdCard.replace(/^(.{3}).*(.{4})$/, '$1***********$2') : null,
      recipientPhone: app.recipientPhone ? app.recipientPhone.replace(/^(.{3}).*(.{4})$/, '$1****$2') : null
    };
  }
  return app;
}

router.post('/apply', auth(['window']), (req, res) => {
  try {
    const { credentialId, newValidTo, reason, recipientName, recipientIdCard } = req.body;

    if (!credentialId || !newValidTo || !reason || !recipientName || !recipientIdCard) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '缺少必填字段（credentialId, newValidTo, reason, recipientName, recipientIdCard）' });
    }

    const application = store.createExtensionApplication({
      credentialId,
      newValidTo,
      reason,
      recipientName,
      recipientIdCard,
      applicant: req.user.name,
      applicantUsername: req.user.username
    });

    res.status(201).json({ code: 'OK', data: application });
  } catch (err) {
    if (err.code === 'CREDENTIAL_NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (['CREDENTIAL_VOIDED', 'INVALID_STATUS', 'RECIPIENT_MISMATCH', 'MISSING_FIELDS', 'INVALID_DATE', 'INVALID_VALIDITY', 'INVALID_EXTENSION', 'PENDING_EXISTS'].includes(err.code)) {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.get('/', auth(['admin', 'window', 'observer']), (req, res) => {
  const { status, credentialNo, area, applicant, approver, batchNo, page, pageSize } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (credentialNo) filter.credentialNo = credentialNo;
  if (area) filter.area = area;
  if (applicant) filter.applicant = applicant;
  if (approver) filter.approver = approver;
  if (batchNo) filter.batchNo = batchNo;

  let applications = store.getExtensionApplications(filter);

  const total = applications.length;
  const p = parseInt(page) || 1;
  const ps = parseInt(pageSize) || 20;
  const start = (p - 1) * ps;
  const paginated = applications.slice(start, start + ps).map(a => maskSensitive(a, req.user.role));

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

router.get('/:id', auth(['admin', 'window', 'observer']), (req, res) => {
  const application = store.getExtensionApplicationById(req.params.id);
  if (!application) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '延期申请不存在' });
  }
  res.json({ code: 'OK', data: maskSensitive(application, req.user.role) });
});

router.post('/:id/approve', auth(['admin']), (req, res) => {
  try {
    const application = store.approveExtensionApplication(req.params.id, req.user.name);
    res.json({ code: 'OK', data: application });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (['INVALID_STATUS', 'CREDENTIAL_INVALID', 'INVALID_DATE', 'INVALID_VALIDITY', 'INVALID_EXTENSION'].includes(err.code)) {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    if (err.code === 'DUPLICATE_RECIPIENT') {
      return res.status(409).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/:id/reject', auth(['admin']), (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '驳回原因(reason)必填' });
    }
    const application = store.rejectExtensionApplication(req.params.id, req.user.name, reason);
    res.json({ code: 'OK', data: application });
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
