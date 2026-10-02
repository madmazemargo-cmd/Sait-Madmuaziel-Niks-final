-- Content cleanup applied to the live calendar/catalog on 2026-10-02.
-- Keep recurring templates without an end date; archive only completed occurrences.

DELETE FROM applications
WHERE submission_id = 'a'
  AND name = 'x'
  AND contact = '@x';

UPDATE calendar_events
SET archived = 1,
    revision = revision + 1,
    updated_at = '2026-10-02T00:00:00.000Z'
WHERE archived = 0
  AND event_date < '2026-10-02'
  AND (
    recurrence = 'none'
    OR (recurrence_until IS NOT NULL AND recurrence_until < '2026-10-02')
  );

-- This existing recurring event has two seats and is a real upcoming opening.
UPDATE calendar_events
SET status = 'available',
    revision = revision + 1,
    updated_at = '2026-10-02T00:00:00.000Z'
WHERE id = '7f36e3d1-962e-46c8-af54-a6e2ea15ad7a'
  AND archived = 0
  AND status = 'ongoing'
  AND seats = 2;

UPDATE catalog_items
SET system_key = 'vampires'
WHERE id = 'catalog-campaign-vampires-request';

UPDATE catalog_items
SET system_key = 'daggerheart'
WHERE id = 'catalog-campaign-daggerheart-request';

UPDATE catalog_items
SET system_key = 'dnd'
WHERE id = 'catalog-oneshot-dnd-request';

UPDATE catalog_items
SET system_key = 'daggerheart'
WHERE id = 'catalog-oneshot-daggerheart-evening';

UPDATE catalog_items
SET title = CASE id
  WHEN 'catalog-oneshot-cyberpunk-evening' THEN 'Неоновая история на один вечер'
  WHEN 'catalog-oneshot-dnd-request' THEN 'Приключение на один вечер'
  WHEN 'catalog-oneshot-daggerheart-evening' THEN 'Сказание на один вечер'
  WHEN 'catalog-campaign-cyberpunk-request' THEN 'Кампания Cyberpunk под запрос'
  WHEN 'f884fb4c-8760-483f-960e-e91be67aba8a' THEN 'Кампания Daggerheart под запрос'
  WHEN '78afd8ad-d6e6-4ed9-9f5a-4ab99556fa34' THEN 'Кампания D&D под запрос'
  ELSE title
END
WHERE id IN (
  'catalog-oneshot-cyberpunk-evening',
  'catalog-oneshot-dnd-request',
  'catalog-oneshot-daggerheart-evening',
  'catalog-campaign-cyberpunk-request',
  'f884fb4c-8760-483f-960e-e91be67aba8a',
  '78afd8ad-d6e6-4ed9-9f5a-4ab99556fa34'
);

UPDATE catalog_items
SET price = CASE WHEN game_type = 'campaign' THEN '1000 руб.' ELSE '1500 руб.' END
WHERE price IN ('1000', '1000 рублей', '1000 руб.', '1500', '1500 рублей', '1500 руб.');

UPDATE catalog_items
SET description = REPLACE(description, '90-ею', '90-е')
WHERE description LIKE '%90-ею%';

UPDATE catalog_items
SET description = REPLACE(description, 'фентези', 'фэнтези')
WHERE description LIKE '%фентези%';
