'use strict';

const express = require('express');
const store = require('./store');
const { auth } = require('./middleware');
const batchRoutes = require('./routes/batch');
const credentialRoutes = require('./routes/credential');
const queryRoutes = require('./routes/query');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = 8113;

app.use(express.json());

store.initSeedData();

app.use('/api/batches', batchRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/stats', statsRoutes);

app.post('/api/areas', auth(['admin']), (req, res) => {
  const { name, entryPoints } = req.body;
  if (!name) {
    return res.status(400).json({ code: 'MISSING_FIELDS', message: '区域名称(name)必填' });
  }
  const existing = store.getAreas().find(a => a.name === name);
  if (existing) {
    return res.status(409).json({ code: 'DUPLICATE', message: `区域"${name}"已存在` });
  }
  const area = store.createArea({ name, entryPoints });
  res.status(201).json({ code: 'OK', data: area });
});

app.put('/api/areas/:id', auth(['admin']), (req, res) => {
  const area = store.updateArea(req.params.id, req.body);
  if (!area) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '区域不存在' });
  }
  res.json({ code: 'OK', data: area });
});

app.delete('/api/areas/:id', auth(['admin']), (req, res) => {
  const area = store.getAreaById(req.params.id);
  if (!area) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '区域不存在' });
  }
  const credentials = store.getCredentials({ areaId: req.params.id });
  const activeCreds = credentials.filter(c => c.status === '待发放' || c.status === '已发放');
  if (activeCreds.length > 0) {
    return res.status(400).json({ code: 'IN_USE', message: `该区域仍有 ${activeCreds.length} 张活跃凭证，不可删除` });
  }
  res.json({ code: 'OK', message: '区域已删除' });
});

app.get('/api/rules', auth(['admin', 'window', 'observer']), (req, res) => {
  const rules = store.getRules();
  res.json({ code: 'OK', data: rules });
});

app.put('/api/rules/:key', auth(['admin']), (req, res) => {
  const { value } = req.body;
  if (value === undefined || value === null) {
    return res.status(400).json({ code: 'MISSING_FIELDS', message: '规则值(value)必填' });
  }
  const rule = store.updateRule(req.params.key, value);
  if (!rule) {
    return res.status(404).json({ code: 'NOT_FOUND', message: '规则不存在' });
  }
  res.json({ code: 'OK', data: rule });
});

app.get('/api/users', auth(['admin']), (req, res) => {
  const users = store.getUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    name: u.name
  }));
  res.json({ code: 'OK', data: users });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats: store.getStats()
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`园区临时通行凭证系统已启动`);
  console.log(`服务地址: http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log('');
  console.log('预置用户:');
  console.log('  管理员   - admin    (角色: admin)');
  console.log('  窗口人员 - window1  (角色: window)');
  console.log('  窗口人员 - window2  (角色: window)');
  console.log('  观察员   - observer1 (角色: observer)');
  console.log('');
  console.log('使用方式: 请求头添加 X-User 指定用户名');
});

module.exports = app;
