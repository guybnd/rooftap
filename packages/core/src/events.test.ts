import { describe, expect, it } from 'vitest';
import { eventDetailLabel, mapsDirectionsUrl, mapsSearchUrl } from './events';

describe('eventDetailLabel', () => {
  it('shows the place when one was entered', () => {
    expect(eventDetailLabel({ location: 'Queen Victoria Market', category: 'social' })).toBe('Queen Victoria Market');
  });

  it('falls back to the category without a place', () => {
    expect(eventDetailLabel({ location: null, category: 'social' })).toBe('Social');
    expect(eventDetailLabel({ location: '   ', category: 'medical' })).toBe('Medical');
  });
});

describe('mapsSearchUrl', () => {
  it('encodes the place as a Maps search', () => {
    expect(mapsSearchUrl(' Queen Victoria Market ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Queen%20Victoria%20Market'
    );
  });
});

describe('mapsDirectionsUrl', () => {
  it('heads for the place by the travel mode', () => {
    expect(mapsDirectionsUrl(' Queen Victoria Market ', 'walk')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Queen%20Victoria%20Market&travelmode=walking'
    );
  });
  it('leaves the mode to Maps without one', () => {
    expect(mapsDirectionsUrl('MCG', null)).toBe('https://www.google.com/maps/dir/?api=1&destination=MCG');
  });
});
