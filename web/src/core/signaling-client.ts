import { type ClientMsg, type Mode, type Role, type ServerMsg, parseServerMsg, serializeClientMsg } from './protocol';

export interface ISocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => ISocket;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as ISocket;

export class SignalingClient {
  private socket: ISocket | null = null;
  private handler: ((msg: ServerMsg) => void) | null = null;
  private pendingJoin: ClientMsg | null = null;

  constructor(private url: string, private factory: SocketFactory = defaultFactory) {}

  onMessage(handler: (msg: ServerMsg) => void) {
    this.handler = handler;
  }

  join(room: string, role: Role, mode: Mode) {
    this.pendingJoin = { type: 'join', room, role, mode };
    const socket = this.factory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.pendingJoin) socket.send(serializeClientMsg(this.pendingJoin));
    };
    socket.onmessage = (ev) => {
      const msg = parseServerMsg(ev.data);
      if (msg && this.handler) this.handler(msg);
    };
  }

  send(msg: ClientMsg) {
    this.socket?.send(serializeClientMsg(msg));
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}
