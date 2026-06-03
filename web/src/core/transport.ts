import type { Transport } from './connection-machine';

interface StatsProvider {
  getStats(): Promise<RTCStatsReport>;
}

interface CandidatePairStat {
  type: string;
  id: string;
  nominated?: boolean;
  selected?: boolean;
  state?: string;
  remoteCandidateId?: string;
}

interface RemoteCandidateStat {
  type: string;
  id: string;
  candidateType?: string;
}

/**
 * Inspect the WebRTC stats to decide whether media is flowing directly (P2P)
 * or through a TURN relay (CGNAT fallback). Returns 'unknown' until a candidate
 * pair has been selected.
 */
export async function detectTransport(peer: StatsProvider): Promise<Transport> {
  const stats = await peer.getStats();
  let selectedRemoteId: string | undefined;
  const remoteCandidateTypes = new Map<string, string>();

  stats.forEach((report: unknown) => {
    const r = report as CandidatePairStat & RemoteCandidateStat;
    if (r.type === 'candidate-pair' && (r.selected || r.nominated || r.state === 'succeeded')) {
      if (r.remoteCandidateId) selectedRemoteId = r.remoteCandidateId;
    } else if (r.type === 'remote-candidate' && r.candidateType) {
      remoteCandidateTypes.set(r.id, r.candidateType);
    }
  });

  if (!selectedRemoteId) return 'unknown';
  return remoteCandidateTypes.get(selectedRemoteId) === 'relay' ? 'relay' : 'direct';
}
