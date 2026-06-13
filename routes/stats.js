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

router.get('/anomalies', auth(['admin', 'window', 'observer']), (req, res) => {
  const { type, batchNo, area, dateFrom, dateTo } = req.query;
  const filter = {};
  if (type) filter.type = type;
  if (batchNo) filter.batchNo = batchNo;
  if (area) filter.area = area;
  if (dateFrom) filter.dateFrom = dateFrom;
  if (dateTo) filter.dateTo = dateTo;

  const anomalies = store.getAnomalies(filter);

  const byType = {};
  for (const a of anomalies) {
    if (!byType[a.type]) byType[a.type] = 0;
    byType[a.type]++;
  }

  res.json({
    code: 'OK',
    data: {
      total: anomalies.length,
      byType,
      items: anomalies
    }
  });
});

router.get('/area-heat', auth(['admin', 'window', 'observer']), (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const credentials = store.getCredentials({});

  const heatMap = {};
  for (const cred of credentials) {
    if (!cred.area) continue;
    if (dateFrom && cred.issuedAt && cred.issuedAt < dateFrom) continue;
    if (dateTo && cred.issuedAt && cred.issuedAt > dateTo) continue;

    if (!heatMap[cred.area]) {
      heatMap[cred.area] = {
        area: cred.area,
        total: 0,
        '待发放': 0,
        '已发放': 0,
        '已核销': 0,
        '已作废': 0,
        '待盘点': 0,
        '异常留置': 0,
        verificationRate: 0,
        entryPointDistribution: {}
      };
    }

    heatMap[cred.area].total++;
    if (heatMap[cred.area][cred.status] !== undefined) {
      heatMap[cred.area][cred.status]++;
    }

    if (cred.entryPoint) {
      if (!heatMap[cred.area].entryPointDistribution[cred.entryPoint]) {
        heatMap[cred.area].entryPointDistribution[cred.entryPoint] = 0;
      }
      heatMap[cred.area].entryPointDistribution[cred.entryPoint]++;
    }
  }

  for (const key of Object.keys(heatMap)) {
    const h = heatMap[key];
    const issued = h['已发放'] + h['已核销'] + h['异常留置'] + h['待盘点'];
    h.verificationRate = issued > 0 ? (h['已核销'] / issued * 100).toFixed(1) + '%' : '0%';
  }

  const result = Object.values(heatMap).sort((a, b) => b['已核销'] - a['已核销']);
  res.json({ code: 'OK', data: result });
});

router.get('/expired', auth(['admin', 'window', 'observer']), (req, res) => {
  const now = new Date();
  const credentials = store.getCredentials({});

  const expired = credentials.filter(c => {
    return (c.status === '已发放' || c.status === '待盘点' || c.status === '异常留置') &&
      new Date(c.validTo) < now;
  });

  const byArea = {};
  const byBatch = {};
  const byStatus = {};

  for (const cred of expired) {
    if (!byArea[cred.area]) byArea[cred.area] = 0;
    byArea[cred.area]++;

    if (!byBatch[cred.batchNo]) byBatch[cred.batchNo] = 0;
    byBatch[cred.batchNo]++;

    if (!byStatus[cred.status]) byStatus[cred.status] = 0;
    byStatus[cred.status]++;
  }

  const isObserver = req.user.role === 'observer';
  res.json({
    code: 'OK',
    data: {
      total: expired.length,
      byArea: Object.entries(byArea)
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count),
      byBatch: Object.entries(byBatch)
        .map(([batchNo, count]) => ({ batchNo, count }))
        .sort((a, b) => b.count - a.count),
      byStatus: Object.entries(byStatus)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      items: expired.map(c => ({
        credentialNo: c.credentialNo,
        batchNo: c.batchNo,
        area: c.area,
        recipientName: c.recipientName,
        recipientIdCard: isObserver ? maskField(c.recipientIdCard, 3, 4) : c.recipientIdCard,
        validTo: c.validTo,
        status: c.status,
        expiredDays: Math.floor((now - new Date(c.validTo)) / (1000 * 60 * 60 * 24)),
        issuedBy: c.issuedBy
      }))
    }
  });
});

module.exports = router;
