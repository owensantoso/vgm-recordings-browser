-- Reviewed identity and relationship source; IDs are permanent, titles are editable.
CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT NOT NULL, game TEXT, franchise TEXT, composer TEXT, reference_key TEXT, reference_bpm REAL CHECK(reference_bpm IS NULL OR (typeof(reference_bpm) IN ('integer','real') AND reference_bpm > 0)));
CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE recordings (file TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), song_id TEXT REFERENCES songs(id), played_key TEXT, played_bpm REAL CHECK(played_bpm IS NULL OR (typeof(played_bpm) IN ('integer','real') AND played_bpm > 0)));
CREATE TABLE song_references (id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id), kind TEXT NOT NULL CHECK(kind IN ('original','cover','arrangement','chart','other')), label TEXT NOT NULL, url TEXT NOT NULL, artist TEXT);
CREATE TABLE repertoire (song_id TEXT PRIMARY KEY REFERENCES songs(id), note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL UNIQUE);

INSERT INTO sessions (id, label, date) VALUES ('2026-05-31-shimokitazawa-first-vgm-session', '2026-05-31 Shimokitazawa First VGM Session', '2026-05-31');
INSERT INTO sessions (id, label, date) VALUES ('2026-07-26-shimokitazawa-vgm-session', '2026-07-26 Shimokitazawa VGM Session', '2026-07-26');
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-gourmet-race', 'Gourmet Race', 'Kirby Super Star', 'Kirby', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-bob-omb-battlefield', 'Bob-omb Battlefield', 'Super Mario 64', 'Super Mario', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-beneath-the-mask', 'Beneath the Mask', 'Persona 5', 'Persona', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-megalovania', 'Megalovania', 'Undertale', 'Undertale', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-dragon-roost-island', 'Dragon Roost Island', 'The Legend of Zelda: The Wind Waker', 'The Legend of Zelda', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-yoshi-circuit-double-dash', 'Yoshi Circuit', 'Mario Kart: Double Dash!!', 'Mario Kart', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-when-mother-was-there', 'When Mother Was There', 'Persona 5', 'Persona', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-you-will-know-our-names', 'You Will Know Our Names', 'Xenoblade Chronicles', 'Xenoblade Chronicles', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-meta-knights-revenge', 'Meta Knight''s Revenge', 'Kirby Super Star', 'Kirby', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-dire-dire-docks', 'Dire, Dire Docks', 'Super Mario 64', 'Super Mario', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-life-will-change', 'Life Will Change', 'Persona 5', 'Persona', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-underground-theme-mario-kart-world', 'Underground Theme', 'Mario Kart World', 'Super Mario', NULL);
INSERT INTO songs (id, title, game, franchise, composer) VALUES ('vgm-coconut-mall', 'Coconut Mall', 'Mario Kart Wii', 'Mario Kart', NULL);
-- Uncertain and unidentified takes deliberately have no song assignment.
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7799.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-gourmet-race');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7798.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-bob-omb-battlefield');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7797.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7796.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-beneath-the-mask');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7795.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7794.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-megalovania');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7793.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-dragon-roost-island');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7792.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7791.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7790.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7789.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7788.MOV', '2026-05-31-shimokitazawa-first-vgm-session', 'vgm-yoshi-circuit-double-dash');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_7787.MOV', '2026-05-31-shimokitazawa-first-vgm-session', NULL);
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5934 Persona The Dya when my mother was there.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-when-mother-was-there');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5936 xenoblade You will know our names_1.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-you-will-know-our-names');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5937 xenoblade You will know our names_2.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-you-will-know-our-names');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5939 kirby metaknight.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-meta-knights-revenge');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5940 SM64 dire dire docks.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-dire-dire-docks');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5941 Persona 5 Life Will Change.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-life-will-change');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5942 MKWorld Underground Theme.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-underground-theme-mario-kart-world');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5943 Coconut Mall.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-coconut-mall');
INSERT INTO recordings (file, session_id, song_id) VALUES ('IMG_5944 MKart Yoshi Circuit.MOV', '2026-07-26-shimokitazawa-vgm-session', 'vgm-yoshi-circuit-double-dash');
-- Repertoire remains empty until explicitly selected. Keys and tempos remain unknown.
-- References are listening sources, never inferred to be the arrangement played in a take.
-- See docs/REFERENCE_SOURCES.md for checked source titles, uploaders and edition caveats.

INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('gourmet-race-soundtrack', 'vgm-gourmet-race', 'original', 'Kirby Super Star soundtrack · fan upload', 'https://www.youtube.com/watch?v=Se1uh3PS78Y', NULL);
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('bob-omb-8-bit-big-band', 'vgm-bob-omb-battlefield', 'cover', 'The 8-Bit Big Band cover', 'https://www.youtube.com/watch?v=tMVl0WZH3GY', 'The 8-Bit Big Band');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('beneath-mask-lyn', 'vgm-beneath-the-mask', 'original', 'Persona 5 original soundtrack · Lyn', 'https://www.youtube.com/watch?v=woz5qvDdMRM', 'Lyn');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('megalovania-toby-fox', 'vgm-megalovania', 'original', 'Undertale soundtrack · Toby Fox', 'https://www.youtube.com/watch?v=KK3KXAECte4', 'Toby Fox');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('dragon-roost-taylor-davis', 'vgm-dragon-roost-island', 'cover', 'Taylor Davis violin cover', 'https://www.youtube.com/watch?v=xeUciMWJYDM', 'Taylor Davis');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('yoshi-circuit-mario-kart-world', 'vgm-yoshi-circuit-double-dash', 'arrangement', 'Mario Kart World arrangement · fan upload', 'https://www.youtube.com/watch?v=pfzeDfe0Hrs', NULL);
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('when-mother-soundtrack', 'vgm-when-mother-was-there', 'original', 'Persona 5 soundtrack · fan upload', 'https://www.youtube.com/watch?v=z5ghb_14j5Y', NULL);
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('when-mother-consouls', 'vgm-when-mother-was-there', 'cover', 'The Consouls cover', 'https://www.youtube.com/watch?v=d_L7diRQRR8', 'The Consouls');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('know-our-names-soundtrack', 'vgm-you-will-know-our-names', 'original', 'Xenoblade Chronicles soundtrack · fan upload', 'https://www.youtube.com/watch?v=g7yNyhLOIa4', NULL);
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('meta-knight-super-soul-bros', 'vgm-meta-knights-revenge', 'cover', 'Super Soul Bros cover', 'https://www.youtube.com/watch?v=_91Um2pW5Sk', 'Super Soul Bros');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('dire-dire-docks-soundtrack', 'vgm-dire-dire-docks', 'original', 'Super Mario 64 soundtrack · fan upload', 'https://www.youtube.com/watch?v=Zqa2mgjbOIM', NULL);
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('life-will-change-lyn', 'vgm-life-will-change', 'original', 'Persona 5 original soundtrack · Lyn', 'https://www.youtube.com/watch?v=dsuJZx24V_A', 'Lyn');
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('underground-mario-kart-world', 'vgm-underground-theme-mario-kart-world', 'arrangement', 'Mario Kart World arrangement · fan upload', 'https://www.youtube.com/watch?v=vkySJ91FXhs', NULL);
INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('coconut-mall-soundtrack', 'vgm-coconut-mall', 'original', 'Mario Kart Wii soundtrack · fan upload', 'https://www.youtube.com/watch?v=LGxfNbhfx9g', NULL);
