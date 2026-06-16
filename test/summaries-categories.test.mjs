import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summaryCategories,
  summaryCategoryName,
  groupSummariesByCategory,
  SUMMARY_CATEGORY_ORDER,
} from '../summaries.js';

const catalog = [
  { id: 'a', title: 'Zebra', category: 'Happiness', featured: true },
  { id: 'b', title: 'Alpha', category: 'Self-Growth' },
  { id: 'c', title: 'Beta', category: 'Self-Growth' },
  { id: 'd', title: 'Gamma' },
];

test('summaryCategoryName falls back to Uncategorized', () => {
  assert.equal(summaryCategoryName({ category: 'Health' }), 'Health');
  assert.equal(summaryCategoryName({}), 'Uncategorized');
});

test('summaryCategories uses fixed order then counts', () => {
  const cats = summaryCategories(catalog);
  assert.deepEqual(cats.map(([name]) => name), ['Self-Growth', 'Happiness', 'Uncategorized']);
  assert.equal(cats[0][1], 2);
});

test('groupSummariesByCategory sorts within category and respects order', () => {
  const groups = groupSummariesByCategory(catalog);
  assert.equal(groups[0].name, 'Self-Growth');
  assert.deepEqual(groups[0].items.map((s) => s.title), ['Alpha', 'Beta']);
  assert.equal(groups[1].name, 'Happiness');
  assert.equal(groups[groups.length - 1].name, 'Uncategorized');
});

test('groupSummariesByCategory can exclude featured', () => {
  const groups = groupSummariesByCategory(catalog, { excludeFeatured: true });
  const happiness = groups.find((g) => g.name === 'Happiness');
  assert.equal(happiness, undefined);
});

test('SUMMARY_CATEGORY_ORDER includes common shelves', () => {
  assert.ok(SUMMARY_CATEGORY_ORDER.includes('Business & Career'));
  assert.ok(SUMMARY_CATEGORY_ORDER.includes('Uncategorized'));
});