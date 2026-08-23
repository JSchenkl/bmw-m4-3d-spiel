# BMW M4 3D Rennspiel

Browser-basiertes 3D-Rennspiel mit dem BMW M4 Competition auf dem Kurs Spa-Francorchamps.

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
- **Rennmodus**: Qualifikation, F1-Startampel, **5 Runden** mit Rundenzähler und Platzierung; KI-Gegner mit gleicher Beschleunigung & gleichem Kurven-Grip wie der Spieler, die einander überholen und sich nicht überlappen
- Scheinwerfer & Rücklichter mit Lichtkegeln
- Tag-/Nachtmodus
- Motorgeräusch (synthetisierter GT3-Rennmotor, P58-Charakter) mit Auspuff-Crackles beim Gaswegnehmen
- **Auspuffflammen** beim Hochschalten und bei den Crackles
- Cockpit-Kamera mit Umsehen per Maus
- Automatik- und sequenzielles Schaltgetriebe (6 Gänge)
- Kollisionserkennung (Mauern, Gebäude)
- Startbildschirm mit Auto-Rotation im Nachtmodus

## Physik

Beide Autos nutzen dasselbe Kraftmodell, aber je Auto eigene Kennwerte
(`CARS[i].phys` in `main.js`, gesetzt von `applyCarPhysics`):

- Längsdynamik: Zugkraft, Leistungsgrenze, Luft- und Rollwiderstand
- Querdynamik: Einspurmodell mit Kammschem Kreis; **Aero-Abtrieb** erhöht den Kurven-Grip mit dem Tempo
- Power-Oversteer bei Hinterradschlupf

| | BMW M4 GT3 EVO | Toyota TS030 Hybrid |
|---|---|---|
| Klasse | GT3 | LMP1-Prototyp |
| Leistung | 590 PS | 730 PS (V8 + Hybrid) |
| Gewicht | 1300 kg | 900 kg |
| 0–100 km/h | 2,8 s | 2,3 s |
| Topspeed | 280 km/h | 340 km/h |
| Kurven-Grip | 1,05 g + bis +45 % Abtrieb | 1,25 g + bis +75 % Abtrieb |
| Bremsen | 1,8 g | 2,1 g |

## Credits

- Modell **2022 BMW M4 GT3** – Ddiaz Design · [Sketchfab](https://sketchfab.com/3d-models/2022-bmw-m4-gt3-61695f14da8d4821beda6f0e376c2f73) · CC-BY-NC-SA 4.0
- Modell **Mercedes-Benz 300SL Gullwing** – vecarz.com
- Modell **Toyota TS030 Hybrid** – vecarz.com
- Streckendaten – [TUM racetrack-database](https://github.com/TUMFTM/racetrack-database)
- Spa-1992-Layout – **Spa Francorchamps 1992 layout** von Dave Love · [Sketchfab](https://sketchfab.com/3d-models/spa-francorchamps-1992-layout-a1223a21df954b9ebf8eb3b7c682eb99) · CC-BY 4.0
- Austin-Layout – **Austin Circuit of the Americas 2012 layout** von Dave Love · [Sketchfab](https://sketchfab.com/3d-models/austin-circuit-of-the-americas-2012-layout-5fb6c4716f3c4ff2bd056bf72cd1a102) · CC-BY 4.0
