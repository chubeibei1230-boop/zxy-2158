'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store');
const { auth } = require('../middleware');

router.get('/credentials', auth(['admin', 'window', 'observer']), (req, res) => {
  const {
    batchNo, area, recipientName, recipientIdCard,
    issuedBy, verifiedBy, status, entryPoint,
    dateFrom, dateTo, page, pageSize
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

  const total = credentials.length;
  const p = parseInt(page) || 1;
  const ps = parseInt(pageSize) || 20;
  const start = (p - 1) * ps;
  const paginated = credentials.slice(start, start + ps);

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
  res.json({
    code: 'OK',
    data: {
      credential,
      batch: batch ? { batchNo: batch.batchNo, status: batch.status, total: batch.total } : null
    }
  });
});

router.get('/credentials-by-no/:no', auth(['admin', 'window', 'observer']), (req, res) => {
  const credential = store.getCredentialByNo(req.params.no);
  if (!credential) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '凭证不存在' });
  }
  res.json({ code: 'OK', data: credential });
});

router.get('/areas', auth(['admin', 'window', 'observer']), (req, res) => {
  const areas = store.getAreas();
  const enriched = areas.map(a => {
    const creds = store.getCredentials({ areaId: a.id });
    return {
      ...a,
      stats: {
        total: creds.length,
        '待发放': creds.filter(c => c.status === '待发放').length,
        '已发放': creds.filter(c => c.status === '已发放').length,
        '已核销': creds.filter(c => c.status === '已核销').length,
        '已作废': creds.filter(c => c.status === '已作废').length
      }
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
