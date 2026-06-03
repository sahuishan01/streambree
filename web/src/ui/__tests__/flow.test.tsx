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
    render(<MemoryRouter initialEntries={['/send']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/Screen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Real-time/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Camera/i));
    expect((screen.getByLabelText(/Camera/i) as HTMLInputElement).checked).toBe(true);
  });
});
