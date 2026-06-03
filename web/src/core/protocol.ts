export type Role = 'sender' | 'receiver';
export type Mode = 'realtime' | 'quality';

export type ClientMsg =
  | { type: 'join'; room: string; role: Role; mode: Mode }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

export type ServerMsg =
  | { type: 'joined'; peer_present: boolean; ice_servers: RTCIceServer[] }
  | { type: 'peer-joined' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'peer-left' }
  | { type: 'error'; code: string; message: string };

export function serializeClientMsg(msg: ClientMsg): string {
  return JSON.stringify(msg);
}

export function parseServerMsg(raw: string): ServerMsg | null {
  try {
    return JSON.parse(raw) as ServerMsg;
  } catch {
    return null;
  }
}
