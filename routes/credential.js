'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store');
const { auth } = require('../middleware');

router.post('/issue', auth(['window', 'admin']), (req, res) => {
  try {
    const { credentialNo, batchId, recipientName, recipientIdCard, recipientPhone } = req.body;

    if (!recipientName || !recipientIdCard) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '领取人姓名(recipientName)和证件号(recipientIdCard)必填' });
    }

    let credential;
    if (credentialNo) {
      credential = store.getCredentialByNo(credentialNo);
      if (!credential) {
        return res.status(404).json({ code: 'NOT_FOUND', message: `凭证号 ${credentialNo} 不存在` });
      }
    } else if (batchId) {
      credential = store.getNextAvailableCredential(batchId);
      if (!credential) {
        return res.status(404).json({ code: 'NO_AVAILABLE', message: '该批次无可用凭证' });
      }
    } else {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '需指定凭证号(credentialNo)或批次ID(batchId)' });
    }

    if (credential.status !== '待发放') {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `凭证状态为"${credential.status}"，不可发放` });
    }

    const now = new Date();
    if (now > new Date(credential.validTo)) {
      return res.status(400).json({ code: 'EXPIRED', message: '凭证已过有效期，不可发放' });
    }

    const duplicate = store.checkDuplicateRecipient(
      recipientIdCard,
      credential.validFrom,
      credential.validTo
    );
    if (duplicate) {
      return res.status(409).json({
        code: 'DUPLICATE_RECIPIENT',
        message: `领取人 ${recipientName} 在同一时段已有凭证 ${duplicate.credentialNo}（区域：${duplicate.area}，${duplicate.validFrom} ~ ${duplicate.validTo}）`
      });
    }

    const updated = store.updateCredential(credential.id, {
      status: '已发放',
      recipientName,
      recipientIdCard,
      recipientPhone: recipientPhone || null,
      issuedAt: now.toISOString(),
      issuedBy: req.user.name
    });

    store.addAuditLog('CREDENTIAL_ISSUE', credential.id, req.user.name, `发放凭证 ${credential.credentialNo} 给 ${recipientName}(${recipientIdCard})`);

    res.json({ code: 'OK', data: updated });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/verify', auth(['window', 'admin']), (req, res) => {
  try {
    const { credentialNo, entryPoint } = req.body;

    if (!credentialNo || !entryPoint) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '凭证号(credentialNo)和入口点(entryPoint)必填' });
    }

    const credential = store.getCredentialByNo(credentialNo);
    if (!credential) {
      return res.status(404).json({ code: 'NOT_FOUND', message: `凭证号 ${credentialNo} 不存在` });
    }

    if (credential.status !== '已发放') {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `凭证状态为"${credential.status}"，不可核销` });
    }

    const now = new Date();
    const detectedAnomalies = [];

    const area = store.getAreaById(credential.areaId);
    if (area && !area.entryPoints.includes(entryPoint)) {
      detectedAnomalies.push({
        type: 'cross_area',
        description: `凭证适用区域为"${credential.area}"，核销入口"${entryPoint}"不属于该区域（有效入口：${area.entryPoints.join('、')}）`
      });
    }

    if (now > new Date(credential.validTo)) {
      detectedAnomalies.push({
        type: 'expired',
        description: `凭证已于 ${credential.validTo} 过期，过期 ${Math.floor((now - new Date(credential.validTo)) / (1000 * 60 * 60 * 24))} 天`
      });
    }

    const batchCredentials = store.getCredentials({ batchId: credential.batchId })
      .sort((a, b) => a.seq - b.seq);

    const issuedOrVerified = batchCredentials.filter(
      c => c.status === '已发放' || c.status === '已核销' || c.status === '异常留置'
    );
    if (issuedOrVerified.length >= 2) {
      const minSeq = Math.min(...issuedOrVerified.map(c => c.seq));
      const maxSeq = Math.max(...issuedOrVerified.map(c => c.seq));
      const gapCreds = batchCredentials.filter(
        c => c.seq > minSeq && c.seq < maxSeq && c.status === '待发放'
      );
      if (gapCreds.length > 0) {
        detectedAnomalies.push({
          type: 'gap',
          description: `号段断裂：在已发放区间 [${credential.prefix}${String(minSeq).padStart(credential.prefix === batchCredentials[0].prefix ? 4 : 4, '0')}-${credential.prefix}${String(maxSeq).padStart(4, '0')}] 内存在 ${gapCreds.length} 张未发放凭证`
        });
      }
    }

    const threshold = store.getRuleValue('concentration_threshold') || 10;
    const windowMinutes = store.getRuleValue('concentration_window_minutes') || 5;
    const recentVerifications = store.getCredentials({})
      .filter(c =>
        c.entryPoint === entryPoint &&
        c.verifiedAt &&
        (now - new Date(c.verifiedAt)) < windowMinutes * 60 * 1000
      );
    if (recentVerifications.length >= threshold) {
      detectedAnomalies.push({
        type: 'concentration',
        description: `入口"${entryPoint}"在 ${windowMinutes} 分钟内已有 ${recentVerifications.length} 次核销，超过阈值 ${threshold}，存在异常集中`
      });
    }

    const newStatus = detectedAnomalies.length > 0 ? '异常留置' : '已核销';
    const nowIso = now.toISOString();
    const anomalies = detectedAnomalies.map(a => ({
      ...a,
      detectedAt: nowIso,
      status: 'pending',
      acceptedBy: null,
      acceptedAt: null,
      result: null,
      handleRemark: null,
      handledBy: null,
      handledAt: null
    }));

    const updated = store.updateCredential(credential.id, {
      status: newStatus,
      verifiedAt: nowIso,
      verifiedBy: req.user.name,
      entryPoint,
      anomalies: [...credential.anomalies, ...anomalies]
    });

    for (const a of detectedAnomalies) {
      store.createAnomaly({
        credentialId: credential.id,
        credentialNo: credential.credentialNo,
        batchNo: credential.batchNo,
        area: credential.area,
        entryPoint,
        type: a.type,
        description: a.description,
        detectedAt: nowIso
      });
    }

    store.addAuditLog('CREDENTIAL_VERIFY', credential.id, req.user.name,
      `核销凭证 ${credential.credentialNo} 于 ${entryPoint}${detectedAnomalies.length > 0 ? '（异常：' + detectedAnomalies.map(a => a.description).join('；') + '）' : ''}`);

    res.json({
      code: 'OK',
      data: updated,
      anomalies: detectedAnomalies.length > 0 ? detectedAnomalies : undefined
    });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/void/:id', auth(['admin']), (req, res) => {
  try {
    const { reason } = req.body;
    const credential = store.getCredentialById(req.params.id);
    if (!credential) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '凭证不存在' });
    }

    if (credential.status !== '待发放' && credential.status !== '已发放' && credential.status !== '已归还') {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `凭证状态为"${credential.status}"，不可作废（仅待发放/已发放/已归还可作废）` });
    }

    const updated = store.updateCredential(credential.id, {
      status: '已作废',
      voidedAt: new Date().toISOString(),
      voidedBy: req.user.name,
      voidReason: reason || ''
    });

    store.addAuditLog('CREDENTIAL_VOID', credential.id, req.user.name, `作废凭证 ${credential.credentialNo}${reason ? '：' + reason : ''}`);

    res.json({ code: 'OK', data: updated });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/void-by-no', auth(['admin']), (req, res) => {
  try {
    const { credentialNo, reason } = req.body;
    if (!credentialNo) {
      return res.status(400).json({ code: 'MISSING_FIELDS', message: '凭证号(credentialNo)必填' });
    }

    const credential = store.getCredentialByNo(credentialNo);
    if (!credential) {
      return res.status(404).json({ code: 'NOT_FOUND', message: `凭证号 ${credentialNo} 不存在` });
    }

    if (credential.status !== '待发放' && credential.status !== '已发放' && credential.status !== '已归还') {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `凭证状态为"${credential.status}"，不可作废` });
    }

    const updated = store.updateCredential(credential.id, {
      status: '已作废',
      voidedAt: new Date().toISOString(),
      voidedBy: req.user.name,
      voidReason: reason || ''
    });

    store.addAuditLog('CREDENTIAL_VOID', credential.id, req.user.name, `作废凭证 ${credential.credentialNo}${reason ? '：' + reason : ''}`);

    res.json({ code: 'OK', data: updated });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/inventory', auth(['admin']), (req, res) => {
  try {
    const { batchId, areaId } = req.body;
    const now = new Date();
    const results = {
      scannedTotal: 0,
      pendingInventory: 0,
      exceptionHeld: 0,
      unchanged: 0,
      details: []
    };

    const filter = {};
    if (batchId) filter.batchId = batchId;
    if (areaId) filter.areaId = areaId;
    filter.status = '已发放';

    const credentials = store.getCredentials(filter);
    results.scannedTotal = credentials.length;

    for (const cred of credentials) {
      const isExpired = now > new Date(cred.validTo);
      const hasAnomalies = cred.anomalies && cred.anomalies.length > 0;

      if (isExpired || hasAnomalies) {
        const newStatus = hasAnomalies ? '异常留置' : '待盘点';
        store.updateCredential(cred.id, {
          status: newStatus,
          inventoryAt: now.toISOString()
        });

        if (newStatus === '异常留置') {
          results.exceptionHeld++;
        } else {
          results.pendingInventory++;
        }

        results.details.push({
          credentialNo: cred.credentialNo,
          batchNo: cred.batchNo,
          area: cred.area,
          recipientName: cred.recipientName,
          recipientIdCard: cred.recipientIdCard,
          validTo: cred.validTo,
          newStatus,
          reasons: [
            ...(isExpired ? ['已过期'] : []),
            ...(hasAnomalies ? [`存在${cred.anomalies.length}条异常记录`] : [])
          ]
        });
      } else {
        results.unchanged++;
      }
    }

    store.addAuditLog('INVENTORY', null, req.user.name,
      `盘点完成：扫描${results.scannedTotal}张，待盘点${results.pendingInventory}张，异常留置${results.exceptionHeld}张`);

    res.json({ code: 'OK', data: results });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;
