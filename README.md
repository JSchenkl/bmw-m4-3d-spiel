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

- **BMW M4 Competition** und **Mercedes 300SL Gullwing** als 3D-Modelle (GLB)
- **5 Strecken** aus echten Vermessungsdaten (TUM racetrack-database): **Spa-Francorchamps**, **Hockenheimring**, **Silverstone**, **Monza**, **Circuit Gilles-Villeneuve** – inkl. Gras, Kiesbett und Reifen-Bande
- **Streckenauswahl** vor der Modus-Wahl (Kreuztasten wechseln die Strecke, mit Streckenkarte von oben, Name, Länge und Land)
- **Rennmodus**: Qualifikation, F1-Startampel, **5 Runden** mit Rundenzähler und Platzierung; KI-Gegner mit gleicher Beschleunigung & gleichem Kurven-Grip wie der Spieler, die einander überholen und sich nicht überlappen
- Scheinwerfer & Rücklichter mit Lichtkegeln
- Tag-/Nachtmodus
- Motorgeräusch (synthetisierter Reihensechszylinder)
- Cockpit-Kamera mit Umsehen per Maus
- Automatik- und Schaltgetriebe (6 Gänge)
- Kollisionserkennung (Mauern, Gebäude)
- Startbildschirm mit Auto-Rotation im Nachtmodus

## Physik

- Längsdynamik: Zugkraft, Leistungsgrenze, Luft- und Rollwiderstand
- Antriebsverteilung: 10 % vorne / 90 % hinten (xDrive)
- Querdynamik: Einspurmodell mit Kammschen Kreis
- Power-Oversteer bei Hinterradschlupf

## Credits

- Modell **BMW M4 Competition M Package** – SRT Performance · [Sketchfab](https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b) · CC-BY 4.0
- Modell **Mercedes-Benz 300SL Gullwing** – vecarz.com
- Streckendaten Spa-Francorchamps – [TUM racetrack-database](https://github.com/TUMFTM/racetrack-database)
