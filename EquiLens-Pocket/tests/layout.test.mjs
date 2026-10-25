import test from 'node:test';
import assert from 'node:assert/strict';
import { decideLayout } from '../public/layout.js';

const mode = o => decideLayout(o).mode;

test('layout by screen size: phones and cover screens stay single page, unfolded screens split', () => {
  assert.equal(mode({ w: 390, h: 844 }), 'phone', 'regular phone');
  assert.equal(mode({ w: 466, h: 678 }), 'phone', 'iPhone Duo cover screen');
  assert.equal(mode({ w: 667, h: 375 }), 'phone', 'small phone in landscape: too narrow for two pages');
  assert.deepEqual(decideLayout({ w: 890, h: 626 }), { mode: 'split', left: 445, top: 0, gap: 0, source: 'size' }, 'iPhone Duo unfolded (landscape): split at the fold');
  assert.deepEqual(decideLayout({ w: 626, h: 890 }), { mode: 'stack', left: 0, top: 445, gap: 0, source: 'size' }, 'iPhone Duo unfolded in portrait: top and bottom');
  assert.equal(decideLayout({ w: 750, h: 832 }).left, 412, 'Galaxy Z Fold unfolded: the list keeps at least rail + 340px');
  assert.equal(decideLayout({ w: 852, h: 393 }).mode, 'split', 'phone in landscape');
  assert.equal(decideLayout({ w: 1180, h: 820 }).left, 590, 'tablet');
});

test('layout follows the reported fold (Viewport Segments) exactly', () => {
  const tabletop = decideLayout({ w: 750, h: 832, segments: [{ x: 0, y: 0, width: 750, height: 400 }, { x: 0, y: 424, width: 750, height: 408 }] });
  assert.deepEqual(tabletop, { mode: 'stack', left: 0, top: 400, gap: 24, source: 'hinge' });
  const book = decideLayout({ w: 750, h: 832, segments: [{ x: 387, y: 0, width: 363, height: 832 }, { x: 0, y: 0, width: 363, height: 832 }] });
  assert.deepEqual(book, { mode: 'split', left: 363, top: 0, gap: 24, source: 'hinge' }, 'never moves content across the hinge, even below the usual minimum width');
  assert.equal(mode({ w: 750, h: 832, segments: [{ x: 0, y: 0, width: 750, height: 832 }] }), 'split', 'a single segment is not a fold');
});

test('layout preference, with automatic fallback when it does not fit', () => {
  assert.equal(mode({ w: 890, h: 626, pref: 'phone' }), 'phone');
  assert.deepEqual(decideLayout({ w: 390, h: 844, pref: 'stack' }), { mode: 'stack', left: 0, top: 422, gap: 0, source: 'pref' });
  assert.deepEqual(decideLayout({ w: 890, h: 626, pref: 'stack' }), { mode: 'split', left: 445, top: 0, gap: 0, source: 'short' });
  assert.deepEqual(decideLayout({ w: 626, h: 890, pref: 'split' }), { mode: 'stack', left: 0, top: 445, gap: 0, source: 'narrow' });
  assert.equal(decideLayout({ w: 390, h: 844, pref: 'split' }).mode, 'phone');
});
