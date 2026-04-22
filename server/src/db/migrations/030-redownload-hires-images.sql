-- Upgrade stored image URLs from 160px thumbnails to 800px (LinkedIn's max feedshare size).
UPDATE posts SET
  image_urls = REPLACE(image_urls, 'feedshare-shrink_160', 'feedshare-shrink_800')
WHERE image_urls IS NOT NULL AND image_urls != '[]'
  AND image_urls LIKE '%feedshare-shrink_160%';

-- Also fix any that were previously set to 2048 (which doesn't exist on LinkedIn CDN).
UPDATE posts SET
  image_urls = REPLACE(image_urls, 'feedshare-shrink_2048', 'feedshare-shrink_800')
WHERE image_urls IS NOT NULL AND image_urls != '[]'
  AND image_urls LIKE '%feedshare-shrink_2048%';
