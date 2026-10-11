// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EligibilityBadge } from '../src/features/journeys/journeys-page';

afterEach(cleanup);

describe('EligibilityBadge', () => {
  it('shows the percentage when eligible and prompts for missing arrival times', () => {
    render(<EligibilityBadge e={{ status: 'eligible', delayMin: 22, percent: 25, message: '', schemeVerified: false }} />);
    expect(screen.getByText('Eligible · 25%')).toBeInTheDocument();
    cleanup();
    render(<EligibilityBadge e={{ status: 'needs_arrival_time', delayMin: null, percent: null, message: '', schemeVerified: false }} />);
    expect(screen.getByText('Add arrival time')).toBeInTheDocument();
  });
});
