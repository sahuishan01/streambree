export interface Channel {
  id: string;
  name: string;
  code: string;
  role?: string;
  can_stream?: boolean;
}

export interface Member {
  user_id: string;
  email: string;
  role: string;
  can_stream: boolean;
}

export class ApiClient {
  token: string | null = null;

  constructor(private base: string, private fetchImpl: typeof fetch = fetch.bind(globalThis)) {
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

  async login(email: string, password: string): Promise<{ token: string; must_change_password?: boolean }> {
    const res = await this.fetchImpl(`${this.base}/login`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      this.setToken(data.token);
      return data;
    }
    throw new Error('login failed');
  }

  // --- channels ---
  async createChannel(name: string): Promise<Channel> {
    const res = await this.fetchImpl(`${this.base}/channels`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ name }),
    });
    return res.json();
  }
  async listChannels(): Promise<Channel[]> {
    const res = await this.fetchImpl(`${this.base}/channels`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }
  async getChannel(id: string): Promise<Channel> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }
  async renameChannel(id: string, name: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ name }) });
  }
  async deleteChannel(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}`, { method: 'DELETE', headers: this.headers(false) });
  }

  // --- members ---
  async listMembers(id: string): Promise<Member[]> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}/members`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }
  async removeMember(id: string, uid: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/members/${uid}`, { method: 'DELETE', headers: this.headers(false) });
  }
  async changeRole(id: string, uid: string, role: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/members/${uid}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ role }) });
  }
  async setStreaming(id: string, uid: string, allowed: boolean): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/members/${uid}/streaming`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ allowed }) });
  }
  async transferOwner(id: string, userId: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/transfer`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ user_id: userId }) });
  }

  // --- invites ---
  async createInvite(id: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}/invites`, { method: 'POST', headers: this.headers(), body: JSON.stringify({}) });
    return (await res.json()).code;
  }
  async addUser(id: string, email: string): Promise<Response> {
    return this.fetchImpl(`${this.base}/channels/${id}/add-user`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ email }) });
  }
  async previewInvite(code: string): Promise<{ channel_id: string; name: string } | null> {
    const res = await this.fetchImpl(`${this.base}/invites/${code}`, { method: 'GET', headers: this.headers(false) });
    return res.ok ? res.json() : null;
  }
  async acceptInvite(code: string): Promise<{ channel_id: string } | null> {
    const res = await this.fetchImpl(`${this.base}/invites/${code}/accept`, { method: 'POST', headers: this.headers(false) });
    return res.ok ? res.json() : null;
  }

  // --- stream / turn ---
  async streamStatus(id: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}/stream`, { method: 'GET', headers: this.headers(false) });
    return res.ok ? (await res.json()).live === true : false;
  }
  async stopStream(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/stream/stop`, { method: 'POST', headers: this.headers(false) });
  }
  async me(): Promise<{ id: string; email: string; username: string; is_owner: boolean; must_change_password?: boolean } | null> {
    if (!this.token) return null;
    const res = await this.fetchImpl(`${this.base}/me`, { method: 'GET', headers: this.headers(false) });
    return res.ok ? res.json() : null;
  }

  async updateMe(username: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/me`, {
      method: 'PATCH', headers: this.headers(), body: JSON.stringify({ username }),
    });
    if (!res.ok) throw new Error('update failed');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/password`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    if (!res.ok) throw new Error('password change failed');
  }

  async listUsers(): Promise<{ id: string; email: string; created_at: string }[]> {
    const res = await this.fetchImpl(`${this.base}/users`, { method: 'GET', headers: this.headers(false) });
    return res.ok ? res.json() : [];
  }
  async createUser(email: string, password: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base}/users`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ email, password }),
    });
    return res.ok;
  }
  async deleteUser(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/users/${id}`, { method: 'DELETE', headers: this.headers(false) });
  }

  async turnCredentials(): Promise<RTCIceServer[]> {
    const res = await this.fetchImpl(`${this.base}/turn-credentials`, { method: 'POST', headers: this.headers(false) });
    return res.ok ? res.json() : [];
  }
}
