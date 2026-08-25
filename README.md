# BMW M4 3D Rennspiel

Browser-basiertes 3D-Rennspiel mit zwei Rennwagen – **BMW M4 GT3 EVO** und **Toyota TS030 Hybrid** –
auf fünf Strecken aus echten Vermessungsdaten.

## Starten

```
start.bat
```

Der lokale Webserver startet auf **http://localhost:8000** und öffnet den Browser automatisch.  
Kein Node.js oder Python erforderlich – der Server läuft rein über PowerShell.

## Steuerung

| Taste | Funktion |
|---|---|
| **W** / Pfeil hoch | Gas geben |
| **S** / Pfeil runter | Rückwärts |
| **A** / **D** | Lenken |
| **Leertaste** | Bremsen |
| **L** / **J** | Hochschalten / Runterschalten |
| **T** | Kamera wechseln (Verfolger / Cockpit) |
| **M** | Menü öffnen/schließen |
| 🎮 **Xbox-Controller** | wird automatisch erkannt (RT Gas, LT Bremse, L-Stick Lenken, RB/LB schalten) |
| 🎮 **RB / LB (Automatik)** | Fahrstufe **D** (vorwärts) / **R** (rückwärts) wählen |

## Features

- **Zwei Autos** als 3D-Modell (GLB) mit jeweils eigener, aus den Originaldaten abgeleiteter Fahrdynamik: **BMW M4 GT3 EVO** und **Toyota TS030 Hybrid** (LMP1)
- **5 Strecken** aus echten Vermessungsdaten der [TUM racetrack-database](https://github.com/TUMFTM/racetrack-database): **Red Bull Ring (Spielberg)**, **Hockenheimring**, **Circuit Zandvoort**, **Circuit Gilles-Villeneuve**, **Interlagos (São Paulo)** – inkl. Gras, Kiesbett und Reifen-Bande
- **Streckenauswahl** vor der Modus-Wahl (Kreuztasten wechseln die Strecke, mit Streckenkarte von oben, Name, Länge und Land)
- **Autoauswahl** direkt nach der Strecke: BMW M4 GT3 EVO oder Toyota TS030 Hybrid, mit den **Originaldaten unten rechts** (Motor, Leistung, Gewicht, 0–100, Vmax, Antrieb, Getriebe)
- **Reifenmechanik**: das Spiel rechnet je Bild aus, ob die Reifen blockieren oder durchdrehen. Zu hartes Bremsen (besonders mit Lenkeinschlag) übersteigt die Haftgrenze – dann qualmt **weißer Reifenrauch** und auf der Fahrbahn bleiben **Bremsspuren** zurück. Die vier Reifen **wärmen sich einzeln auf** und **nutzen sich ab**: warme Reifen greifen besser und blockieren später, abgefahrene verlieren Haftung. Ein Boxenstopp (**Zur Box**) zieht frische, kalte Reifen auf
- **Curbs als Rampe**: die Randsteine steigen von der Fahrbahnkante nach außen an, statt als Stufe daneben zu stehen. Wer darauf fährt, rollt hinauf – das Auto neigt sich dabei stufenlos und der Wagenkasten steigt mit
- **Reifenschaden**: bei 100 % Verschleiß ist der Reifen **platt**. Das Auto bleibt fahrbar, verhält sich aber deutlich anders – es zieht zur Seite des Platten, wird beim Bremsen unruhig, der Rollwiderstand steigt stark. **Vorne platt** heißt Untersteuern und schlechtes Einlenken, **hinten platt** ein instabiles Heck. Wer weiterfährt, ruiniert zusätzlich die Felge; wie schnell, hängt am Tempo. Zurück an die Box kommt man im Schritttempo noch
- **Reifenanzeige unten rechts**: Grundriss mit allen vier Reifen – die Farbe zeigt die Temperatur (blau kalt → grün bereit → rot heiß), der schraffierte Anteil die Abnutzung, darunter die verbleibende Lauffläche in Prozent. Ein platter Reifen wird rot durchgekreuzt, dazu warnt das HUD und es rumpelt hörbar
- **Minikarte unten rechts** (ohne Kasten) mit blauem Punkt für die eigene Position
- **Rennmodus**: Qualifikation, F1-Startampel, **5 Runden** mit Rundenzähler und Platzierung; **4 KI-Gegner** (Feld also 5 Autos) mit gleicher Beschleunigung & gleichem Kurven-Grip wie der Spieler, die einander überholen und sich nicht überlappen
- **Karrieremodus** (Knopf „KARRIERE" auf dem Startbildschirm) – siehe unten
- Scheinwerfer & Rücklichter mit Lichtkegeln
- Tag-/Nachtmodus
- Motorgeräusch (synthetisierter GT3-Rennmotor, P58-Charakter) mit Auspuff-Crackles beim Gaswegnehmen
- **Auspuffflammen** beim Hochschalten und bei den Crackles
- Cockpit-Kamera mit Umsehen per Maus
- Automatik- und sequenzielles Schaltgetriebe (6 Gänge)
- Kollisionserkennung (Mauern, Gebäude)
- Startbildschirm mit Auto-Rotation im Nachtmodus

## Karrieremodus

Der Karrieremodus liegt **neben** dem Einzelrennen, nicht darüber: „SPIELEN" führt
unverändert in Training und Einzelrennen, „KARRIERE" in eine eigene Fortschritts-
welt. Ist kein Karriere-Rennen aktiv, verhält sich das Spiel exakt wie vorher.

- **Fahrerprofil**: Level 1–50 mit Titeln (Anfänger → Legende), XP aus Platzierung,
  Renndistanz, Pole, schnellster Runde, sauberem Rennen und gutgemachten Positionen;
  dazu **Reputation**, die Events und Fahrzeuge freischaltet
- **Wirtschaft**: Startkapital, Startgelder, Preisgelder nach Platz, Reparaturkosten
  nach Fahrzeugzustand, Kauf und Verkauf mit Wertverlust
- **Garage** mit persistenten Daten je Auto: Kilometer, Rennen, Siege, Podien,
  Zustand, Upgrade-Stufen. Ein vernachlässigtes Auto fährt messbar schlechter
- **Fahrzeugklassen D → C → B → A → S → R.** Das Spiel liefert zwei 3D-Modelle;
  die sechs Karrierefahrzeuge sind deshalb **Tuning-Varianten dieser beiden
  Modelle** (`career-data.js`, Feld `tuning`) – vom abgerüsteten Clubsport bis
  zum vollen TS030
- **Upgrades** in sechs Kategorien (Motor, Getriebe, Fahrwerk, Bremsen, Reifen,
  Gewicht) mit je drei Stufen. Sie sind **keine Zahlenkosmetik**: die Stufen wirken
  als Multiplikatoren direkt auf `CARS[i].phys` (Leistung, Zugkraft, Querhaftung,
  Bremsverzögerung, Abtrieb, Masse, Reifenhaftung und -haltbarkeit)
- **Eventtypen**: Einzelrennen, Sprint, Langstrecke, Zeitfahren, Markenpokal,
  Klassen-Cup, Einladungsevent, Spezialevent – je mit eigener Distanz,
  Gegnerstärke und Preisgeldstaffel
- **Meisterschaften** über mehrere Läufe mit Punktetabelle (25/18/15/12/10/8/6/4/2/1),
  Titelprämie und Reputationsbonus
- **Persistente KI-Fahrer** mit Namen und Charakter (Tempo, Aggressivität,
  Konstanz, Fehlerquote). Sie behalten ihre Identität über die ganze Meisterschaft
- **Rennwochenende**: Startaufstellung aus dem Können der Gegner, Quali, Ampel,
  Rennen, Ergebnisbericht mit XP-Aufschlüsselung und Meisterschaftsstand
- **Statistik**: Rennen, Siege, Podien, Poles, schnellste Runden, Titel,
  Durchschnittsplatzierung, Kilometer, Höchstgeschwindigkeit, Geldfluss
- **Saisons**: nach genug absolvierten Events lässt sich die Saison abschließen –
  Bonus kassieren, Events werden wieder fahrbar, aller Besitz bleibt erhalten
- **Dynamische Schwierigkeit ohne Rubberbanding**: die KI wird mit dem Karrierelevel
  besser, aber über **Können** (späteres Bremsen, weniger Patzer, konstantere
  Rundenzeiten) – nie über künstliches Mehrtempo, und **ohne jeden Bezug zur
  aktuellen Position des Spielers** im laufenden Rennen
- **Speichern**: versioniert in `localStorage` (`bmwM4Career`), automatisch nach
  jedem Rennen und Kauf. Alte Stände werden migriert, beschädigte oder
  unvollständige Stände werden Sektion für Sektion mit Vorgaben aufgefüllt statt
  das Spiel abstürzen zu lassen

### Aufbau

| Datei | Inhalt |
| --- | --- |
| `career-data.js` | reine Daten: Klassen, Fahrzeuge, Upgrades, Events, Meisterschaften, KI-Fahrer, Levelkurve, Balance-Werte |
| `career.js` | Logik ohne DOM: `CareerSave`, `PlayerCareer`, `CareerEconomy`, `GarageManager`, `VehicleUpgradeManager`, `CareerProgression`, `EventManager`, `ChampionshipManager`, `CareerAIManager`, `CareerStatistics` und die Fassade `CareerManager` |
| `career-ui.js` | die Karriere-Bildschirme; spricht mit `main.js` nur über `onRaceStart` / `onExit` / `rennenBeendet` |
| `career.test.mjs` | 31 Tests des kompletten Ablaufs, laufen ohne Browser: `node career.test.mjs` |

Neue Events, Fahrzeuge oder Meisterschaften entstehen durch Ergänzen der Tabellen
in `career-data.js` – ohne `career.js` oder `main.js` anzufassen.

## Physik

Beide Autos nutzen dasselbe Kraftmodell, aber je Auto eigene Kennwerte
(`CARS[i].phys` in `main.js`, gesetzt von `applyCarPhysics`):

- Längsdynamik: Zugkraft, Leistungsgrenze, Luft- und Rollwiderstand
- Querdynamik: Einspurmodell mit Kammschem Kreis; **Aero-Abtrieb** erhöht den Kurven-Grip mit dem Tempo
- Power-Oversteer bei Hinterradschlupf
- **Reifen**: jeder der vier Reifen führt seinen eigenen Haftungsfaktor aus Temperatur
  und Abnutzung. Er geht dort ein, wo der Reifen arbeitet – vorne in die Bremsgrenze,
  hinten in die Traktionsgrenze, alle vier in die Kurvengrenze (`CARS[i].phys.reifen`)
- **Verschleiß wirkt progressiv**, nicht linear: der Haftungsverlust wächst mit
  `abrieb^kurve` (Standard 3). Ein zu 60 % abgefahrener Reifen hat erst 5 % Haftung
  eingebüßt, ein ganz abgefahrener 25 % (M4) bzw. 30 % (TS030)
- **Unter- und Übersteuern** entstehen aus dem Verhältnis der Achsen: schwache
  Vorderreifen lassen das Auto über die Front schieben, ein schwaches Heck schiebt
  mit. Der seitliche Zug bei Reifenschaden folgt aus der Links-rechts-Bilanz –
  es gibt keine Sonderfälle für einzelne Räder
- **Lastverlagerung**: beim Beschleunigen wandert Achslast nach hinten, das Heck kann
  also mehr Kraft absetzen als im Stand. Ohne diesen Anteil würden die Hinterräder
  schon bei normalem Vollgas rechnerisch durchdrehen
- Übersteigt der Bremswunsch die Haftgrenze, blockiert das Rad: die Verzögerung fällt
  auf den Gleitreibwert und die Lenkung verliert fast ihre Wirkung

| | BMW M4 GT3 EVO | Toyota TS030 Hybrid |
|---|---|---|
| Klasse | GT3 | LMP1-Prototyp |
| Leistung | 590 PS | 730 PS (V8 + Hybrid) |
| Gewicht | 1300 kg | 900 kg |
| 0–100 km/h | 2,8 s | 2,3 s |
| Topspeed | 280 km/h | 340 km/h |
| Kurven-Grip | 1,05 g + bis +45 % Abtrieb | 1,25 g + bis +75 % Abtrieb |
| Bremsen | 1,8 g | 2,1 g |
| Reifen kalt → warm | 0,82 → 1,06 | 0,76 → 1,10 |
| Bremsweg 200 → 0 km/h | 138 m kalt · 84 m warm | 133 m kalt · 71 m warm |
| …mit abgefahrenen Reifen | 142 m | 131 m |
| Hinterreifen auf Temperatur | nach ~1 Runde | nach ~1 Runde |
| Vorderreifen auf Temperatur | nach ~2 Runden | nach ~3 Runden |
| Reifen abgefahren nach | ~15 Runden | ~10 Runden |
| Haftung bei 60 % Verschleiß | −5 % | −6 % |
| …bei 100 % Verschleiß | −25 % | −30 % |
| Platter Reifen: Seitenführung | 30 % | 26 % |
| Platter Reifen: Rollwiderstand | +423 % | +500 % |

Der Toyota startet kälter und braucht länger, bis die Reifen greifen – dafür hat er warm
den klar besseren Grip, verschleißt aber schneller. Der M4 ist von Anfang an gutmütiger
und hält länger durch. Bei beiden werden die Hinterreifen zuerst warm und gehen zuerst
kaputt: beide Autos sind Hecktriebler.

## Credits

- Modell **2022 BMW M4 GT3** – Ddiaz Design · [Sketchfab](https://sketchfab.com/3d-models/2022-bmw-m4-gt3-61695f14da8d4821beda6f0e376c2f73) · CC-BY-NC-SA 4.0
- Modell **Toyota TS030 Hybrid** – vecarz.com
- Streckendaten – [TUM racetrack-database](https://github.com/TUMFTM/racetrack-database)
