import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCatalogInput } from '../cloudflare/api-worker/src/index.ts';

const validCatalogItem = {
  systemKey: 'dnd',
  title: 'История у старой башни',
  description: 'Короткое описание.',
  imageUrl: '/assets/system-dnd.webp',
  age: '18+',
  format: 'online',
  price: '1500 ₽',
  gameType: 'oneshot',
  status: 'Подходит новичкам',
  sortOrder: 0,
  publicationStatus: 'draft',
};

test('accepts a complete catalog record with a draft publication status', () => {
  const result = normalizeCatalogInput(validCatalogItem);
  assert.equal('error' in result, false);
  assert.equal(result.publicationStatus, 'draft');
  assert.equal(result.published, false);
});

test('rejects arbitrary properties and unsupported enum values', () => {
  assert.match(normalizeCatalogInput({ ...validCatalogItem, admin: true }).error, /неизвестные поля/i);
  assert.match(normalizeCatalogInput({ ...validCatalogItem, systemKey: 'other' }).error, /систему/i);
  assert.match(normalizeCatalogInput({ ...validCatalogItem, format: 'hybrid' }).error, /формат/i);
  assert.match(normalizeCatalogInput({ ...validCatalogItem, publicationStatus: 'visible' }).error, /публикации/i);
});

test('accepts HTTPS catalog media only from the approved VK image CDN', () => {
  assert.equal('error' in normalizeCatalogInput({ ...validCatalogItem, imageUrl: 'http://sun9-1.vkuserphoto.ru/image.jpg' }), true);
  assert.equal('error' in normalizeCatalogInput({ ...validCatalogItem, imageUrl: 'https://images.example.com/image.jpg' }), true);
  assert.equal('error' in normalizeCatalogInput({ ...validCatalogItem, imageUrl: 'https://sun9-1.vkuserphoto.ru/image.jpg' }), false);
});

test('rejects oversized fields and invalid revision values', () => {
  assert.equal('error' in normalizeCatalogInput({ ...validCatalogItem, title: 'x'.repeat(201) }), true);
  assert.equal('error' in normalizeCatalogInput({ ...validCatalogItem, description: 'x'.repeat(4001) }), true);
  assert.equal('error' in normalizeCatalogInput({ ...validCatalogItem, revision: 0 }), true);
});
