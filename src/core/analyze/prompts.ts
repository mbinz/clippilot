export const SYSTEM_PROMPT = `Du bist ein Video-Analyse-Assistent für Reisevideos.
Analysiere den folgenden Videoclip und antworte ausschließlich in JSON.`;

export const USER_PROMPT = `Analysiere diesen Videoclip. Antworte als JSON mit folgender Struktur:
{
  "scenes": [
    {
      "start_sec": <Sekunden ab Clip-Beginn>,
      "end_sec": <Sekunden ab Clip-Beginn>,
      "description_en": "Description in English",
      "subjects": ["Person 1"],
      "setting": "<kurzer englischer Tag, z.B. marina>",
      "activity": "<kurzer englischer Tag, z.B. dolphin watching>",
      "mood": "Stimmung",
      "visual_keywords": ["keyword1", "keyword2"]
    }
  ],
  "clip_summary": "Kurze Zusammenfassung des Clips",
  "highlights": [
    {
      "start_sec": <Sekunden ab Clip-Beginn>,
      "end_sec": <Sekunden ab Clip-Beginn>,
      "description": "Description of the standout moment, in English",
      "tier": "hero | solid | filler",
      "shot": "wide | medium | close | detail",
      "role": "establishing | action | reaction | detail | transition",
      "issues": ["shake | blur | obstructed | overexposed | underexposed"],
      "slowmo": "none | light | strong",
      "slowmo_reason": "Short reason in English, empty if none",
      "audio_keep": false,
      "audio_type": "ambient | speech | music | noise"
    }
  ]
}

highlights: 0 bis 5 brauchbare Momente für einen Reise-Montage-Film (leeres Array, wenn nichts taugt).
start_sec und end_sec sind Zahlen in Sekunden ab Clip-Beginn und müssen aus dem stammen, was im Video tatsächlich zu sehen ist (keine Beispielwerte übernehmen). description auf Englisch.
tier: wie stark der Moment als Einstellung in einem Reise-Montage-Video ist. "hero" = würde eine Szene eröffnen oder tragen; "solid" = gute, brauchbare Einstellung; "filler" = nur als Lückenfüller brauchbar. Nutze die gesamte Bandbreite und wähle nicht standardmäßig "solid".
shot: Einstellungsgröße: "wide" = Totale, Überblick über den Ort; "medium" = halbnah, Personen oder Objekte im Umfeld; "close" = nah, Gesicht oder Objekt füllt das Bild; "detail" = Großaufnahme eines Details (Hände, Textur, Gegenstand).
role: Funktion im Schnitt: "establishing" = zeigt Ort oder Situation zu Beginn einer Szene; "action" = Handlung oder Bewegung im Mittelpunkt; "reaction" = Reaktion oder Stimmung einer Person; "detail" = Zwischenschnitt auf ein Detail; "transition" = verbindet zwei Szenen (z.B. Schwenk, Weg, Übergang).
issues: nur tatsächlich sichtbare Probleme in genau diesem Moment, sonst leeres Array: "shake" = verwackelt; "blur" = unscharf; "obstructed" = Sicht verdeckt (Finger, Gegenstand, Person im Bild); "overexposed" = überbelichtet; "underexposed" = unterbelichtet.
slowmo: beurteile pro Moment, ob er in einem Reise-Montage-Video verlangsamt (Zeitlupe) besser aussähe: "none", "light" oder "strong". Ja (light) bei fließender oder schneller Bewegung mit visuellem Gewinn: Wasser nur mit einem Ereignis (Welle bricht, Spritzer, Tier, Boot), Sport und Action, sanfte Schwenks über Landschaft. "none" bei Sprache, Personen die in die Kamera sprechen, Momenten die vom Ton oder von komischem Timing in Echtzeit leben, und statischen Einstellungen. "strong" nur für kurze, schnelle Action-Spitzen. slowmo_reason: kurze englische Begründung (leer bei "none").
audio_keep = true, wenn der Originalton es wert ist, unter oder statt Musik gehört zu werden (Lachen, Wellenrauschen mit Ereignis, Ansage, Live-Musik), sonst false. audio_type = was hauptsächlich zu hören ist: "ambient" = Umgebungsgeräusche, "speech" = Sprache, "music" = Musik, "noise" = nur Wind, Rauschen oder Störgeräusche.
setting und activity: kurze englische Tags in Kleinbuchstaben (lowercase), je 1-3 Wörter (1-3 words), z.B. "marina", "open sea", "dolphin watching". Keine ganzen Sätze, wiederverwendbar über Clips hinweg.
`;

