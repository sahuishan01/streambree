export interface Room {
  id: string;
  name: string;
  code: string;
}

export class ApiClient {
  token: string | null = null;

  constructor(private base: string, private fetchImpl: typeof fetch = fetch) {
    this.token = localStorage.getItem('sl_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) localStorage.setItem('sl_token', token);
    else localStorage.removeItem('sl_token');
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async signup(email: string, password: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/signup`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) this.setToken(data.token);
    else throw new Error('signup failed');
  }

  async login(email: string, password: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/login`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) this.setToken(data.token);
    else throw new Error('login failed');
  }

  async createNamedRoom(name: string): Promise<Room> {
    const res = await this.fetchImpl(`${this.base}/rooms`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ name }),
    });
    return res.json();
  }

  async createGuestRoom(): Promise<{ code: string }> {
    const res = await this.fetchImpl(`${this.base}/rooms`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({}),
    });
    return res.json();
  }

  async listRooms(): Promise<Room[]> {
    const res = await this.fetchImpl(`${this.base}/rooms`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }

  async deleteRoom(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/rooms/${id}`, { method: 'DELETE', headers: this.headers(false) });
  }

  async resolveRoom(code: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base}/rooms/resolve/${code}`, { method: 'GET' });
    return res.ok;
  }
}
