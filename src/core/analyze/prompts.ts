/** Bumped when the analysis prompt changes; clips analysed with an older version keep their data. */
export const ANALYSIS_PROMPT_VERSION = 2;

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
      "issues": ["blur | obstructed | overexposed | underexposed"],
      "slowmo": "none | light | strong",
      "slowmo_reason": "Short reason in English, empty if none",
      "audio_keep": false,
      "audio_type": "ambient | speech | music | noise",
      "jolt_at_key_action": false
    }
  ]
}

highlights: 0 bis 8 brauchbare Momente für einen Reise-Montage-Film (leeres Array, wenn nichts taugt). Ein Moment ist die beste stabile Einstellung, die ein Cutter tatsächlich verwenden würde, 2 bis 8 Sekunden (meist 3 bis 6) lang. Bei längeren Clips wähle mehrere Momente und decke den Clip ab: lass keine guten Teile zwischen den Momenten aus. Beginne einen Moment erst, nachdem sich das Bild beruhigt hat (Umrahmen, Einstellungen anpassen, Kamera zurechtrücken sind vorbei), und beende ihn, bevor die Kamera wegschwenkt oder sich vom Motiv entfernt. Vermeide Stellen, in denen die Kamera auf der Suche nach dem Motiv schwenkt, neigt oder zoomt, außer die Bewegung selbst ist die Einstellung. Die Momente eines Clips dürfen sich nicht überlappen.
start_sec und end_sec sind Zahlen in Sekunden ab Clip-Beginn und müssen aus dem stammen, was im Video tatsächlich zu sehen ist (keine Beispielwerte übernehmen). description auf Englisch.
tier: wie stark der Moment als Einstellung in einem Reise-Montage-Video ist. "hero" nur für die besten ca. 10 % aller Momente einer Reise (würde eine Szene eröffnen oder tragen); die meisten Momente "solid" (gute, brauchbare Einstellung); "filler" = nur als Lückenfüller brauchbar. Im Zweifel "solid", nicht "hero".
shot: Einstellungsgröße: "wide" = Totale, Überblick über den Ort; "medium" = halbnah, Personen oder Objekte im Umfeld; "close" = nah, Gesicht oder Objekt füllt das Bild; "detail" = Großaufnahme eines Details (Hände, Textur, Gegenstand).
role: Funktion im Schnitt: "establishing" = zeigt Ort oder Situation zu Beginn einer Szene; "action" = Handlung oder Bewegung im Mittelpunkt; "reaction" = Reaktion oder Stimmung einer Person; "detail" = Zwischenschnitt auf ein Detail; "transition" = verbindet zwei Szenen (z.B. Schwenk, Weg, Übergang).
issues: nur tatsächlich sichtbare Probleme in genau diesem Moment, sonst leeres Array: "blur" = unscharf; "obstructed" = Sicht verdeckt (Finger, Gegenstand, Person im Bild); "overexposed" = überbelichtet; "underexposed" = unterbelichtet.
slowmo: beurteile pro Moment, ob er in einem Reise-Montage-Video verlangsamt (Zeitlupe) besser aussähe: "none", "light" oder "strong". Ja (light) bei fließender oder schneller Bewegung mit visuellem Gewinn: Wasser nur mit einem Ereignis (Welle bricht, Spritzer, Tier, Boot), Sport und Action, sanfte Schwenks über Landschaft. "none" bei Sprache, Personen die in die Kamera sprechen, Momenten die vom Ton oder von komischem Timing in Echtzeit leben, und statischen Einstellungen. "strong" nur für kurze, schnelle Action-Spitzen. slowmo_reason: kurze englische Begründung (leer bei "none").
audio_keep = true nur, wenn der Originalton den Moment trägt (Lachen, eine gesprochene Ansage, ein Wellen-Ereignis wie eine brechende Welle, Live-Musik), sonst false; im Zweifel false. Meer- oder Windrauschen allein = false. audio_type = was hauptsächlich zu hören ist: "ambient" = Umgebungsgeräusche, "speech" = Sprache, "music" = Musik, "noise" = nur Wind, Rauschen oder Störgeräusche.
Gemessene Daten: Steht unter dem Video ein Block "Gemessene Daten zu diesem Clip", sind das Messwerte (Kamerawackler = einzelne Rucke der Kamera, gesprochene Sätze mit Zeiten). Setze Anfang und Ende eines Moments nie mitten in einen Wackler und nie mitten in einen Satz (Sätze ganz mitnehmen). Bevorzuge Bereiche ohne Wackler. Passiert die Hauptaktion des Moments (z.B. der Kuss, der Sprung, der Spritzer) genau während eines Wacklers, behalte den Moment trotzdem und setze jolt_at_key_action = true; sonst immer false.
setting und activity: kurze englische Tags in Kleinbuchstaben (lowercase), je 1-3 Wörter (1-3 words), z.B. "marina", "open sea", "dolphin watching". Keine ganzen Sätze, wiederverwendbar über Clips hinweg.
`;

