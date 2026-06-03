import { describe, it, expect } from 'vitest';
import { detectTransport } from '../transport';

/** Build a fake RTCStatsReport (Map-like with forEach) from plain stat objects. */
function statsReport(reports: Record<string, unknown>[]): RTCStatsReport {
  const map = new Map(reports.map((r) => [(r as { id: string }).id, r]));
  return map as unknown as RTCStatsReport;
}

describe('detectTransport', () => {
  it('returns "direct" when the selected pair uses a non-relay remote candidate', async () => {
    const peer = {
      getStats: async () =>
        statsReport([
          { id: 'pair1', type: 'candidate-pair', state: 'succeeded', remoteCandidateId: 'rc1' },
          { id: 'rc1', type: 'remote-candidate', candidateType: 'srflx' },
        ]),
    };
    expect(await detectTransport(peer)).toBe('direct');
  });

  it('returns "relay" when the selected pair uses a relay remote candidate', async () => {
    const peer = {
      getStats: async () =>
        statsReport([
          { id: 'pair1', type: 'candidate-pair', nominated: true, remoteCandidateId: 'rc1' },
          { id: 'rc1', type: 'remote-candidate', candidateType: 'relay' },
        ]),
    };
    expect(await detectTransport(peer)).toBe('relay');
  });

  it('returns "unknown" when no candidate pair has been selected', async () => {
    const peer = {
      getStats: async () =>
        statsReport([{ id: 'rc1', type: 'remote-candidate', candidateType: 'host' }]),
    };
    expect(await detectTransport(peer)).toBe('unknown');
  });
});
