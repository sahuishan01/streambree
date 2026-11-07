import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

describe('app flow', () => {
  it('home shows the two primary actions', () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.getByText(/Start streaming/i)).toBeInTheDocument();
    expect(screen.getByText(/Join a stream/i)).toBeInTheDocument();
  });

  it('sender screen lets you pick a source and mode', () => {
    localStorage.setItem('sl_token', 'JWT');
    render(<MemoryRouter initialEntries={['/send']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/Screen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Real-time/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Camera/i));
    expect((screen.getByLabelText(/Camera/i) as HTMLInputElement).checked).toBe(true);
  });

  it('channels screen shows a create form', () => {
    localStorage.setItem('sl_token', 'JWT');
    render(<MemoryRouter initialEntries={['/channels']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/channel name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create channel/i })).toBeInTheDocument();
  });

  it('join screen auto-fills the room code from a shared link', () => {
    render(<MemoryRouter initialEntries={['/join?code=abcde12345']}><App /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Leave/i })).toBeInTheDocument();
    expect(screen.getByText('ABCDE12345')).toBeInTheDocument();
  });

  it('channel detail renders members and the go-live action for a member', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      const body = u.endsWith('/members')
        ? [{ user_id: 'u1', email: 'me@b.com', role: 'owner', can_stream: true }]
        : u.includes('/stream') ? { live: false }
        : { id: 'c1', name: 'Movie', code: 'X', role: 'owner', can_stream: true };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;
    localStorage.setItem('sl_token', 'JWT');
    render(<MemoryRouter initialEntries={['/channels/c1']}><App /></MemoryRouter>);
    expect(await screen.findByText(/Movie/)).toBeInTheDocument();
    expect(await screen.findByText(/Go live/i)).toBeInTheDocument();
    globalThis.fetch = orig;
  });

  it('go-live screen shows source and mode pickers', () => {
    localStorage.setItem('sl_token', 'JWT');
    render(<MemoryRouter initialEntries={['/golive/CODE']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/Screen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Real-time/i)).toBeInTheDocument();
  });

  it('watch screen renders a video element', () => {
    localStorage.setItem('sl_token', 'JWT');
    const { container } = render(<MemoryRouter initialEntries={['/watch/CODE']}><App /></MemoryRouter>);
    expect(container.querySelector('video')).not.toBeNull();
  });
});
