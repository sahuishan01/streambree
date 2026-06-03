export type ConnState =
  | 'idle'
  | 'joining'
  | 'waiting-for-peer'
  | 'negotiating'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export type Transport = 'unknown' | 'direct' | 'relay';

export interface MachineState {
  conn: ConnState;
  transport: Transport;
}

export type MachineEvent =
  | { type: 'join' }
  | { type: 'joined'; peerPresent: boolean }
  | { type: 'peer-joined' }
  | { type: 'negotiation-started' }
  | { type: 'connected'; transport: Transport }
  | { type: 'peer-left' }
  | { type: 'socket-lost' }
  | { type: 'socket-restored' }
  | { type: 'close' };

export const initial: MachineState = { conn: 'idle', transport: 'unknown' };

export function reduce(state: MachineState, event: MachineEvent): MachineState {
  if (event.type === 'close') {
    return { conn: 'closed', transport: 'unknown' };
  }
  if (event.type === 'socket-lost') {
    return { ...state, conn: 'reconnecting' };
  }
  if (event.type === 'socket-restored') {
    return { ...state, conn: 'joining' };
  }

  switch (state.conn) {
    case 'idle':
      if (event.type === 'join') return { ...state, conn: 'joining' };
      return state;
    case 'joining':
      if (event.type === 'joined') {
        return { ...state, conn: event.peerPresent ? 'negotiating' : 'waiting-for-peer' };
      }
      return state;
    case 'waiting-for-peer':
      if (event.type === 'peer-joined') return { ...state, conn: 'negotiating' };
      return state;
    case 'negotiating':
      if (event.type === 'connected') return { conn: 'connected', transport: event.transport };
      return state;
    case 'connected':
      if (event.type === 'peer-left') return { conn: 'waiting-for-peer', transport: 'unknown' };
      return state;
    default:
      return state;
  }
}
