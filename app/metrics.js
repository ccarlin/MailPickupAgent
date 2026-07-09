const EventEmitter = require('events');

const metrics = {
  totalProcessed: 0,
  whitelisted: 0,
  blacklisted: 0,
  quarantined: 0,
  released: 0,
  serverStartTime: Date.now()
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

function getMetrics() {
  return { ...metrics, uptime: Date.now() - metrics.serverStartTime };
}

function resetMetrics() {
  metrics.totalProcessed = 0;
  metrics.whitelisted = 0;
  metrics.blacklisted = 0;
  metrics.quarantined = 0;
  metrics.released = 0;
  metrics.serverStartTime = Date.now();
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

module.exports = { increment, getMetrics, resetMetrics, formatUptime, eventBus };
