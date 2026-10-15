/**
 * Message Flow — pure mapping from raw metrics to flow-chart values.
 * UMD: runnable from Node (unit-tested) and in the browser (/messageflow page).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MessageFlow = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function computeFlow(metrics) {
    const m = metrics || {};
    const totalProcessed = num(m.totalProcessed);
    const whitelisted = num(m.whitelisted);
    const blacklisted = num(m.blacklisted);
    const quarantined = num(m.quarantined);
    const released = num(m.released);
    const deleted = num(m.deleted);

    const blacklistReached = Math.max(0, totalProcessed - whitelisted);
    const scoringReached = Math.max(0, totalProcessed - whitelisted - blacklisted);

    return {
      inbound: totalProcessed,
      whitelistReached: totalProcessed,
      blacklistReached: blacklistReached,
      scoringReached: scoringReached,
      thresholdReached: scoringReached,
      whitelisted: whitelisted,
      blacklisted: blacklisted,
      quarantined: quarantined,
      released: released,
      deleted: deleted
    };
  }

  return { computeFlow: computeFlow };
});
