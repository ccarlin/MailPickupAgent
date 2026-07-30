const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const tools = require('../app/tools');

const router = express.Router();
const CONFIG_DIR = path.resolve(__dirname, '..', 'config');

router.get('/', (req, res) => {
  res.render('configHistory', { title: 'Config History' });
});

router.get('/api/backups', (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_DIR);
    const rules = [];
    const settings = [];

    files.forEach(f => {
      const match = f.match(/^(.+?)_(\d{13,})\.bak$/);
      if (!match) return;

      const baseName = match[1];
      const timestamp = parseInt(match[2], 10);
      const filePath = path.join(CONFIG_DIR, f);
      const stat = fs.statSync(filePath);
      const entry = {
        filename: f,
        timestamp,
        date: new Date(timestamp).toLocaleString(),
        size: stat.size,
        readableSize: stat.size < 1024 ? `${stat.size} B` : `${(stat.size / 1024).toFixed(1)} KB`
      };

      if (baseName === 'rules.json') {
        rules.push(entry);
      } else if (baseName.endsWith('.json')) {
        entry.env = baseName.replace('.json', '');
        settings.push(entry);
      }
    });

    rules.sort((a, b) => b.timestamp - a.timestamp);
    settings.sort((a, b) => b.timestamp - a.timestamp);

    res.json({ rules, settings });
  } catch (error) {
    tools.logError('Error listing backups: ' + error.message);
    res.status(500).json({ message: 'Failed to list backups' });
  }
});

router.get('/api/backup/content', (req, res) => {
  try {
    const filename = req.query.file;
    if (!filename) return res.status(400).json({ message: 'Missing file parameter' });

    const filePath = path.resolve(CONFIG_DIR, filename);
    if (!filePath.startsWith(CONFIG_DIR)) {
      return res.status(403).json({ message: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Backup file not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ filename, content });
  } catch (error) {
    tools.logError('Error reading backup: ' + error.message);
    res.status(500).json({ message: 'Failed to read backup' });
  }
});

router.get('/api/current', (req, res) => {
  try {
    const type = req.query.type;
    if (!type || !['rules', 'settings'].includes(type)) {
      return res.status(400).json({ message: 'Invalid type, must be "rules" or "settings"' });
    }

    let filePath;
    if (type === 'rules') {
      filePath = path.join(CONFIG_DIR, 'rules.json');
    } else {
      const env = process.env.NODE_ENV || 'production';
      filePath = path.join(CONFIG_DIR, `${env}.json`);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Current file not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ type, content });
  } catch (error) {
    tools.logError('Error reading current: ' + error.message);
    res.status(500).json({ message: 'Failed to read current file' });
  }
});

router.post('/api/restore', (req, res) => {
  try {
    const { type, file } = req.body;
    if (!type || !['rules', 'settings'].includes(type)) {
      return res.status(400).json({ message: 'Invalid type, must be "rules" or "settings"' });
    }
    if (!file) return res.status(400).json({ message: 'Missing file parameter' });

    const backupPath = path.resolve(CONFIG_DIR, file);
    if (!backupPath.startsWith(CONFIG_DIR)) {
      return res.status(403).json({ message: 'Invalid file path' });
    }
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ message: 'Backup file not found' });
    }

    let targetPath;
    if (type === 'rules') {
      targetPath = path.join(CONFIG_DIR, 'rules.json');
    } else {
      const env = process.env.NODE_ENV || 'production';
      targetPath = path.join(CONFIG_DIR, `${env}.json`);
    }

    const backupContent = fs.readFileSync(backupPath, 'utf8');
    try {
      JSON.parse(backupContent);
    } catch {
      return res.status(400).json({ message: 'Backup file contains invalid JSON, cannot restore' });
    }

    fs.copyFileSync(targetPath, `${targetPath}_${Date.now().toString()}.bak`);

    fs.writeFileSync(targetPath, backupContent, 'utf8');

    if (type === 'settings') {
      config.reload();
    }

    res.json({ success: true, message: `${type === 'rules' ? 'Rules' : 'Settings'} restored successfully from backup` });
  } catch (error) {
    tools.logError('Error restoring backup: ' + error.message);
    res.status(500).json({ message: 'Failed to restore: ' + (error.message || 'Unknown error') });
  }
});

router.delete('/api/backup', (req, res) => {
  try {
    const { file } = req.body;
    if (!file) return res.status(400).json({ message: 'Missing file parameter' });

    const filePath = path.resolve(CONFIG_DIR, file);
    if (!filePath.startsWith(CONFIG_DIR)) {
      return res.status(403).json({ message: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Backup file not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (error) {
    tools.logError('Error deleting backup: ' + error.message);
    res.status(500).json({ message: 'Failed to delete backup: ' + (error.message || 'Unknown error') });
  }
});

module.exports = router;
