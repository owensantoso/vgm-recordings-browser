-- Reviewed identity and relationship source; IDs are permanent, titles are editable.
CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT NOT NULL, game TEXT, franchise TEXT, composer TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE recordings (file TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), song_id TEXT REFERENCES songs(id));
CREATE TABLE song_references (id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id), kind TEXT NOT NULL CHECK(kind IN ('original','cover','arrangement','chart','other')), label TEXT NOT NULL, url TEXT NOT NULL, artist TEXT);
CREATE TABLE repertoire (song_id TEXT PRIMARY KEY REFERENCES songs(id), note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL UNIQUE);

INSERT INTO sessions VALUES ('2026-05-31-shimokitazawa-first-vgm-session', '2026-05-31 Shimokitazawa First VGM Session', '2026-05-31');
INSERT INTO sessions VALUES ('2026-07-26-shimokitazawa-vgm-session', '2026-07-26 Shimokitazawa VGM Session', '2026-07-26');
INSERT INTO songs VALUES ('vgm-gourmet-race', 'Gourmet Race', 'Kirby Super Star', 'Kirby', NULL);
INSERT INTO songs VALUES ('vgm-bob-omb-battlefield', 'Bob-omb Battlefield', 'Super Mario 64', 'Super Mario', NULL);
INSERT INTO songs VALUES ('vgm-beneath-the-mask', 'Beneath the Mask', 'Persona 5', 'Persona', NULL);
INSERT INTO songs VALUES ('vgm-megalovania', 'Megalovania', 'Undertale', 'Undertale', NULL);
INSERT INTO songs VALUES ('vgm-dragon-roost-island', 'Dragon Roost Island', 'The Legend of Zelda: The Wind Waker', 'The Legend of Zelda', NULL);
INSERT INTO songs VALUES ('vgm-yoshi-circuit-double-dash', 'Yoshi Circuit', 'Mario Kart: Double Dash!!', 'Mario Kart', NULL);
INSERT INTO songs VALUES ('vgm-when-mother-was-there', 'When Mother Was There', 'Persona 5', 'Persona', NULL);
INSERT INTO songs VALUES ('vgm-you-will-know-our-names', 'You Will Know Our Names', 'Xenoblade Chronicles', 'Xenoblade Chronicles', NULL);
INSERT INTO songs VALUES ('vgm-meta-knights-revenge', 'Meta Knight''s Revenge', 'Kirby Super Star', 'Kirby', NULL);
INSERT INTO songs VALUES ('vgm-dire-dire-docks', 'Dire, Dire Docks', 'Super Mario 64', 'Super Mario', NULL);
INSERT INTO songs VALUES ('vgm-life-will-change', 'Life Will Change', 'Persona 5', 'Persona', NULL);
INSERT INTO songs VALUES ('vgm-underground-theme-mario-kart-world', 'Underground Theme', 'Mario Kart World', 'Super Mario', NULL);
INSERT INTO songs VALUES ('vgm-coconut-mall', 'Coconut Mall', 'Mario Kart Wii', 'Mario Kart', NULL);
-- Uncertain and unidentified takes deliberately have no song assignment.
INSERT INTO recordings VALUES ('IMG_7799.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-gourmet-race');
INSERT INTO recordings VALUES ('IMG_7798.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-bob-omb-battlefield');
INSERT INTO recordings VALUES ('IMG_7797.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_7796.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-beneath-the-mask');
INSERT INTO recordings VALUES ('IMG_7795.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_7794.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-megalovania');
INSERT INTO recordings VALUES ('IMG_7793.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-dragon-roost-island');
INSERT INTO recordings VALUES ('IMG_7792.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_7791.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_7790.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_7789.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_7788.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-yoshi-circuit-double-dash');
INSERT INTO recordings VALUES ('IMG_7787.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings VALUES ('IMG_5934 Persona The Dya when my mother was there.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-when-mother-was-there');
INSERT INTO recordings VALUES ('IMG_5936 xenoblade You will know our names_1.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-you-will-know-our-names');
INSERT INTO recordings VALUES ('IMG_5937 xenoblade You will know our names_2.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-you-will-know-our-names');
INSERT INTO recordings VALUES ('IMG_5939 kirby metaknight.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-meta-knights-revenge');
INSERT INTO recordings VALUES ('IMG_5940 SM64 dire dire docks.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-dire-dire-docks');
INSERT INTO recordings VALUES ('IMG_5941 Persona 5 Life Will Change.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-life-will-change');
INSERT INTO recordings VALUES ('IMG_5942 MKWorld Underground Theme.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-underground-theme-mario-kart-world');
INSERT INTO recordings VALUES ('IMG_5943 Coconut Mall.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-coconut-mall');
INSERT INTO recordings VALUES ('IMG_5944 MKart Yoshi Circuit.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-yoshi-circuit-double-dash');
-- Repertoire and original/cover/chart references are empty until explicitly selected and evidenced.
