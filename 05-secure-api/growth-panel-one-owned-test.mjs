import assert from 'node:assert/strict';
import { validGrowthPanelOwnershipContract as valid, GROWTH_PANEL_REQUIRED_BOOKS as eight,
  GROWTH_PANEL_READING_BOOKS as seven } from './src/growth-panel-service.mjs';
const legacy = { ownershipPolicy: 'classic7-plus-theory-explicit', requiredBooks: [...eight] };
const current = { ownershipPolicy: 'classic-one-explicit', requiredBooks: [...seven], minimumOwnedBooks: 1 };
assert.equal(valid(legacy), true);
assert.equal(valid(current), true);
for (const invalid of [
  { ...current, minimumOwnedBooks: undefined },
  { ...current, minimumOwnedBooks: 0 },
  { ...current, requiredBooks: [...eight] },
  { ...current, requiredBooks: ['theory'] },
  { ...current, requiredBooks: [...seven.slice(1), seven[1]] },
  { ...current, ownershipPolicy: 'temporary-pass' },
  { ...legacy, requiredBooks: [...seven] },
]) assert.equal(valid(invalid), false);
console.log('PASS: legacy/new contracts accepted; seven malformed or unauthorized contracts rejected');
