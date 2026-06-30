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
| 🎮 **Xbox-Controller** | wird automatisch erkannt (RT Gas, LT Bremse, L-Stick Lenken) |

## Features

- **Garagen-Menü** nach der Modus-Wahl: 5 europäische Marken (alphabetisch) mit je 2 Sportwagen, technische Daten und drehbares 3D-Modell; links die Auto-Auswahl, oben rechts „Zurück", unten rechts „Auto auswählen". Im Rennmodus fahren die KIs zufällige Autos (nie das des Spielers).
- 10 prozedural aus 3D-Grundkörpern gebaute Sportwagen (Alfa Romeo, Aston Martin, BMW, Ferrari, Porsche)
- **Spa-Francorchamps** aus echten Vermessungsdaten (TUM racetrack-database)
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
