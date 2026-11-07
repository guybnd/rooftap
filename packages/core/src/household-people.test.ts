import { describe, expect, it } from 'vitest';
import { firstName, householdPeopleLine } from './household-people';

describe('householdPeopleLine', () => {
  it('names a household of one', () => expect(householdPeopleLine([])).toBe('Just you'));
  it('joins two', () => expect(householdPeopleLine(['Sam'])).toBe('You and Sam'));
  it('joins three', () => expect(householdPeopleLine(['Sam', 'Mia'])).toBe('You, Sam and Mia'));
  it('folds the rest', () => expect(householdPeopleLine(['Sam', 'Mia', 'Jo', 'Al'])).toBe('You, Sam and 3 others'));
});

describe('firstName', () => {
  it('takes the first word', () => expect(firstName('Sam Lee')).toBe('Sam'));
  it('falls back to the email', () => expect(firstName(null, 'mia@x.com')).toBe('mia'));
  it('says Someone with nothing', () => expect(firstName(null)).toBe('Someone'));
});
