export function resolveLiveReplyMonitorStatus({
  snapshot,
  nowMs,
  serviceHealth,
  telemetry = null,
  sessionStartedMs = 0,
  startupGraceMs = 90_000
} = {}) {
  const latestIncoming = Date.parse(snapshot?.incoming?.latest || '') || 0;
  const latestTrace = Date.parse(snapshot?.traces?.latest || '') || 0;
  const latestReply = Date.parse(snapshot?.replies?.latest || '') || 0;
  const serviceFailed = (
    !serviceHealth?.appAlive ||
    !serviceHealth?.appResponding ||
    !serviceHealth?.sqliteReady ||
    serviceHealth?.sqliteIntegrity !== 'ok' ||
    !serviceHealth?.milvusReady ||
    (serviceHealth?.missingPorts?.length || 0) > 0
  );
  if (serviceFailed) {
    if (sessionStartedMs > 0 && nowMs - sessionStartedMs < startupGraceMs) return 'starting';
    return 'service_stall';
  }
  const telemetryStages = telemetry?.stages || {};
  if (Object.keys(telemetryStages).length) {
    const latestDirectorStart = Date.parse(telemetry.latest?.['director-start'] || '') || 0;
    const latestDirectorStop = Date.parse(telemetry.latest?.['director-stop'] || '') || 0;
    if (latestDirectorStop > 0 && latestDirectorStop >= latestDirectorStart) return 'healthy';
    const latestAudience = Date.parse(telemetry.latest?.['audience-arrived'] || '') || 0;
    const latestSelected = Date.parse(telemetry.latest?.selected || '') || 0;
    const latestLlmStart = Date.parse(telemetry.latest?.['llm-start'] || '') || 0;
    const latestFirstSentence = Date.parse(telemetry.latest?.['first-sentence'] || '') || 0;
    if (latestAudience > latestSelected && nowMs - latestAudience >= 45_000) return 'scheduler_stall';
    if (latestLlmStart > latestFirstSentence && nowMs - latestLlmStart >= 30_000) {
      return 'llm_generation_stall';
    }
    return 'healthy';
  }
  if (latestIncoming > latestTrace && nowMs - latestTrace >= 45_000) return 'scheduler_stall';
  if (latestTrace > latestReply && nowMs - latestReply >= 60_000) return 'llm_generation_stall';
  return 'healthy';
}

export function liveReplyMonitorRecordType(status, previousStatus) {
  const healthy = status === 'healthy' || status === 'starting';
  return !healthy && status !== previousStatus ? 'alert' : 'sample';
}

export function liveReplyMonitorShouldPrint({
  status,
  previousStatus,
  nowMs,
  lastHeartbeatAt,
  heartbeatMs
} = {}) {
  return status !== previousStatus || nowMs - lastHeartbeatAt >= heartbeatMs;
}
