export const demoSeedSql = `
INSERT OR IGNORE INTO stages (id, title, description, created_at, updated_at) VALUES
  ('stage-campus', '大学时光', '那些在校园里缓慢发亮的日子。', '2024-01-01T08:00:00.000Z', '2024-01-01T08:00:00.000Z'),
  ('stage-journey', '远方与旅途', '离开熟悉之地，看见更大的世界。', '2024-01-01T08:00:00.000Z', '2024-01-01T08:00:00.000Z'),
  ('stage-growth', '摄影成长', '透过取景框学习观看。', '2024-01-01T08:00:00.000Z', '2024-01-01T08:00:00.000Z');

INSERT OR IGNORE INTO memories (id, stage_id, title, story, visibility, created_at, updated_at) VALUES
  ('memory-library', 'stage-campus', '闭馆前的图书馆', '窗外已经暗下来，我们仍围着同一张长桌。那晚没有发生大事，但纸页、台灯和朋友压低的笑声，后来成了我记得最清楚的大学夜晚之一。', 'private', '2024-03-18T12:00:00.000Z', '2024-03-18T12:00:00.000Z'),
  ('memory-graduation', 'stage-campus', '毕业那天的风', '拨穗仪式结束后，大家在草坪上站了很久。风吹乱了帽穗，也把离别暂时吹得没那么沉重。', 'private', '2024-06-20T09:00:00.000Z', '2024-06-20T09:00:00.000Z'),
  ('memory-coast', 'stage-journey', '沿海公路的一天', '从清晨开到日落，海一直在车窗右侧。我们在没有名字的观景台停下，把午餐和很长一段沉默都留给了海。', 'private', '2024-08-12T10:00:00.000Z', '2024-08-12T10:00:00.000Z'),
  ('memory-rain', 'stage-journey', '雨中的旧城', '计划被一场雨打乱，于是我们收起地图，在石板路上随意拐弯。最意外的下午，反而成为旅途中最柔软的一页。', 'private', '2024-09-03T11:00:00.000Z', '2024-09-03T11:00:00.000Z'),
  ('memory-first-camera', 'stage-growth', '第一台相机', '第一次真正拥有一台相机时，我拍下了窗边最普通的一束光。从那以后，日常开始显露出以前没注意过的细节。', 'private', '2024-10-01T08:00:00.000Z', '2024-10-01T08:00:00.000Z');

INSERT OR IGNORE INTO memory_images (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at) VALUES
  ('image-library', 'memory-library', 'demo/library.svg', '夜晚的图书馆长桌', 0, 1, '2024-03-18T12:00:00.000Z'),
  ('image-graduation', 'memory-graduation', 'demo/graduation.svg', '毕业日的草坪', 0, 1, '2024-06-20T09:00:00.000Z'),
  ('image-coast-1', 'memory-coast', 'demo/coast.svg', '沿海公路', 0, 1, '2024-08-12T10:00:00.000Z'),
  ('image-coast-2', 'memory-coast', 'demo/sea.svg', '傍晚的海面', 1, 0, '2024-08-12T10:00:00.000Z'),
  ('image-coast-3', 'memory-coast', 'demo/lookout.svg', '临海观景台', 2, 0, '2024-08-12T10:00:00.000Z'),
  ('image-rain', 'memory-rain', 'demo/rain.svg', '雨中的石板路', 0, 1, '2024-09-03T11:00:00.000Z'),
  ('image-camera', 'memory-first-camera', 'demo/camera.svg', '窗边的相机', 0, 1, '2024-10-01T08:00:00.000Z');

INSERT OR IGNORE INTO memory_relations (memory_id, related_memory_id, created_at) VALUES
  ('memory-library', 'memory-graduation', '2024-06-20T09:00:00.000Z'),
  ('memory-coast', 'memory-rain', '2024-09-03T11:00:00.000Z');

INSERT OR IGNORE INTO later_notes (id, memory_id, content, created_at) VALUES
  ('note-library', 'memory-library', '后来再路过那栋楼，才发现最怀念的是当时觉得理所当然的陪伴。', '2025-03-18T12:00:00.000Z');

INSERT OR IGNORE INTO share_configs (id, memory_id, enabled, access_mode, created_at, updated_at) VALUES
  ('share-coast', 'memory-coast', 0, 'link', '2024-08-12T10:00:00.000Z', '2024-08-12T10:00:00.000Z');
`;
