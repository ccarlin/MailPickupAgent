const EventEmitter = require('events');

const metrics = {
  totalProcessed: 0,
  whitelisted: 0,
  blacklisted: 0,
  quarantined: 0,
  released: 0,
  deleted: 0,
  serverStartTime: Date.now(),
  aiCheckTimeTotal: 0,
  aiCheckCount: 0,
  saCheckTimeTotal: 0,
  saCheckCount: 0,
  processTimeTotal: 0,
  processCount: 0
};

const eventBus = new EventEmitter();

function increment(counter) {
  // eslint-disable-next-line no-prototype-builtins
  if (metrics.hasOwnProperty(counter)) {
    metrics[counter]++;
  }
  metrics.totalProcessed++;
  eventBus.emit('metricUpdate', counter);
}

function addTiming(type, ms) {
  if (type === 'ai') {
    metrics.aiCheckTimeTotal += ms;
    metrics.aiCheckCount++;
  } else if (type === 'sa') {
    metrics.saCheckTimeTotal += ms;
    metrics.saCheckCount++;
  } else if (type === 'process') {
    metrics.processTimeTotal += ms;
    metrics.processCount++;
  }
  eventBus.emit('metricUpdate', type + 'Timing');
}

function getMetrics() {
  const m = { ...metrics, uptime: Date.now() - metrics.serverStartTime };
  m.aiAvgTime = m.aiCheckCount > 0 ? Math.round(m.aiCheckTimeTotal / m.aiCheckCount) : null;
  m.saAvgTime = m.saCheckCount > 0 ? Math.round(m.saCheckTimeTotal / m.saCheckCount) : null;
  m.avgProcessTime = m.processCount > 0 ? Math.round(m.processTimeTotal / m.processCount) : 0;
  return m;
}

function resetMetrics() {
  metrics.totalProcessed = 0;
  metrics.whitelisted = 0;
  metrics.blacklisted = 0;
  metrics.quarantined = 0;
  metrics.released = 0;
  metrics.deleted = 0;
  metrics.serverStartTime = Date.now();
  metrics.aiCheckTimeTotal = 0;
  metrics.aiCheckCount = 0;
  metrics.saCheckTimeTotal = 0;
  metrics.saCheckCount = 0;
  metrics.processTimeTotal = 0;
  metrics.processCount = 0;
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

module.exports = { increment, addTiming, getMetrics, resetMetrics, formatUptime, eventBus };
