export type BroadcastRole = 'broadcaster' | 'viewer';

export type BroadcastClientMsg =
  | { type: 'join-broadcast'; code: string; role: BroadcastRole; jwt: string }
  | { type: 'offer'; peer_id: string; sdp: string }
  | { type: 'answer'; peer_id: string; sdp: string }
  | { type: 'ice'; peer_id: string; candidate: RTCIceCandidateInit };

export type BroadcastServerMsg =
  | { type: 'broadcast-joined'; live: boolean; viewers: string[] }
  | { type: 'viewer-joined'; peer_id: string }
  | { type: 'viewer-left'; peer_id: string }
  | { type: 'broadcaster-left' }
  | { type: 'force-stopped'; by: string }
  | { type: 'offer'; peer_id: string; sdp: string }
  | { type: 'answer'; peer_id: string; sdp: string }
  | { type: 'ice'; peer_id: string; candidate: RTCIceCandidateInit }
  | { type: 'error'; code: string; message: string };

export function serializeBroadcastMsg(msg: BroadcastClientMsg): string {
  return JSON.stringify(msg);
}

export function parseBroadcastServerMsg(raw: string): BroadcastServerMsg | null {
  try {
    return JSON.parse(raw) as BroadcastServerMsg;
  } catch {
    return null;
  }
}
