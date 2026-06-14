'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store');
const { auth } = require('../middleware');

router.post('/', auth(['admin']), (req, res) => {
  try {
    const { batchNo, prefix, startSeq, endSeq, padLength, areaId, validFrom, validTo, remark } = req.body;

    if (!batchNo || !prefix || startSeq == null || endSeq == null || !areaId || !validFrom || !validTo) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '缺少必填字段（batchNo, prefix, startSeq, endSeq, areaId, validFrom, validTo）' });
    }

    if (typeof startSeq !== 'number' || typeof endSeq !== 'number' || endSeq < startSeq) {
      return res.status(400).json({ code: 'INVALID_RANGE', message: '序号范围无效，endSeq 必须 >= startSeq' });
    }

    if (new Date(validTo) <= new Date(validFrom)) {
      return res.status(400).json({ code: 'INVALID_PERIOD', message: '结束时间必须大于开始时间' });
    }

    const batch = store.createBatch({
      batchNo, prefix, startSeq, endSeq, padLength, areaId, validFrom, validTo, remark,
      createdBy: req.user.name
    });

    res.status(201).json({ code: 'OK', data: batch });
  } catch (err) {
    if (err.code === 'RANGE_OVERLAP') {
      return res.status(409).json({ code: err.code, message: err.message });
    }
    if (err.code === 'AREA_NOT_FOUND') {
      return res.status(404).json({ code: err.code, message: err.message });
    }
    if (err.code === 'INVALID_VALIDITY') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.get('/', auth(['admin', 'window', 'observer']), (req, res) => {
  const { status, area, batchNo } = req.query;
  const batches = store.getBatches({ status, area, batchNo });
  const result = batches.map(b => {
    const creds = store.getCredentials({ batchId: b.id });
    return {
      ...b,
      summary: {
        total: creds.length,
        '待发放': creds.filter(c => c.status === '待发放').length,
        '已发放': creds.filter(c => c.status === '已发放').length,
        '已核销': creds.filter(c => c.status === '已核销').length,
        '已作废': creds.filter(c => c.status === '已作废').length,
        '待盘点': creds.filter(c => c.status === '待盘点').length,
        '异常留置': creds.filter(c => c.status === '异常留置').length,
        '已归还': creds.filter(c => c.status === '已归还').length
      }
    };
  });
  res.json({ code: 'OK', data: result });
});

router.get('/:id', auth(['admin', 'window', 'observer']), (req, res) => {
  const batch = store.getBatchById(req.params.id);
  if (!batch) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '批次不存在' });
  }
  const credentials = store.getCredentials({ batchId: batch.id });
  const summary = {
    total: credentials.length,
    '待发放': credentials.filter(c => c.status === '待发放').length,
    '已发放': credentials.filter(c => c.status === '已发放').length,
    '已核销': credentials.filter(c => c.status === '已核销').length,
    '已作废': credentials.filter(c => c.status === '已作废').length,
    '待盘点': credentials.filter(c => c.status === '待盘点').length,
    '异常留置': credentials.filter(c => c.status === '异常留置').length,
    '已归还': credentials.filter(c => c.status === '已归还').length
  };
  res.json({ code: 'OK', data: { batch, summary } });
});

router.put('/:id', auth(['admin']), (req, res) => {
  const batch = store.getBatchById(req.params.id);
  if (!batch) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '批次不存在' });
  }
  if (batch.status === 'voided') {
    return res.status(400).json({ code: 'BATCH_VOIDED', message: '已作废批次不可修改' });
  }

  const allowedFields = ['validFrom', 'validTo', 'remark', 'areaId'];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  if (updates.validFrom && updates.validTo && new Date(updates.validTo) <= new Date(updates.validFrom)) {
    return res.status(400).json({ code: 'INVALID_PERIOD', message: '结束时间必须大于开始时间' });
  }

  if (updates.validFrom && !updates.validTo && new Date(batch.validTo) <= new Date(updates.validFrom)) {
    return res.status(400).json({ code: 'INVALID_PERIOD', message: '开始时间不能晚于或等于当前结束时间' });
  }

  if (updates.validTo && !updates.validFrom && new Date(updates.validTo) <= new Date(batch.validFrom)) {
    return res.status(400).json({ code: 'INVALID_PERIOD', message: '结束时间必须晚于当前开始时间' });
  }

  const updated = store.updateBatch(req.params.id, updates);
  res.json({ code: 'OK', data: updated });
});

router.post('/:id/void', auth(['admin']), (req, res) => {
  try {
    const { reason } = req.body;
    const batch = store.voidBatch(req.params.id, req.user.name, reason);
    if (!batch) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '批次不存在' });
    }
    res.json({ code: 'OK', data: batch });
  } catch (err) {
    if (err.code === 'ALREADY_VOIDED') {
      return res.status(400).json({ code: err.code, message: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;
